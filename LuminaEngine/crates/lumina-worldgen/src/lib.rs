// CPU-генерация чанка: рельеф (горы), пещеры, руды, вода и деревья.
//
// Раньше это считалось на GPU (см. GPUWorldGenerator.js): рендер шейдера в
// текстуру + синхронный readRenderTargetPixels() на каждый чанк, что
// останавливает GPU-конвейер на время чтения. Здесь та же идея value-noise
// со сглаживанием smoothstep, но одним прямым вызовом на CPU — стоп-кадра
// GPU больше нет вообще.
//
// generate_chunk_voxels() отдаёт уже готовый чанк (id блоков по каждой
// координате), а не просто карту высот — решение "какой блок здесь" тоже
// принимается в Rust, а не в JS-цикле.

use wasm_bindgen::prelude::*;

// ВАЖНО: должны совпадать с id в game/blocks.js (BLOCK.*).
const BLOCK_AIR: u8 = 0;
const BLOCK_BEDROCK: u8 = 1;
const BLOCK_STONE: u8 = 2;
const BLOCK_DIRT: u8 = 3;
const BLOCK_GRASS: u8 = 4;
const BLOCK_OAK_LOG: u8 = 5;
const BLOCK_OAK_LEAVES: u8 = 6;
const BLOCK_COAL_ORE: u8 = 7;
const BLOCK_IRON_ORE: u8 = 8;
const BLOCK_WATER: u8 = 9;

// Уровень моря: столбцы с высотой рельефа ниже этой отметки заливаются
// водой до неё же — этого достаточно, чтобы получить озёра/океаны без
// отдельной карты биомов.
const WATER_LEVEL: i32 = 45;

const TREE_CHANCE: f64 = 0.02;
const TREE_TRUNK_MIN: i32 = 4;
const TREE_TRUNK_MAX: i32 = 6;
// Насколько за пределы своего чанка может "дотянуться" крона соседнего
// дерева — при сканировании на деревья чанк проверяется с этим запасом.
const TREE_SEARCH_MARGIN: i32 = 3;

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

// Три октавы noise2d разного масштаба: широкие горные массивы + холмы +
// мелкая рябь. Возвращает значение примерно в [0,1].
fn terrain_shape(world_x: f64, world_z: f64, seed: f64) -> f64 {
    let n1 = noise2d(world_x / 160.0, world_z / 160.0, seed);
    let n2 = noise2d(world_x / 60.0, world_z / 60.0, seed + 500.0);
    let n3 = noise2d(world_x / 20.0, world_z / 20.0, seed + 900.0);
    (n1 * 1.0 + n2 * 0.5 + n3 * 0.25) / 1.75
}

fn surface_height(world_x: f64, world_z: f64, seed: f64) -> i32 {
    let shape = terrain_shape(world_x, world_z, seed);
    let height = 30.0 + shape * 90.0; // ~30 (дно озёр) .. ~120 (горы)
    (height.floor() as i32).clamp(5, 118)
}

fn tree_exists_at(world_x: f64, world_z: f64, seed: f64) -> bool {
    hash(world_x, world_z, seed + 4000.0) < TREE_CHANCE
}

fn trunk_height_at(world_x: f64, world_z: f64, seed: f64) -> i32 {
    let t = hash(world_x, world_z, seed + 4500.0);
    TREE_TRUNK_MIN + (t * (TREE_TRUNK_MAX - TREE_TRUNK_MIN + 1) as f64).floor() as i32
}

#[allow(clippy::too_many_arguments)]
fn set_voxel(voxels: &mut [u8], cs: usize, wh: usize, lx: i32, y: i32, lz: i32, block: u8, only_if_air: bool) {
    if lx < 0 || lx >= cs as i32 || lz < 0 || lz >= cs as i32 || y < 0 || y >= wh as i32 {
        return; // за пределами текущего чанка — это забота соседнего чанка
    }
    let idx = (y as usize) * cs * cs + (lz as usize) * cs + (lx as usize);
    if only_if_air && voxels[idx] != BLOCK_AIR {
        return;
    }
    voxels[idx] = block;
}

