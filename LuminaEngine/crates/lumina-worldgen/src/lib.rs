// CPU-генерация чанка: биомы, рельеф (сплайны), пещеры, руды, вода, деревья.
//
// Полностью на настоящем градиентном шуме Перлина с перестановочной
// таблицей, засеянной от seed мира (а не sin-хэше, как было раньше — тот
// давал вырожденные точки и «блобистый» вид, и из-за него все миры были
// похожи у спавна). Идея близка к тому, как устроен современный Minecraft:
// несколько низкочастотных «каналов» шума (continentalness, erosion,
// temperature, humidity) задают высоту через сплайн и выбор биома, плюс
// 3D-шум для пещер.
//
// generate_chunk_voxels() отдаёт готовый чанк (id блоков) — вся логика
// «какой блок здесь» в Rust, JS только забирает буфер.

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
const BLOCK_SAND: u8 = 10;
const BLOCK_SNOW: u8 = 11;

const WATER_LEVEL: i32 = 45;

// ---------------------------------------------------------------------------
// Шум Перлина (improved Perlin noise, Ken Perlin) с seeded permutation.
// ---------------------------------------------------------------------------

struct Perlin {
    perm: [u8; 512],
}

fn fade(t: f64) -> f64 {
    t * t * t * (t * (t * 6.0 - 15.0) + 10.0)
}

fn lerp(t: f64, a: f64, b: f64) -> f64 {
    a + t * (b - a)
}

fn grad(hash: u8, x: f64, y: f64, z: f64) -> f64 {
    let h = hash & 15;
    let u = if h < 8 { x } else { y };
    let v = if h < 4 {
        y
    } else if h == 12 || h == 14 {
        x
    } else {
        z
    };
    (if h & 1 == 0 { u } else { -u }) + (if h & 2 == 0 { v } else { -v })
}

impl Perlin {
    fn new(seed: u64) -> Self {
        let mut p: [u8; 256] = core::array::from_fn(|i| i as u8);
        // xorshift64, засеянный от seed — перемешиваем таблицу (Fisher–Yates).
        let mut rng = seed ^ 0x9E3779B97F4A7C15;
        if rng == 0 {
            rng = 0xDEAD_BEEF;
        }
        let mut next = || {
            rng ^= rng << 13;
            rng ^= rng >> 7;
            rng ^= rng << 17;
            rng
        };
        for i in (1..256).rev() {
            let j = (next() % (i as u64 + 1)) as usize;
            p.swap(i, j);
        }
        let mut perm = [0u8; 512];
        for i in 0..512 {
            perm[i] = p[i & 255];
        }
        Perlin { perm }
    }

    fn noise3(&self, x: f64, y: f64, z: f64) -> f64 {
        let xi = (x.floor() as i32 & 255) as usize;
        let yi = (y.floor() as i32 & 255) as usize;
        let zi = (z.floor() as i32 & 255) as usize;
        let xf = x - x.floor();
        let yf = y - y.floor();
        let zf = z - z.floor();
        let u = fade(xf);
        let v = fade(yf);
        let w = fade(zf);
        let p = &self.perm;

        let a = p[xi] as usize + yi;
        let aa = p[a] as usize + zi;
        let ab = p[a + 1] as usize + zi;
        let b = p[xi + 1] as usize + yi;
        let ba = p[b] as usize + zi;
        let bb = p[b + 1] as usize + zi;

        lerp(
            w,
            lerp(
                v,
                lerp(u, grad(p[aa], xf, yf, zf), grad(p[ba], xf - 1.0, yf, zf)),
                lerp(
                    u,
                    grad(p[ab], xf, yf - 1.0, zf),
                    grad(p[bb], xf - 1.0, yf - 1.0, zf),
                ),
            ),
            lerp(
                v,
                lerp(
                    u,
                    grad(p[aa + 1], xf, yf, zf - 1.0),
                    grad(p[ba + 1], xf - 1.0, yf, zf - 1.0),
                ),
                lerp(
                    u,
                    grad(p[ab + 1], xf, yf - 1.0, zf - 1.0),
                    grad(p[bb + 1], xf - 1.0, yf - 1.0, zf - 1.0),
                ),
            ),
        )
    }

