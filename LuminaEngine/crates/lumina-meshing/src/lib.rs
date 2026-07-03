// Greedy-мешер для регионов вокселей LuminaCraft.
//
// Заменяет наивный перебор "по вокселю" в World.js (6 проверок соседей на
// каждый непустой блок) на классический greedy-meshing: для каждой из 6
// граней-направлений строится 2D-маска видимых граней на срезе, после чего
// соседние ячейки с одинаковым материалом сливаются в один прямоугольник.
// Алгоритм — стандартный (см. https://0fps.net/2012/06/30/meshing-in-a-minecraft-game/),
// адаптированный под то, что у нас на одной границе могут быть видны ОБЕ
// стороны сразу (соседние полупрозрачные блоки, например листва рядом с
// листвой) — поэтому вместо одной маски со знаком используются две
// независимые маски (front/back).

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct MeshData {
    positions: Vec<f32>,
    normals: Vec<f32>,
    uvs: Vec<f32>,
    indices: Vec<u32>,
    // Плоский список троек (start, count, materialIndex) — как аргументы
    // THREE.BufferGeometry.addGroup().
    groups: Vec<u32>,
}

#[wasm_bindgen]
impl MeshData {
    #[wasm_bindgen(getter)]
    pub fn positions(&self) -> Vec<f32> {
        self.positions.clone()
    }
    #[wasm_bindgen(getter)]
    pub fn normals(&self) -> Vec<f32> {
        self.normals.clone()
    }
    #[wasm_bindgen(getter)]
    pub fn uvs(&self) -> Vec<f32> {
        self.uvs.clone()
    }
    #[wasm_bindgen(getter)]
    pub fn indices(&self) -> Vec<u32> {
        self.indices.clone()
    }
    #[wasm_bindgen(getter)]
    pub fn groups(&self) -> Vec<u32> {
        self.groups.clone()
    }
}

struct Builder {
    positions: Vec<f32>,
    normals: Vec<f32>,
    uvs: Vec<f32>,
    indices: Vec<u32>,
    groups: Vec<u32>,
    last_material: Option<u32>,
}

impl Builder {
    fn new() -> Self {
        Self {
            positions: Vec::new(),
            normals: Vec::new(),
            uvs: Vec::new(),
            indices: Vec::new(),
            groups: Vec::new(),
            last_material: None,
        }
    }

    fn push_quad(
        &mut self,
        p0: [f32; 3],
        p1: [f32; 3],
        p2: [f32; 3],
        p3: [f32; 3],
        normal: [f32; 3],
        w: f32,
        h: f32,
        back: bool,
        material: u32,
        swap_uv: bool,
    ) {
        let base = (self.positions.len() / 3) as u32;
        for p in [p0, p1, p2, p3] {
            self.positions.extend_from_slice(&p);
            self.normals.extend_from_slice(&normal);
        }
        // UV растягивается на w x h блоков — материал должен использовать
        // RepeatWrapping, иначе текстура просто растянется на весь квад.
        //
        // swap_uv: для граней вдоль оси X наш "u"-параметр (ширина w) — это
        // мировая вертикаль (Y), а текстурная U-ось по умолчанию должна
        // соответствовать горизонтали изображения. Без свопа вертикаль
        // блока попадала бы в U вместо V, и направленные текстуры (кора
        // бревна) выглядели бы повёрнутыми на 90°.
        if swap_uv {
            self.uvs.extend_from_slice(&[0.0, 0.0, 0.0, w, h, w, h, 0.0]);
        } else {
            self.uvs.extend_from_slice(&[0.0, 0.0, w, 0.0, w, h, 0.0, h]);
        }

        let tri: [u32; 6] = if !back {
            [base, base + 1, base + 2, base, base + 2, base + 3]
        } else {
            [base, base + 2, base + 1, base, base + 3, base + 2]
        };
        self.indices.extend_from_slice(&tri);

        if self.last_material == Some(material) {
            let n = self.groups.len();
            self.groups[n - 2] += 6;
        } else {
            self.groups.push((self.indices.len() - 6) as u32);
            self.groups.push(6);
            self.groups.push(material);
            self.last_material = Some(material);
        }
    }
}

