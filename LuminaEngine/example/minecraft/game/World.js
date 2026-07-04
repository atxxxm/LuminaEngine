// game/World.js

import * as THREE from 'three';
import { BLOCK } from './blocks.js';
// WASM-модули нужны и главному потоку: для синхронного фолбэка генерации/
// мешинга (если воркер не поднимется) и для сжатия сохранений.
import initMeshing, { generate_region_mesh } from '../../../engine/wasm/lumina-meshing/lumina_meshing.js';
import initWorldgen, { generate_chunk_voxels } from '../../../engine/wasm/lumina-worldgen/lumina_worldgen.js';
import initSave, { encode_chunk, decode_chunk } from '../../../engine/wasm/lumina-save/lumina_save.js';

await Promise.all([initMeshing(), initWorldgen(), initSave()]);

const CHUNK_SIZE = 8; // Стандартный размер чанка
const WORLD_HEIGHT = 128;
const REGION_SIZE = 4; // 4x4 чанка в одном меше (64x64 блока)
const REGION_BLOCK_SIZE = REGION_SIZE * CHUNK_SIZE;

// Дальность прорисовки в регионах вокруг игрока (render distance).
const RENDER_DISTANCE_REGIONS = 3;
// Сколько регионов запускать в загрузку и сколько перестраивать за кадр —
// само тяжёлое считается в воркере, здесь ограничиваем лишь темп постановки
// задач и сборку геометрии на главном потоке.
const REGIONS_PER_FRAME = 2;
const REMESH_PER_FRAME = 2;

const LIGHT_NEIGHBORS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

// Текстуры и материалы одинаковы для всех регионов и не меняются между
// перестроениями меша, поэтому кэшируем их на уровне модуля.
const textureLoader = new THREE.TextureLoader();
const textureCache = {};
const materialCache = {};

function getMaterial(textureName) {
    if (!materialCache[textureName]) {
        if (!textureCache[textureName]) {
            const texture = textureLoader.load(`textures/${textureName}`);
            texture.magFilter = THREE.NearestFilter;
            texture.minFilter = THREE.NearestFilter;
            // Greedy-мешер сливает соседние одинаковые блоки в один большой
            // квад, поэтому UV может выходить за пределы 0..1 — текстура
            // должна замащиваться (тайлиться), а не растягиваться.
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            textureCache[textureName] = texture;
        }
        const isTransparent = textureName.includes('leaves');
        materialCache[textureName] = new THREE.MeshLambertMaterial({
            map: textureCache[textureName],
            transparent: isTransparent,
            alphaTest: isTransparent ? 0.5 : 0,
            // Свет от факелов приходит как per-vertex цвет из мешера (см.
            // lumina-meshing) — без этого флага он бы тихо игнорировался.
            vertexColors: true,
        });
    }
    return materialCache[textureName];
}

// Для блоков без текстуры (вода/факел): плоский цвет вместо картинки.
function getColorMaterial(colorHex, opacity) {
    const key = `color:${colorHex}`;
    if (!materialCache[key]) {
        const isTransparent = opacity !== undefined && opacity < 1;
        materialCache[key] = new THREE.MeshLambertMaterial({
            color: colorHex,
            transparent: isTransparent,
            opacity: isTransparent ? opacity : 1,
            vertexColors: true,
        });
    }
    return materialCache[key];
}

// Общий на все регионы список материалов + таблицы свойств блоков по id,
// которые передаются в WASM-мешер. Строятся один раз из BLOCK.properties.
const MAX_BLOCK_ID = 256;
const globalMaterials = [];
const materialIndexOf = {};
const isTransparentTable = new Uint8Array(MAX_BLOCK_ID);
const topMaterialTable = new Uint16Array(MAX_BLOCK_ID);
const bottomMaterialTable = new Uint16Array(MAX_BLOCK_ID);
const sideMaterialTable = new Uint16Array(MAX_BLOCK_ID);

function materialIndexForKey(key, factory) {
    if (materialIndexOf[key] === undefined) {
        materialIndexOf[key] = globalMaterials.length;
        globalMaterials.push(factory());
    }
    return materialIndexOf[key];
}

