/* tslint:disable */
/* eslint-disable */

/**
 * Генерирует воксели чанка целиком: рельеф с горами (несколько октав
 * шума), пещеры (связный 3D value-noise), руды (hash3d, глубже — реже),
 * вода (заливка низин до уровня моря) и деревья (детерминированные по
 * мировым координатам, поэтому корректно продолжаются через границу
 * чанка).
 *
 * Возвращает массив длиной chunk_size * world_height * chunk_size,
 * index = y*chunk_size*chunk_size + z*chunk_size + x — совпадает с
 * раскладкой Chunk.data в game/World.js.
 */
export function generate_chunk_voxels(chunk_x: number, chunk_z: number, chunk_size: number, world_height: number, seed: number): Uint8Array;

/**
 * Возвращает карту высот чанка (chunk_size * chunk_size значений в [0,1]),
 * index = z * chunk_size + x.
 */
export function generate_height_map(chunk_x: number, chunk_z: number, chunk_size: number, seed: number): Float32Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly generate_chunk_voxels: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly generate_height_map: (a: number, b: number, c: number, d: number) => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
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
