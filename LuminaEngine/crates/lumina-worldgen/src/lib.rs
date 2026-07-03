// CPU-генерация карты высот чанка.
//
// Раньше это считалось на GPU (см. GPUWorldGenerator.js): рендер шейдера в
// текстуру + синхронный readRenderTargetPixels() на каждый чанк, что
// останавливает GPU-конвейер на время чтения. Здесь ровно та же формула
// шума (value noise со сглаживанием smoothstep, как в оригинальном
// фрагментном шейдере), но одним прямым вызовом на CPU — для карты высот
// 8x8 такой ценой можно пренебречь, а стоп-кадра GPU больше нет вообще.

use wasm_bindgen::prelude::*;

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

/// Возвращает карту высот чанка (chunk_size * chunk_size значений в [0,1]),
/// index = z * chunk_size + x — совместимо с прежним GPU-путём.
#[wasm_bindgen]
pub fn generate_height_map(chunk_x: i32, chunk_z: i32, chunk_size: u32, seed: f64) -> Vec<f32> {
    let scale = 50.0f64; // совпадает с `noise(worldPos / 50.0)` в шейдере
    let origin_x = (chunk_x * chunk_size as i32) as f64;
    let origin_z = (chunk_z * chunk_size as i32) as f64;

    let mut heights = vec![0f32; (chunk_size * chunk_size) as usize];
    for z in 0..chunk_size {
        for x in 0..chunk_size {
            // Сэмплируем в центре "пикселя", как раньше делал рендер в текстуру.
            let world_x = origin_x + x as f64 + 0.5;
            let world_z = origin_z + z as f64 + 0.5;
            let h = noise2d(world_x / scale, world_z / scale, seed);
            heights[(z * chunk_size + x) as usize] = h as f32;
        }
    }
    heights
}