for (const idKey of Object.keys(BLOCK.properties)) {
    const id = Number(idKey);
    const props = BLOCK.properties[id];
    isTransparentTable[id] = props.isTransparent ? 1 : 0;

    let idx;
    if (props.color !== undefined) {
        idx = materialIndexForKey(`color:${props.color}`, () => getColorMaterial(props.color, props.opacity));
    } else if (typeof props.texture === 'object') {
        topMaterialTable[id] = materialIndexForKey(props.texture.top, () => getMaterial(props.texture.top));
        bottomMaterialTable[id] = materialIndexForKey(props.texture.bottom, () => getMaterial(props.texture.bottom));
        sideMaterialTable[id] = materialIndexForKey(props.texture.side, () => getMaterial(props.texture.side));
        continue;
    } else if (props.texture) {
        idx = materialIndexForKey(props.texture, () => getMaterial(props.texture));
    } else {
        continue; // блоки без визуала (воздух)
    }
    topMaterialTable[id] = idx;
    bottomMaterialTable[id] = idx;
    sideMaterialTable[id] = idx;
}

// --- Бэкенды генерации/мешинга -------------------------------------------
// Единый интерфейс: genChunk() -> Promise<Uint8Array>,
// meshRegion() -> Promise<{positions,normals,uvs,colors,indices,groups}>.

// Синхронный фолбэк: считает прямо на главном потоке (как было раньше).
// Работает всегда — используется, пока/если воркер недоступен.
const localBackend = {
    genChunk(cx, cz, seed) {
        return Promise.resolve(generate_chunk_voxels(cx, cz, CHUNK_SIZE, WORLD_HEIGHT, seed));
    },
    meshRegion(voxels, light, rw, wh, rd, ox, oz) {
        const md = generate_region_mesh(
            voxels, light, rw, wh, rd, ox, oz,
            isTransparentTable, topMaterialTable, bottomMaterialTable, sideMaterialTable
        );
        return Promise.resolve({
            positions: md.positions, normals: md.normals, uvs: md.uvs, colors: md.colors,
            indices: md.indices, groups: md.groups,
        });
    },
    dispose() {},
};

// Фоновый воркер: те же задачи, но вне главного потока.
class WorkerBackend {
    constructor(worker) {
        this.worker = worker;
        this.nextId = 1;
        this.pending = new Map();
        this.worker.onmessage = (e) => {
            const m = e.data;
            const cb = this.pending.get(m.id);
            if (cb) { this.pending.delete(m.id); cb(m); }
        };
    }
    genChunk(cx, cz, seed) {
        return new Promise((resolve) => {
            const id = this.nextId++;
            this.pending.set(id, (m) => resolve(m.data));
            this.worker.postMessage({ type: 'genChunk', id, cx, cz, chunkSize: CHUNK_SIZE, worldHeight: WORLD_HEIGHT, seed });
        });
    }
    meshRegion(voxels, light, rw, wh, rd, ox, oz) {
        return new Promise((resolve) => {
            const id = this.nextId++;
            this.pending.set(id, (m) => resolve(m));
            // Передаём буферы воркеру (главному потоку эти временные копии
            // больше не нужны).
            this.worker.postMessage({ type: 'mesh', id, voxels, light, rw, wh, rd, ox, oz }, [voxels.buffer, light.buffer]);
        });
    }
    dispose() {
        this.worker.terminate();
    }
}

// Класс для хранения данных о блоках. Больше не занимается рендерингом.
class Chunk {
    constructor(x, z) {
        this.x = x;
        this.z = z;
        this.data = new Uint8Array(CHUNK_SIZE * WORLD_HEIGHT * CHUNK_SIZE);
        // Уровень света от факелов (0..15) на воксель — отдельный от данных
        // блока канал. Новый чанк всегда начинается тёмным: генератор мира
        // не размещает светящихся блоков, свет появляется только когда
        // игрок ставит факел (см. World.propagateLight).
        this.light = new Uint8Array(CHUNK_SIZE * WORLD_HEIGHT * CHUNK_SIZE);
    }

