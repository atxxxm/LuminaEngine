// CPU-генерация чанка: карта высот, пещеры и руды.
//
// Раньше это считалось на GPU (см. GPUWorldGenerator.js): рендер шейдера в
// текстуру + синхронный readRenderTargetPixels() на каждый чанк, что
// останавливает GPU-конвейер на время чтения. Здесь ровно та же формула
// шума высот (value noise со сглаживанием smoothstep, как в оригинальном
// фрагментном шейдере), но одним прямым вызовом на CPU — стоп-кадра GPU
// больше нет вообще.
//
// generate_chunk_voxels() отдаёт уже готовый чанк (id блоков по каждой
// координате), а не просто карту высот — решение "какой блок здесь" тоже
// теперь принимается в Rust, а не в JS-цикле.

use wasm_bindgen::prelude::*;

// ВАЖНО: должны совпадать с id в game/blocks.js (BLOCK.*).
const BLOCK_AIR: u8 = 0;
const BLOCK_BEDROCK: u8 = 1;
const BLOCK_STONE: u8 = 2;
const BLOCK_DIRT: u8 = 3;
const BLOCK_GRASS: u8 = 4;
const BLOCK_COAL_ORE: u8 = 7;
const BLOCK_IRON_ORE: u8 = 8;

// ВАЖНО: этот хэш только на первый взгляд выглядит как "sin+fract" трюк
// один в один со стороны GLSL-шейдера. На GPU float обычно 32-битный и sin()
// там — быстрая (неточная) аппроксимация, поэтому даже при большом
// промежуточном значении v сохраняются "случайные" младшие биты. Rust/libm
// же считает sin() с высокой точностью: как только |v| превышает 2^23
// (~8.4 млн, предел точности f32 для целых чисел), v становится ЦЕЛЫМ
// числом без остатка, и fract(v) всегда даёт 0 — карта высот выходила
// сплошным нулём. Считаем хэш в f64 (там порог точности — 2^52), чтобы
// дробная часть реально сохранялась.
fn hash(x: f64, y: f64, seed: f64) -> f64 {
    let v = (x * 12.9898 + y * 78.233).sin() * 43758.5453123 * (seed + 1.0);
    v - v.floor() // fract()
}

fn hash3d(x: f64, y: f64, z: f64, seed: f64) -> f64 {
    let v = (x * 12.9898 + y * 78.233 + z * 37.719).sin() * 43758.5453123 * (seed + 1.0);
    v - v.floor()
}

fn noise2d(x: f64, y: f64, seed: f64) -> f64 {
    let ix = x.floor();
    let iy = y.floor();
    let fx = x - ix;
    let fy = y - iy;

    let a = hash(ix, iy, seed);
    let b = hash(ix + 1.0, iy, seed);
    let c = hash(ix, iy + 1.0, seed);
    let d = hash(ix + 1.0, iy + 1.0, seed);

    // smoothstep(f), как в оригинальном шейдере
    let ux = fx * fx * (3.0 - 2.0 * fx);
    let uy = fy * fy * (3.0 - 2.0 * fy);

    let mix_ab = a + (b - a) * ux;
    mix_ab + (c - a) * uy * (1.0 - ux) + (d - b) * ux * uy
}

// Трилинейная интерполяция value-noise по 8 углам куба — то же самое, что
// noise2d, только на одно измерение больше. Даёт связные "пещерные" пятна
// вместо соли-с-перцем из независимого хэша на каждый воксель.
#[allow(clippy::too_many_arguments)]
fn noise3d(x: f64, y: f64, z: f64, seed: f64) -> f64 {
    let ix = x.floor();
    let iy = y.floor();
    let iz = z.floor();
    let fx = x - ix;
    let fy = y - iy;
    let fz = z - iz;

    let h = |dx: f64, dy: f64, dz: f64| hash3d(ix + dx, iy + dy, iz + dz, seed);

    let c000 = h(0.0, 0.0, 0.0);
    let c100 = h(1.0, 0.0, 0.0);
    let c010 = h(0.0, 1.0, 0.0);
    let c110 = h(1.0, 1.0, 0.0);
    let c001 = h(0.0, 0.0, 1.0);
    let c101 = h(1.0, 0.0, 1.0);
    let c011 = h(0.0, 1.0, 1.0);
    let c111 = h(1.0, 1.0, 1.0);

    let ux = fx * fx * (3.0 - 2.0 * fx);
    let uy = fy * fy * (3.0 - 2.0 * fy);
    let uz = fz * fz * (3.0 - 2.0 * fz);

    let x00 = c000 + (c100 - c000) * ux;
    let x10 = c010 + (c110 - c010) * ux;
    let x01 = c001 + (c101 - c001) * ux;
    let x11 = c011 + (c111 - c011) * ux;

    let y0 = x00 + (x10 - x00) * uy;
    let y1 = x01 + (x11 - x01) * uy;

    y0 + (y1 - y0) * uz
}

