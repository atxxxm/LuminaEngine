// game/worldWorker.js
//
// Фоновый поток генерации и мешинга мира. Тяжёлые WASM-вызовы
// (generate_chunk_voxels, generate_region_mesh) выполняются здесь, вне
// главного потока, чтобы подгрузка регионов не роняла FPS. Возвращает
// типизированные массивы как transferable — без копирования.
//
// Воксельные данные тут НЕ хранятся: главный поток остаётся владельцем
// (физике нужен синхронный getVoxel). Воркер — набор чистых функций.

import initMeshing, { generate_region_mesh } from '../../../engine/wasm/lumina-meshing/lumina_meshing.js';
import initWorldgen, { generate_chunk_voxels } from '../../../engine/wasm/lumina-worldgen/lumina_worldgen.js';

const ready = Promise.all([initMeshing(), initWorldgen()]);
let tables = null; // таблицы материалов блоков (для мешера), присылает main

self.onmessage = async (e) => {
    const m = e.data;
    await ready;

    if (m.type === 'init') {
        tables = m.tables;
        self.postMessage({ type: 'ready' });
        return;
    }

    if (m.type === 'genChunk') {
        const data = generate_chunk_voxels(m.cx, m.cz, m.chunkSize, m.worldHeight, m.seed);
        self.postMessage({ id: m.id, data }, [data.buffer]);
        return;
    }

    if (m.type === 'mesh') {
        const md = generate_region_mesh(
            m.voxels, m.light, m.rw, m.wh, m.rd, m.ox, m.oz,
            tables.isTransparent, tables.top, tables.bottom, tables.side
        );
        const positions = md.positions;
        const normals = md.normals;
        const uvs = md.uvs;
        const colors = md.colors;
        const indices = md.indices;
        const groups = md.groups;
        self.postMessage(
            { id: m.id, positions, normals, uvs, colors, indices, groups },
            [positions.buffer, normals.buffer, uvs.buffer, colors.buffer, indices.buffer, groups.buffer]
        );
        return;
    }
};