/// Строит меш одного региона.
///
/// `voxels` — плоский массив вокселей региона, дополненный по X и Z рамкой
/// в 1 блок с каждой стороны (нужна для корректного отсечения граней на
/// стыке с соседними регионами): размер (width+2) * height * (depth+2),
/// индекс = y*(width+2)*(depth+2) + (z+1)*(width+2) + (x+1).
///
/// `is_transparent` / `top_material` / `bottom_material` / `side_material` —
/// таблицы по block id (индекс = id вокселя), построенные один раз на JS
/// стороне из BLOCK.properties.
#[wasm_bindgen]
pub fn generate_region_mesh(
    voxels: &[u8],
    width: u32,
    height: u32,
    depth: u32,
    origin_x: f32,
    origin_z: f32,
    is_transparent: &[u8],
    top_material: &[u16],
    bottom_material: &[u16],
    side_material: &[u16],
) -> MeshData {
    let width = width as i32;
    let height = height as i32;
    let depth = depth as i32;
    let pw = (width + 2) as usize;
    let pd = (depth + 2) as usize;

    let get = |lx: i32, ly: i32, lz: i32| -> u8 {
        if ly < 0 || ly >= height {
            return 0; // за пределами мира по высоте — воздух
        }
        let idx = (ly as usize) * pw * pd + ((lz + 1) as usize) * pw + (lx + 1) as usize;
        voxels[idx]
    };

    let transparent =
        |id: u8| -> bool { is_transparent.get(id as usize).copied().unwrap_or(0) != 0 };

    let material_for = |id: u8, axis: usize, positive: bool| -> u32 {
        let table = if axis == 1 {
            if positive {
                top_material
            } else {
                bottom_material
            }
        } else {
            side_material
        };
        table.get(id as usize).copied().unwrap_or(0) as u32
    };

    let mut b = Builder::new();
    let dims = [width, height, depth];

    for d in 0..3usize {
        let u = (d + 1) % 3;
        let v = (d + 2) % 3;
        let un = dims[u] as usize;
        let vn = dims[v] as usize;

        let mut front_mask = vec![0u32; un * vn];
        let mut back_mask = vec![0u32; un * vn];

        let mut x = [0i32; 3];
        x[d] = -1;
        while x[d] < dims[d] {
            let mut n = 0usize;
            for jv in 0..dims[v] {
                x[v] = jv;
                for iu in 0..dims[u] {
                    x[u] = iu;
                    let a = get(x[0], x[1], x[2]);
                    let mut xb = x;
                    xb[d] += 1;
                    let bv = get(xb[0], xb[1], xb[2]);

                    front_mask[n] = if a != 0 && transparent(bv) {
                        material_for(a, d, true) + 1
                    } else {
                        0
                    };
                    back_mask[n] = if bv != 0 && transparent(a) {
                        material_for(bv, d, false) + 1
                    } else {
                        0
                    };

                    n += 1;
                }
            }

            x[d] += 1;
            let plane = x[d];

            merge_and_emit(&mut b, &front_mask, un, vn, d, u, v, plane, false);
            merge_and_emit(&mut b, &back_mask, un, vn, d, u, v, plane, true);
        }
    }

    // Смещение региона в мировых координатах (по Y смещения нет — высота
    // столбца всегда абсолютна).
    let mut i = 0;
    while i < b.positions.len() {
        b.positions[i] += origin_x;
        b.positions[i + 2] += origin_z;
        i += 3;
    }

    MeshData {
        positions: b.positions,
        normals: b.normals,
        uvs: b.uvs,
        indices: b.indices,
        groups: b.groups,
    }
}

#[allow(clippy::too_many_arguments)]
fn merge_and_emit(
    b: &mut Builder,
    mask: &[u32],
    un: usize,
    vn: usize,
    d: usize,
    u: usize,
    v: usize,
    plane: i32,
    back: bool,
) {
    let mut mask = mask.to_vec();

    for j in 0..vn {
        let mut i = 0usize;
        while i < un {
            let n = j * un + i;
            let material = mask[n];
            if material == 0 {
                i += 1;
                continue;
            }

            let mut w = 1usize;
            while i + w < un && mask[n + w] == material {
                w += 1;
            }

            let mut h = 1usize;
            loop {
                if j + h >= vn {
                    break;
                }
                let mut row_matches = true;
                for k in 0..w {
                    if mask[n + k + h * un] != material {
                        row_matches = false;
                        break;
                    }
                }
                if !row_matches {
                    break;
                }
                h += 1;
            }

            let mut p0 = [0f32; 3];
            p0[d] = plane as f32;
            p0[u] = i as f32;
            p0[v] = j as f32;

            let mut p1 = p0;
            p1[u] += w as f32;
            let mut p3 = p0;
            p3[v] += h as f32;
            let mut p2 = p0;
            p2[u] += w as f32;
            p2[v] += h as f32;

            let mut normal = [0f32; 3];
            normal[d] = if back { -1.0 } else { 1.0 };

            b.push_quad(p0, p1, p2, p3, normal, w as f32, h as f32, back, material - 1, d == 0);

            for l in 0..h {
                for k in 0..w {
                    mask[n + k + l * un] = 0;
                }
            }
            i += w;
        }
    }
}