    getVoxel(x, y, z) {
        if (x < 0 || x >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT || z < 0 || z >= CHUNK_SIZE) {
            return 0; // Air
        }
        const index = y * CHUNK_SIZE * CHUNK_SIZE + z * CHUNK_SIZE + x;
        return this.data[index];
    }

    setVoxel(x, y, z, value) {
        const index = y * CHUNK_SIZE * CHUNK_SIZE + z * CHUNK_SIZE + x;
        this.data[index] = value;
    }

    getLight(x, y, z) {
        if (x < 0 || x >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT || z < 0 || z >= CHUNK_SIZE) {
            return 0;
        }
        const index = y * CHUNK_SIZE * CHUNK_SIZE + z * CHUNK_SIZE + x;
        return this.light[index];
    }

    setLight(x, y, z, value) {
        const index = y * CHUNK_SIZE * CHUNK_SIZE + z * CHUNK_SIZE + x;
        this.light[index] = value;
    }
}

// Регион — «держатель состояния» одного меша (4x4 чанка). Сама сборка
// геометрии живёт в World (нужен доступ к сцене/бэкенду).
class WorldRegion {
    constructor(rx, rz) {
        this.rx = rx;
        this.rz = rz;
        this.mesh = null;
        this.needsUpdate = false; // требуется (пере)построить меш
        this.meshing = false;     // построение меша сейчас в полёте
        this.disposed = false;    // регион выгружен — незавершённые задачи отбросить
    }
}


export class World {
    constructor(scene, seed) {
        this.scene = scene;
        this.chunks = {};
        this.regions = {};
        // ВАЖНО: не `seed || ...` — 0 валидный сид, но falsy.
        this.seed = (seed !== undefined && seed !== null) ? seed : Math.random() * 10000;

        this.streamQueue = [];
        this.lastPlayerRegionKey = null;

        this.disposed = false;
        this.pendingChunks = {}; // key -> Promise генерации чанка (дедупликация)

        // Начинаем на синхронном бэкенде (работает сразу), асинхронно
        // пробуем поднять воркер и «повыситься» до него.
        this.backend = localBackend;
        this._initWorker();
    }

    async _initWorker() {
        try {
            const worker = new Worker(new URL('./worldWorker.js', import.meta.url), { type: 'module' });
            const ok = await new Promise((resolve) => {
                const timer = setTimeout(() => resolve(false), 8000);
                worker.onmessage = (e) => {
                    if (e.data && e.data.type === 'ready') { clearTimeout(timer); resolve(true); }
                };
                worker.onerror = () => { clearTimeout(timer); resolve(false); };
                worker.postMessage({
                    type: 'init',
                    tables: {
                        isTransparent: isTransparentTable,
                        top: topMaterialTable,
                        bottom: bottomMaterialTable,
                        side: sideMaterialTable,
                    },
                });
            });
            if (ok && !this.disposed) {
                this.backend = new WorkerBackend(worker);
            } else {
                worker.terminate();
            }
        } catch (e) {
            // Воркер недоступен (например, ES-модульный воркер по file://) —
            // остаёмся на синхронном бэкенде, всё продолжает работать.
            console.warn('World: воркер недоступен, генерация на главном потоке.', e);
        }
    }

    getChunkKey(x, z) { return `${x},${z}`; }
    getRegionKey(rx, rz) { return `${rx},${rz}`; }

    getChunk(chunkX, chunkZ) {
        return this.chunks[this.getChunkKey(chunkX, chunkZ)];
    }

    getRegion(regionX, regionZ) {
        return this.regions[this.getRegionKey(regionX, regionZ)];
    }

    getVoxel(x, y, z) {
        const chunkX = Math.floor(x / CHUNK_SIZE);
        const chunkZ = Math.floor(z / CHUNK_SIZE);
        const localX = x - chunkX * CHUNK_SIZE;
        const localZ = z - chunkZ * CHUNK_SIZE;
        const chunk = this.getChunk(chunkX, chunkZ);
        if (!chunk) return BLOCK.AIR;
        return chunk.getVoxel(localX, y, localZ);
    }