/// Возвращает карту высот чанка (chunk_size * chunk_size значений в [0,1]),
/// index = z * chunk_size + x.
#[wasm_bindgen]
pub fn generate_height_map(chunk_x: i32, chunk_z: i32, chunk_size: u32, seed: f64) -> Vec<f32> {
    let origin_x = (chunk_x * chunk_size as i32) as f64;
    let origin_z = (chunk_z * chunk_size as i32) as f64;

    let mut heights = vec![0f32; (chunk_size * chunk_size) as usize];
    for z in 0..chunk_size {
        for x in 0..chunk_size {
            let world_x = origin_x + x as f64 + 0.5;
            let world_z = origin_z + z as f64 + 0.5;
            heights[(z * chunk_size + x) as usize] = terrain_shape(world_x, world_z, seed) as f32;
        }
    }
    heights
}

/// Генерирует воксели чанка целиком: рельеф с горами (несколько октав
/// шума), пещеры (связный 3D value-noise), руды (hash3d, глубже — реже),
/// вода (заливка низин до уровня моря) и деревья (детерминированные по
/// мировым координатам, поэтому корректно продолжаются через границу
/// чанка).
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

    // 1. Рельеф, камень, пещеры, руды, вода — только в пределах своего чанка.
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
                    let cave_scale = 10.0;
                    let cave = noise3d(
                        world_x / cave_scale,
                        y as f64 / cave_scale,
                        world_z / cave_scale,
                        seed + 1000.0,
                    );
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
                    // Под водой трава не растёт — сверху обычная земля (дно).
                    if height >= WATER_LEVEL {
                        BLOCK_GRASS
                    } else {
                        BLOCK_DIRT
                    }
                } else if y <= WATER_LEVEL {
                    BLOCK_WATER
                } else {
                    BLOCK_AIR
                };

                voxels[idx] = block;
            }
        }
    }

    // 2. Деревья — сканируем с запасом за пределами чанка, чтобы крона
    // соседского дерева корректно "дотягивалась" через границу; хэш дерева
    // завязан на абсолютные мировые координаты, поэтому оба чанка-соседа
    // независимо друг от друга придут к одному и тому же дереву.
    for lz in -TREE_SEARCH_MARGIN..(chunk_size as i32 + TREE_SEARCH_MARGIN) {
        for lx in -TREE_SEARCH_MARGIN..(chunk_size as i32 + TREE_SEARCH_MARGIN) {
            let world_x = origin_x + lx as f64 + 0.5;
            let world_z = origin_z + lz as f64 + 0.5;

            if !tree_exists_at(world_x, world_z, seed) {
                continue;
            }
            let base_height = surface_height(world_x, world_z, seed);
            if base_height < WATER_LEVEL {
                continue; // деревья не растут под водой
            }

            let trunk_h = trunk_height_at(world_x, world_z, seed);
            let trunk_top = base_height + trunk_h;

            for dy in 1..=trunk_h {
                set_voxel(&mut voxels, cs, wh, lx, base_height + dy, lz, BLOCK_OAK_LOG, false);
            }

            // Крона: сплюснутая сфера вокруг верхних слоёв ствола.
            for dy in -2..=2i32 {
                let y = trunk_top + dy;
                let ry = 2.4 - (dy.abs() as f64) * 0.5;
                let r2 = ry * ry;
                for dz in -3..=3i32 {
                    for dx in -3..=3i32 {
                        if (dx * dx + dz * dz) as f64 <= r2 {
                            set_voxel(&mut voxels, cs, wh, lx + dx, y, lz + dz, BLOCK_OAK_LEAVES, true);
                        }
                    }
                }
            }
        }
    }

    voxels
}