    fn noise2(&self, x: f64, y: f64) -> f64 {
        // z=0.5 — избегаем целочисленной плоскости, где Перлин даёт 0.
        self.noise3(x, y, 0.5)
    }

    // Фрактальный шум (FBM): сумма октав, результат ~[-1, 1].
    fn fbm2(&self, x: f64, y: f64, octaves: u32, lacunarity: f64, gain: f64) -> f64 {
        let mut freq = 1.0;
        let mut amp = 1.0;
        let mut sum = 0.0;
        let mut norm = 0.0;
        for _ in 0..octaves {
            sum += amp * self.noise2(x * freq, y * freq);
            norm += amp;
            freq *= lacunarity;
            amp *= gain;
        }
        sum / norm
    }
}

// Целочисленный хэш (не sin) для точечной случайности: руды, деревья.
fn hash_u32(mut a: u32) -> u32 {
    a ^= a >> 16;
    a = a.wrapping_mul(0x7feb352d);
    a ^= a >> 15;
    a = a.wrapping_mul(0x846ca68b);
    a ^= a >> 16;
    a
}

fn voxel_rand(x: i32, y: i32, z: i32, seed: u32, salt: u32) -> f64 {
    let h = hash_u32(
        (x as u32)
            .wrapping_mul(73856093)
            ^ (y as u32).wrapping_mul(19349663)
            ^ (z as u32).wrapping_mul(83492791)
            ^ seed
            ^ salt,
    );
    h as f64 / u32::MAX as f64
}

// Кусочно-линейный сплайн: сопоставляет x набору контрольных точек (по
// возрастанию x). Так continentalness → базовая высота с выраженными
// режимами (океан/побережье/равнина/горы), а не линейной кашей.
fn spline(x: f64, points: &[(f64, f64)]) -> f64 {
    if x <= points[0].0 {
        return points[0].1;
    }
    let last = points.len() - 1;
    if x >= points[last].0 {
        return points[last].1;
    }
    for i in 0..last {
        let (x0, y0) = points[i];
        let (x1, y1) = points[i + 1];
        if x >= x0 && x <= x1 {
            let t = (x - x0) / (x1 - x0);
            return y0 + t * (y1 - y0);
        }
    }
    points[last].1
}

// ---------------------------------------------------------------------------
// Биомы
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq)]
enum Biome {
    Ocean,
    Beach,
    Desert,
    Plains,
    Forest,
    Snowy,
    Mountains,
}

struct ColumnInfo {
    height: i32,
    biome: Biome,
}

const HEIGHT_SPLINE: &[(f64, f64)] = &[
    (-1.0, 18.0),
    (-0.5, 34.0),
    (-0.2, 44.0),
    (0.0, 50.0),
    (0.25, 62.0),
    (0.5, 82.0),
    (0.8, 105.0),
    (1.0, 122.0),
];

fn column_info(perlin: &Perlin, wx: f64, wz: f64) -> ColumnInfo {
    // Каждый канал сэмплируется на своей частоте и со своим смещением —
    // так они декоррелированы, хотя используют одну perm-таблицу.
    let continentalness = perlin.fbm2(wx / 400.0, wz / 400.0, 4, 2.0, 0.5);
    let erosion = perlin.fbm2(wx / 300.0 + 1000.0, wz / 300.0 + 1000.0, 3, 2.0, 0.5);
    let temperature = perlin.fbm2(wx / 500.0 + 5000.0, wz / 500.0, 2, 2.0, 0.5);
    let humidity = perlin.fbm2(wx / 500.0, wz / 500.0 + 5000.0, 2, 2.0, 0.5);
    let detail = perlin.fbm2(wx / 40.0 + 2000.0, wz / 40.0 + 2000.0, 4, 2.0, 0.5);

    let base = spline(continentalness, HEIGHT_SPLINE);
    // Высокая эрозия → более плоско (амплитуда деталей меньше).
    let roughness = spline(erosion, &[(-1.0, 1.0), (0.0, 0.5), (1.0, 0.15)]);
    let height = (base + detail * 18.0 * roughness).round() as i32;
    let height = height.clamp(5, 118);

    let biome = if height <= WATER_LEVEL {
        Biome::Ocean
    } else if height <= WATER_LEVEL + 2 {
        Biome::Beach
    } else if height >= 100 {
        Biome::Mountains
    } else if temperature > 0.35 && humidity < -0.1 {
        Biome::Desert
    } else if temperature < -0.35 {
        Biome::Snowy
    } else if humidity > 0.2 {
        Biome::Forest
    } else {
        Biome::Plains
    };

    ColumnInfo { height, biome }
}