    setVoxel(x, y, z, value) {
        const chunkX = Math.floor(x / CHUNK_SIZE);
        const chunkZ = Math.floor(z / CHUNK_SIZE);
        const localX = x - chunkX * CHUNK_SIZE;
        const localZ = z - chunkZ * CHUNK_SIZE;
        let chunk = this.getChunk(chunkX, chunkZ);
        if (!chunk) {
            chunk = this.generateChunkData(chunkX, chunkZ);
        }
        if (chunk) {
            const oldValue = chunk.getVoxel(localX, y, localZ);
            chunk.setVoxel(localX, y, localZ, value);
            const regionX = Math.floor(chunkX / REGION_SIZE);
            const regionZ = Math.floor(chunkZ / REGION_SIZE);
            const region = this.getRegion(regionX, regionZ);
            if (region) {
                region.needsUpdate = true;
            }
            this.updateLightAt(x, y, z, oldValue, value);
        }
    }

    // --- Освещение от факелов (BFS, отдельный канал от данных блока) --------
    // Skylight/аmbient остаются глобальными (DayNightCycle) — здесь только
    // локальный свет от светящихся блоков, который ДОБАВЛЯЕТ яркость поверх
    // обычного освещения сцены (см. lumina-meshing: цвет вершины 1.0 + свет).

    getLight(x, y, z) {
        const chunkX = Math.floor(x / CHUNK_SIZE);
        const chunkZ = Math.floor(z / CHUNK_SIZE);
        const chunk = this.getChunk(chunkX, chunkZ);
        if (!chunk) return 0;
        return chunk.getLight(x - chunkX * CHUNK_SIZE, y, z - chunkZ * CHUNK_SIZE);
    }

    // Пишет значение света и помечает владеющий регион (и соседа, если
    // воксель на самой кромке чанка — свет соседнего региона мог измениться
    // на стыке) на перестроение меша. Ничего не делает для незагруженных
    // чанков — свет туда просто не распространяется.
    setLightRaw(x, y, z, value) {
        const chunkX = Math.floor(x / CHUNK_SIZE);
        const chunkZ = Math.floor(z / CHUNK_SIZE);
        const chunk = this.getChunk(chunkX, chunkZ);
        if (!chunk) return;
        const localX = x - chunkX * CHUNK_SIZE;
        const localZ = z - chunkZ * CHUNK_SIZE;
        if (chunk.getLight(localX, y, localZ) === value) return;
        chunk.setLight(localX, y, localZ, value);

        const regionX = Math.floor(chunkX / REGION_SIZE);
        const regionZ = Math.floor(chunkZ / REGION_SIZE);
        const region = this.getRegion(regionX, regionZ);
        if (region) region.needsUpdate = true;
    }

    // BFS-распространение света "наружу" от источника/уже установленного
    // значения. Не заходит в непрозрачные блоки (свет через них не проходит).
    propagateLight(x, y, z, level) {
        this.setLightRaw(x, y, z, level);
        const queue = [[x, y, z, level]];
        while (queue.length) {
            const [cx, cy, cz, clevel] = queue.shift();
            if (clevel <= 1) continue;
            const nextLevel = clevel - 1;
            for (const [dx, dy, dz] of LIGHT_NEIGHBORS) {
                const nx = cx + dx, ny = cy + dy, nz = cz + dz;
                if (!BLOCK.get(this.getVoxel(nx, ny, nz)).isTransparent) continue;
                if (this.getLight(nx, ny, nz) < nextLevel) {
                    this.setLightRaw(nx, ny, nz, nextLevel);
                    queue.push([nx, ny, nz, nextLevel]);
                }
            }
        }
    }

