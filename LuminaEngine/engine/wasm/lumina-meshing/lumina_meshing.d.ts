/* tslint:disable */
/* eslint-disable */

export class MeshData {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly groups: Uint32Array;
    readonly indices: Uint32Array;
    readonly normals: Float32Array;
    readonly positions: Float32Array;
    readonly uvs: Float32Array;
}

/**
 * Строит меш одного региона.
 *
 * `voxels` — плоский массив вокселей региона, дополненный по X и Z рамкой
 * в 1 блок с каждой стороны (нужна для корректного отсечения граней на
 * стыке с соседними регионами): размер (width+2) * height * (depth+2),
 * индекс = y*(width+2)*(depth+2) + (z+1)*(width+2) + (x+1).
 *
 * `is_transparent` / `top_material` / `bottom_material` / `side_material` —
 * таблицы по block id (индекс = id вокселя), построенные один раз на JS
 * стороне из BLOCK.properties.
 */
export function generate_region_mesh(voxels: Uint8Array, width: number, height: number, depth: number, origin_x: number, origin_z: number, is_transparent: Uint8Array, top_material: Uint16Array, bottom_material: Uint16Array, side_material: Uint16Array): MeshData;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_meshdata_free: (a: number, b: number) => void;
    readonly generate_region_mesh: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number) => number;
    readonly meshdata_groups: (a: number) => [number, number];
    readonly meshdata_indices: (a: number) => [number, number];
    readonly meshdata_normals: (a: number) => [number, number];
    readonly meshdata_positions: (a: number) => [number, number];
    readonly meshdata_uvs: (a: number) => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