// Блок поверхности (y == height).
fn surface_block(biome: Biome, height: i32) -> u8 {
    match biome {
        Biome::Ocean | Biome::Beach | Biome::Desert => BLOCK_SAND,
        Biome::Snowy => BLOCK_SNOW,
        Biome::Mountains => {
            if height >= 108 {
                BLOCK_SNOW
            } else {
                BLOCK_STONE
            }
        }
        Biome::Plains | Biome::Forest => BLOCK_GRASS,
    }
}

// Блок под поверхностью (несколько слоёв над камнем).
fn filler_block(biome: Biome) -> u8 {
    match biome {
        Biome::Ocean | Biome::Beach | Biome::Desert => BLOCK_SAND,
        Biome::Mountains => BLOCK_STONE,
        _ => BLOCK_DIRT,
    }
}

// Плотность деревьев по биому (доля колонн с деревом). 0 — деревьев нет.
fn tree_density(biome: Biome) -> f64 {
    match biome {
        Biome::Forest => 0.06,
        Biome::Plains => 0.008,
        _ => 0.0,
    }
}

const TREE_TRUNK_MIN: i32 = 4;
const TREE_TRUNK_MAX: i32 = 6;
const TREE_SEARCH_MARGIN: i32 = 3;

fn is_cave(perlin: &Perlin, wx: f64, y: f64, wz: f64) -> bool {
    // «Сырные» пещеры — крупные полости из низкочастотного 3D-шума.
    let cheese = perlin.noise3(wx / 32.0, y / 24.0, wz / 32.0);
    if cheese > 0.55 {
        return true;
    }
    // «Спагетти» — тонкие тоннели: пересечение двух ridged-полей у нуля.
    let s1 = perlin.noise3(wx / 16.0 + 100.0, y / 16.0, wz / 16.0);
    let s2 = perlin.noise3(wx / 16.0, y / 16.0, wz / 16.0 + 100.0);
    s1.abs() < 0.06 && s2.abs() < 0.06
}

#[allow(clippy::too_many_arguments)]
fn set_local(
    voxels: &mut [u8],
    cs: usize,
    wh: usize,
    lx: i32,
    y: i32,
    lz: i32,
    block: u8,
    only_if_air: bool,
) {
    if lx < 0 || lx >= cs as i32 || lz < 0 || lz >= cs as i32 || y < 0 || y >= wh as i32 {
        return;
    }
    let idx = (y as usize) * cs * cs + (lz as usize) * cs + (lx as usize);
    if only_if_air && voxels[idx] != BLOCK_AIR {
        return;
    }
    voxels[idx] = block;
}