    // "Разсвет": гасит распространённый от (x,y,z) свет и, если по соседству
    // есть независимые источники (свет от них тоже доходил сюда), досвечивает
    // область заново от них. Стандартный алгоритм light removal для
    // voxel-движков (иначе после удаления факела темнота не восстановится
    // корректно — соседние области либо останутся мёртво-тёмными, либо
    // мёртво-светлыми).
    unlight(x, y, z) {
        const level = this.getLight(x, y, z);
        if (level === 0) return;
        this.setLightRaw(x, y, z, 0);

        const removalQueue = [[x, y, z, level]];
        const relightSeeds = [];
        while (removalQueue.length) {
            const [cx, cy, cz, clevel] = removalQueue.shift();
            for (const [dx, dy, dz] of LIGHT_NEIGHBORS) {
                const nx = cx + dx, ny = cy + dy, nz = cz + dz;
                const nl = this.getLight(nx, ny, nz);
                if (nl === 0) continue;
                if (nl < clevel) {
                    this.setLightRaw(nx, ny, nz, 0);
                    removalQueue.push([nx, ny, nz, nl]);
                } else {
                    relightSeeds.push([nx, ny, nz]);
                }
            }
        }
        for (const [rx, ry, rz] of relightSeeds) {
            const current = this.getLight(rx, ry, rz); // могли уже погасить выше в этом же проходе
            if (current > 0) this.propagateLight(rx, ry, rz, current);
        }
    }

    // Реагирует на смену блока в (x,y,z): гасит/распространяет свет исходя
    // из того, был/стал ли блок источником и/или изменил проходимость света.
    updateLightAt(x, y, z, oldBlockId, newBlockId) {
        const oldProps = BLOCK.get(oldBlockId);
        const newProps = BLOCK.get(newBlockId);
        const oldEmits = oldProps.lightLevel || 0;
        const newEmits = newProps.lightLevel || 0;

        if (oldEmits > 0 || (!newProps.isTransparent && this.getLight(x, y, z) > 0)) {
            this.unlight(x, y, z);
        }

        if (newEmits > 0) {
            this.propagateLight(x, y, z, newEmits);
        } else if (!oldProps.isTransparent && newProps.isTransparent) {
            // Открыли ранее непрозрачную клетку (например, сломали камень) —
            // свет соседей может теперь протечь сюда.
            for (const [dx, dy, dz] of LIGHT_NEIGHBORS) {
                const nl = this.getLight(x + dx, y + dy, z + dz);
                if (nl > 1) this.propagateLight(x + dx, y + dy, z + dz, nl);
            }
        }
    }

    // Синхронная генерация данных чанка на главном потоке. Используется для
    // мест, где данные нужны немедленно: bootstrap спавна (findSpawn читает
    // getVoxel сразу) и постановка блока в ещё не сгенерированный чанк.
    generateChunkData(chunkX, chunkZ) {
        const key = this.getChunkKey(chunkX, chunkZ);
        if (this.chunks[key]) return this.chunks[key];

        const chunk = new Chunk(chunkX, chunkZ);
        chunk.data = generate_chunk_voxels(chunkX, chunkZ, CHUNK_SIZE, WORLD_HEIGHT, this.seed);
        this.chunks[key] = chunk;
        return chunk;
    }

    // Гарантирует наличие данных всех чанков региона + рамки в 1 чанк вокруг
    // (для корректного отсечения граней на стыках). Генерация — через бэкенд
    // (воркер, если доступен). Дедупликация через pendingChunks.
    async ensureRegionChunks(rx, rz) {
        const promises = [];
        const startCx = rx * REGION_SIZE - 1;
        const endCx = rx * REGION_SIZE + REGION_SIZE;
        const startCz = rz * REGION_SIZE - 1;
        const endCz = rz * REGION_SIZE + REGION_SIZE;
        for (let cx = startCx; cx <= endCx; cx++) {
            for (let cz = startCz; cz <= endCz; cz++) {
                const key = this.getChunkKey(cx, cz);
                if (this.chunks[key]) continue;
                if (!this.pendingChunks[key]) {
                    this.pendingChunks[key] = this.backend.genChunk(cx, cz, this.seed).then((data) => {
                        if (!this.chunks[key]) {
                            const c = new Chunk(cx, cz);
                            c.data = data;
                            this.chunks[key] = c;
                        }
                        delete this.pendingChunks[key];
                    });
                }
                promises.push(this.pendingChunks[key]);
            }
        }
        if (promises.length) await Promise.all(promises);
    }