fn surface_height(world_x: f64, world_z: f64, seed: f64) -> i32 {
    let scale = 50.0f64; // совпадает с `noise(worldPos / 50.0)` в шейдере
    let h = noise2d(world_x / scale, world_z / scale, seed);
    (h * 20.0).floor() as i32 + 40
}

/// Возвращает карту высот чанка (chunk_size * chunk_size значений в [0,1]),
/// index = z * chunk_size + x — совместимо с прежним GPU-путём.
#[wasm_bindgen]
pub fn generate_height_map(chunk_x: i32, chunk_z: i32, chunk_size: u32, seed: f64) -> Vec<f32> {
    let scale = 50.0f64;
    let origin_x = (chunk_x * chunk_size as i32) as f64;
    let origin_z = (chunk_z * chunk_size as i32) as f64;

    let mut heights = vec![0f32; (chunk_size * chunk_size) as usize];
    for z in 0..chunk_size {
        for x in 0..chunk_size {
            let world_x = origin_x + x as f64 + 0.5;
            let world_z = origin_z + z as f64 + 0.5;
            let h = noise2d(world_x / scale, world_z / scale, seed);
            heights[(z * chunk_size + x) as usize] = h as f32;
        }
    }
    heights
}

/// Генерирует воксели чанка целиком: рельеф (высота из noise2d),
/// пещеры (связный 3D value-noise, вырезает воздух внутри камня) и руды
/// (независимая по вокселю вероятность на основе hash3d, глубже — реже).
///
/// Возвращает массив длиной chunk_size * world_height * chunk_size,
/// index = y*chunk_size*chunk_size + z*chunk_size + x — совпадает с
/// раскладкой Chunk.data в game/World.js.
#[wasm_bindgen]
pub fn generate_chunk_voxels(
    chunk_x: i32,
    chunk_z: i32,
    chunk_size: u32,
    world_height: u32,
    seed: f64,
) -> Vec<u8> {
    let cs = chunk_size as usize;
    let wh = world_height as usize;
    let origin_x = (chunk_x * chunk_size as i32) as f64;
    let origin_z = (chunk_z * chunk_size as i32) as f64;

    let mut voxels = vec![0u8; cs * wh * cs];

    for z in 0..chunk_size {
        for x in 0..chunk_size {
            let world_x = origin_x + x as f64 + 0.5;
            let world_z = origin_z + z as f64 + 0.5;
            let height = surface_height(world_x, world_z, seed);

            for y in 0..world_height as i32 {
                let idx = (y as usize) * cs * cs + (z as usize) * cs + x as usize;

                let block = if y == 0 {
                    BLOCK_BEDROCK
                } else if y < height - 3 {
                    // Внутри массива камня — проверяем, не пещера ли здесь,
                    // и не поставить ли руду вместо обычного камня.
                    let cave_scale = 10.0;
                    let cave = noise3d(
                        world_x / cave_scale,
                        y as f64 / cave_scale,
                        world_z / cave_scale,
                        seed + 1000.0,
                    );
                    // Не вырезаем пещеры у самого бедрока и вплотную под
                    // поверхностью — иначе дёрн может повиснуть прямо над
                    // пустотой сразу под травой.
                    if y > 2 && y < height - 5 && cave > 0.62 {
                        BLOCK_AIR
                    } else {
                        let coal = hash3d(world_x, y as f64, world_z, seed + 2000.0);
                        let iron = hash3d(world_x, y as f64, world_z, seed + 3000.0);
                        if coal < 0.03 {
                            BLOCK_COAL_ORE
                        } else if y < height - 15 && iron < 0.02 {
                            BLOCK_IRON_ORE
                        } else {
                            BLOCK_STONE
                        }
                    }
                } else if y < height {
                    BLOCK_DIRT
                } else if y == height {
                    BLOCK_GRASS
                } else {
                    BLOCK_AIR
                };

                voxels[idx] = block;
            }
        }
    }

    voxels
}