/// Генерирует воксели чанка целиком.
///
/// Раскладка: index = y*chunk_size*chunk_size + z*chunk_size + x — совпадает
/// с Chunk.data в game/World.js.
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
    let origin_x = chunk_x * chunk_size as i32;
    let origin_z = chunk_z * chunk_size as i32;

    // to_bits() даёт уникальные биты для каждого f64-seed (в т.ч.
    // отрицательных/дробных) — надёжнее, чем `as u64` (тот обнуляет минус).
    let seed_bits = seed.to_bits();
    let seed_u32 = (seed_bits ^ (seed_bits >> 32)) as u32;
    let perlin = Perlin::new(seed_bits);

    let mut voxels = vec![0u8; cs * wh * cs];

    // 1. Колонны: рельеф, камень, пещеры, руды, поверхность, вода.
    for z in 0..chunk_size {
        for x in 0..chunk_size {
            let wx = (origin_x + x as i32) as f64 + 0.5;
            let wz = (origin_z + z as i32) as f64 + 0.5;
            let col = column_info(&perlin, wx, wz);
            let height = col.height;
            let filler = filler_block(col.biome);
            let surface = surface_block(col.biome, height);

            for y in 0..world_height as i32 {
                let idx = (y as usize) * cs * cs + (z as usize) * cs + x as usize;

                let block = if y == 0 {
                    BLOCK_BEDROCK
                } else if y < height - 3 {
                    // Толща камня: пещеры вырезаем не у бедрока и не вплотную
                    // под поверхностью.
                    if y > 2 && y < height - 5 && is_cave(&perlin, wx, y as f64, wz) {
                        BLOCK_AIR
                    } else {
                        let coal = voxel_rand(origin_x + x as i32, y, origin_z + z as i32, seed_u32, 0xC0A1);
                        let iron = voxel_rand(origin_x + x as i32, y, origin_z + z as i32, seed_u32, 0x1201);
                        if coal < 0.03 {
                            BLOCK_COAL_ORE
                        } else if y < height - 15 && iron < 0.02 {
                            BLOCK_IRON_ORE
                        } else {
                            BLOCK_STONE
                        }
                    }
                } else if y < height {
                    filler
                } else if y == height {
                    surface
                } else if y <= WATER_LEVEL {
                    BLOCK_WATER
                } else {
                    BLOCK_AIR
                };

                voxels[idx] = block;
            }
        }
    }

    // 2. Деревья — сканируем с запасом за границей чанка, чтобы крона
    // соседнего дерева корректно продолжалась внутрь. Хэш дерева завязан
    // на мировые координаты, поэтому оба соседних чанка приходят к одному
    // результату.
    for lz in -TREE_SEARCH_MARGIN..(chunk_size as i32 + TREE_SEARCH_MARGIN) {
        for lx in -TREE_SEARCH_MARGIN..(chunk_size as i32 + TREE_SEARCH_MARGIN) {
            let world_x = origin_x + lx;
            let world_z = origin_z + lz;
            let wx = world_x as f64 + 0.5;
            let wz = world_z as f64 + 0.5;
            let col = column_info(&perlin, wx, wz);

            let density = tree_density(col.biome);
            if density <= 0.0 {
                continue;
            }
            if voxel_rand(world_x, 0, world_z, seed_u32, 0x77EE) >= density {
                continue;
            }
            if col.height < WATER_LEVEL + 1 {
                continue;
            }

            let trunk_range = (TREE_TRUNK_MAX - TREE_TRUNK_MIN + 1) as f64;
            let trunk_h = TREE_TRUNK_MIN
                + (voxel_rand(world_x, 1, world_z, seed_u32, 0x7701) * trunk_range) as i32;
            let base = col.height;
            let trunk_top = base + trunk_h;

            for dy in 1..=trunk_h {
                set_local(&mut voxels, cs, wh, lx, base + dy, lz, BLOCK_OAK_LOG, false);
            }
            for dy in -2..=2i32 {
                let y = trunk_top + dy;
                let ry = 2.4 - (dy.abs() as f64) * 0.5;
                let r2 = ry * ry;
                for dz in -3..=3i32 {
                    for dx in -3..=3i32 {
                        if (dx * dx + dz * dz) as f64 <= r2 {
                            set_local(&mut voxels, cs, wh, lx + dx, y, lz + dz, BLOCK_OAK_LEAVES, true);
                        }
                    }
                }
            }
        }
    }

    voxels
}