    // Собирает воксели и свет региона с рамкой в 1 блок в плоские буферы
    // (свежие — потом передаются воркеру как transferable).
    buildPaddedBuffers(ox, oz, rw, rd) {
        const pw = rw + 2;
        const pd = rd + 2;
        const voxels = new Uint8Array(pw * WORLD_HEIGHT * pd);
        const light = new Uint8Array(pw * WORLD_HEIGHT * pd);
        for (let y = 0; y < WORLD_HEIGHT; y++) {
            for (let lz = -1; lz <= rd; lz++) {
                const row = y * pw * pd + (lz + 1) * pw;
                for (let lx = -1; lx <= rw; lx++) {
                    const idx = row + (lx + 1);
                    voxels[idx] = this.getVoxel(ox + lx, y, oz + lz);
                    light[idx] = this.getLight(ox + lx, y, oz + lz);
                }
            }
        }
        return { voxels, light };
    }

    // Асинхронно строит/перестраивает меш региона через бэкенд.
    async remeshRegion(region) {
        if (region.disposed || region.meshing) return;
        region.needsUpdate = false;
        region.meshing = true;

        const ox = region.rx * REGION_BLOCK_SIZE;
        const oz = region.rz * REGION_BLOCK_SIZE;
        const { voxels, light } = this.buildPaddedBuffers(ox, oz, REGION_BLOCK_SIZE, REGION_BLOCK_SIZE);

        let md;
        try {
            md = await this.backend.meshRegion(voxels, light, REGION_BLOCK_SIZE, WORLD_HEIGHT, REGION_BLOCK_SIZE, ox, oz);
        } finally {
            region.meshing = false;
        }

        if (region.disposed) return; // регион выгрузили, пока строился меш
        this.applyMesh(region, md);

        // Блок могли изменить, пока строился меш — построим ещё раз.
        if (region.needsUpdate) this.remeshRegion(region);
    }

    applyMesh(region, md) {
        if (md.indices.length === 0) {
            if (region.mesh) { this.scene.remove(region.mesh); region.mesh.geometry.dispose(); }
            region.mesh = null;
            return;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(md.positions, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(md.normals, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(md.uvs, 2));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(md.colors, 3));
        geometry.setIndex(new THREE.Uint32BufferAttribute(md.indices, 1));

        const groups = md.groups;
        for (let i = 0; i < groups.length; i += 3) {
            geometry.addGroup(groups[i], groups[i + 1], groups[i + 2]);
        }
        geometry.computeBoundingSphere();

        if (region.mesh) {
            // Материалы общие и переиспользуются — dispose только геометрии.
            this.scene.remove(region.mesh);
            region.mesh.geometry.dispose();
        }
        region.mesh = new THREE.Mesh(geometry, globalMaterials);
        region.mesh.castShadow = true;
        region.mesh.receiveShadow = true;
        this.scene.add(region.mesh);
    }

    // Асинхронная загрузка региона: генерируем его чанки (+рамку) через
    // бэкенд, затем строим меш. Соседние уже загруженные регионы помечаем на
    // перестроение — их граница могла измениться от новых чанков.
    async loadRegion(rx, rz) {
        const key = this.getRegionKey(rx, rz);
        if (this.regions[key]) return;

        const region = new WorldRegion(rx, rz);
        this.regions[key] = region;

        await this.ensureRegionChunks(rx, rz);
        if (region.disposed || this.disposed) return;

        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const n = this.getRegion(rx + dx, rz + dz);
            if (n && n.mesh) n.needsUpdate = true;
        }

        await this.remeshRegion(region);
    }

    unloadRegion(rx, rz) {
        const key = this.getRegionKey(rx, rz);
        const region = this.regions[key];
        if (!region) return;
        region.disposed = true; // незавершённые gen/mesh отбросят результат
        if (region.mesh) {
            this.scene.remove(region.mesh);
            region.mesh.geometry.dispose();
            region.mesh = null;
        }
        delete this.regions[key];
    }

    // Полная выгрузка мира при выходе в меню.
    dispose() {
        this.disposed = true;
        for (const key of Object.keys(this.regions)) {
            const [rx, rz] = key.split(',').map(Number);
            this.unloadRegion(rx, rz);
        }
        this.chunks = {};
        this.regions = {};
        this.streamQueue = [];
        this.pendingChunks = {};
        this.backend.dispose();
    }

