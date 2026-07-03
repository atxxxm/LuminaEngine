// RLE-сжатие данных чанка для сохранения мира.
//
// World.getData() раньше клал в JSON `Array.from(chunk.data)` — обычный JS
// массив из 8192 чисел на чанк, из которых подавляющее большинство —
// длинные одинаковые пробеги (воздух над рельефом, камень под ним,
// бедрок на y=0 — это целые слои 8x8 одного значения подряд, так как y —
// старший индекс в data). RLE сжимает такие пробеги до пары (значение,
// длина) и на типичном чанке даёт сокращение в десятки-сотни раз — и по
// размеру сохранения, и по времени JSON.stringify/parse (массив короче на
// столько же порядков).

use wasm_bindgen::prelude::*;

fn write_varint(out: &mut Vec<u8>, mut v: u32) {
    loop {
        let byte = (v & 0x7f) as u8;
        v >>= 7;
        if v != 0 {
            out.push(byte | 0x80);
        } else {
            out.push(byte);
            break;
        }
    }
}

fn read_varint(data: &[u8], pos: &mut usize) -> u32 {
    let mut result: u32 = 0;
    let mut shift = 0;
    loop {
        let byte = data[*pos];
        *pos += 1;
        result |= ((byte & 0x7f) as u32) << shift;
        if byte & 0x80 == 0 {
            break;
        }
        shift += 7;
    }
    result
}

/// Кодирует байты чанка как последовательность пар (значение: u8,
/// varint(длина_пробега - 1)).
#[wasm_bindgen]
pub fn encode_chunk(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < data.len() {
        let value = data[i];
        let mut run = 1usize;
        while i + run < data.len() && data[i + run] == value {
            run += 1;
        }
        out.push(value);
        write_varint(&mut out, (run - 1) as u32);
        i += run;
    }
    out
}

/// Восстанавливает исходные байты чанка из результата encode_chunk().
#[wasm_bindgen]
pub fn decode_chunk(encoded: &[u8], expected_len: u32) -> Vec<u8> {
    let mut out = Vec::with_capacity(expected_len as usize);
    let mut pos = 0;
    while pos < encoded.len() {
        let value = encoded[pos];
        pos += 1;
        let run_len = read_varint(encoded, &mut pos) as usize + 1;
        out.resize(out.len() + run_len, value);
    }
    out
}