    // Область спавна: данные чанков генерируем СИНХРОННО (findSpawn в main.js
    // читает getVoxel сразу после generate()), а меши строятся асинхронно
    // через dirty-цикл в update(). Синхронно генерируем и рамку, чтобы
    // границы спавн-регионов сразу были корректны.
    generate() {
        const r = 1;
        const startC = -r * REGION_SIZE - 1;
        const endC = (r + 1) * REGION_SIZE;
        for (let cx = startC; cx <= endC; cx++) {
            for (let cz = startC; cz <= endC; cz++) {
                this.generateChunkData(cx, cz);
            }
        }
        for (let rx = -r; rx <= r; rx++) {
            for (let rz = -r; rz <= r; rz++) {
                const region = new WorldRegion(rx, rz);
                region.needsUpdate = true;
                this.regions[this.getRegionKey(rx, rz)] = region;
            }
        }
    }

    updateStreaming(playerPosition) {
        if (!playerPosition) return;

        const playerRegionX = Math.floor(playerPosition.x / REGION_BLOCK_SIZE);
        const playerRegionZ = Math.floor(playerPosition.z / REGION_BLOCK_SIZE);
        const currentKey = `${playerRegionX},${playerRegionZ}`;

        if (currentKey !== this.lastPlayerRegionKey) {
            this.lastPlayerRegionKey = currentKey;

            const desired = new Set();
            for (let dx = -RENDER_DISTANCE_REGIONS; dx <= RENDER_DISTANCE_REGIONS; dx++) {
                for (let dz = -RENDER_DISTANCE_REGIONS; dz <= RENDER_DISTANCE_REGIONS; dz++) {
                    const rx = playerRegionX + dx;
                    const rz = playerRegionZ + dz;
                    const key = this.getRegionKey(rx, rz);
                    desired.add(key);
                    if (!this.regions[key] && !this.streamQueue.some(r => r.rx === rx && r.rz === rz)) {
                        this.streamQueue.push({ rx, rz });
                    }
                }
            }

            for (const key of Object.keys(this.regions)) {
                if (!desired.has(key)) {
                    const [rx, rz] = key.split(',').map(Number);
                    this.unloadRegion(rx, rz);
                }
            }
            this.streamQueue = this.streamQueue.filter(r => desired.has(this.getRegionKey(r.rx, r.rz)));
        }

        for (let i = 0; i < REGIONS_PER_FRAME && this.streamQueue.length > 0; i++) {
            const { rx, rz } = this.streamQueue.shift();
            this.loadRegion(rx, rz).catch((e) => console.error('loadRegion:', e));
        }
    }

    update(deltaTime, playerPosition) {
        // Перестройка «грязных» регионов, с ограничением на кадр.
        let remeshed = 0;
        for (const key in this.regions) {
            if (remeshed >= REMESH_PER_FRAME) break;
            const region = this.regions[key];
            if (region.needsUpdate && !region.meshing && !region.disposed) {
                this.remeshRegion(region).catch((e) => console.error('remeshRegion:', e));
                remeshed++;
            }
        }
        this.updateStreaming(playerPosition);
    }

    getData() {
        const data = {};
        for (const key in this.chunks) {
            data[key] = Array.from(encode_chunk(this.chunks[key].data));
        }
        return { seed: this.seed, chunks: data };
    }

    loadData(data) {
        this.seed = data.seed;
        this.chunks = {};
        this.regions = {};

        const chunkVoxelCount = CHUNK_SIZE * WORLD_HEIGHT * CHUNK_SIZE;
        for (const key in data.chunks) {
            const [x, z] = key.split(',').map(Number);
            const chunk = new Chunk(x, z);
            chunk.data = decode_chunk(new Uint8Array(data.chunks[key]), chunkVoxelCount);
            this.chunks[key] = chunk;

            const regionX = Math.floor(x / REGION_SIZE);
            const regionZ = Math.floor(z / REGION_SIZE);
            const regionKey = this.getRegionKey(regionX, regionZ);
            if (!this.regions[regionKey]) {
                const region = new WorldRegion(regionX, regionZ);
                region.needsUpdate = true;
                this.regions[regionKey] = region;
            }
        }
    }
}
