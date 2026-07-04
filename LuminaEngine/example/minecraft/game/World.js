// game/World.js

import * as THREE from 'three';
import { BLOCK } from './blocks.js';
// --- ДОБАВЛЕНО: Rust/WASM greedy-мешер вокселей ---
import initMeshing, { generate_region_mesh } from '../../../engine/wasm/lumina-meshing/lumina_meshing.js';
// --- ДОБАВЛЕНО: Rust/WASM генератор карты высот (раньше — синхронный GPU readback) ---
import initWorldgen, { generate_chunk_voxels } from '../../../engine/wasm/lumina-worldgen/lumina_worldgen.js';
// --- ДОБАВЛЕНО: Rust/WASM RLE-сжатие данных чанков для сохранения мира ---
import initSave, { encode_chunk, decode_chunk } from '../../../engine/wasm/lumina-save/lumina_save.js';

await Promise.all([initMeshing(), initWorldgen(), initSave()]);

const CHUNK_SIZE = 8; // Стандартный размер чанка
const WORLD_HEIGHT = 128;
const REGION_SIZE = 4; // 4x4 чанка в одном меше (64x64 блока)
const REGION_BLOCK_SIZE = REGION_SIZE * CHUNK_SIZE;

// Дальность прорисовки в регионах вокруг игрока (как render distance в
// Minecraft, только в единицах региона, а не чанка) — регионы за этой
// границей выгружаются (меш убирается из сцены), в неё — догружаются.
const RENDER_DISTANCE_REGIONS = 3;
// Не грузим все недостающие регионы за один кадр при пересечении границы —
// размазываем по кадрам, чтобы не просело FPS.
const REGIONS_PER_FRAME = 1;

// Текстуры и материалы одинаковы для всех регионов и не меняются между
// перестроениями меша, поэтому кэшируем их на уровне модуля, а не создаём
// заново при каждом вызове generateMesh().
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
            alphaTest: isTransparent ? 0.5 : 0
        });
    }
    return materialCache[textureName];
}

// Для блоков без текстуры (сейчас — вода): плоский полупрозрачный цвет
// вместо картинки.
function getColorMaterial(colorHex, opacity) {
    const key = `color:${colorHex}`;
    if (!materialCache[key]) {
        materialCache[key] = new THREE.MeshLambertMaterial({
            color: colorHex,
            transparent: true,
            opacity: opacity === undefined ? 1 : opacity,
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
        continue; // блоки без визуала (воздух) никогда не станут "твёрдой стороной" грани
    }
    topMaterialTable[id] = idx;
    bottomMaterialTable[id] = idx;
    sideMaterialTable[id] = idx;
}

// Класс для хранения данных о блоках. Больше не занимается рендерингом.
class Chunk {
    constructor(x, z) {
        this.x = x;
        this.z = z;
        this.data = new Uint8Array(CHUNK_SIZE * WORLD_HEIGHT * CHUNK_SIZE);
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
}

// Новый класс для управления одним большим мешем, объединяющим несколько чанков
class WorldRegion {
    constructor(rx, rz, world) {
        this.rx = rx; // Координаты региона
        this.rz = rz;
        this.world = world;
        this.mesh = null;
        this.needsUpdate = false;
    }

    // Собирает воксели региона (с рамкой в 1 блок по X/Z для корректного
    // отсечения граней на стыке с соседними регионами) в плоский буфер и
    // передаёт его в WASM greedy-мешер вместо ручного JS-перебора.
    generateMesh() {
        const regionWidth = REGION_BLOCK_SIZE;
        const regionDepth = REGION_BLOCK_SIZE;
        const originX = this.rx * regionWidth;
        const originZ = this.rz * regionDepth;

        const paddedWidth = regionWidth + 2;
        const paddedDepth = regionDepth + 2;
        const voxels = new Uint8Array(paddedWidth * WORLD_HEIGHT * paddedDepth);

        for (let y = 0; y < WORLD_HEIGHT; y++) {
            for (let lz = -1; lz <= regionDepth; lz++) {
                const row = y * paddedWidth * paddedDepth + (lz + 1) * paddedWidth;
                for (let lx = -1; lx <= regionWidth; lx++) {
                    voxels[row + (lx + 1)] = this.world.getVoxel(originX + lx, y, originZ + lz);
                }
            }
        }

        const meshData = generate_region_mesh(
            voxels, regionWidth, WORLD_HEIGHT, regionDepth,
            originX, originZ,
            isTransparentTable, topMaterialTable, bottomMaterialTable, sideMaterialTable
        );

        if (meshData.indices.length === 0) {
            if (this.mesh) { this.world.scene.remove(this.mesh); this.mesh.geometry.dispose(); }
            this.mesh = null;
            this.needsUpdate = false;
            return;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(meshData.positions, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(meshData.normals, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(meshData.uvs, 2));
        geometry.setIndex(new THREE.Uint32BufferAttribute(meshData.indices, 1));

        const groups = meshData.groups;
        for (let i = 0; i < groups.length; i += 3) {
            geometry.addGroup(groups[i], groups[i + 1], groups[i + 2]);
        }
        geometry.computeBoundingSphere();

        if (this.mesh) {
            // Материалы общие для всех регионов и переиспользуются между
            // перестроениями, поэтому их нельзя dispose() здесь — только геометрию.
            this.world.scene.remove(this.mesh);
            this.mesh.geometry.dispose();
        }
        this.mesh = new THREE.Mesh(geometry, globalMaterials);
        this.world.scene.add(this.mesh);
        this.needsUpdate = false;
    }
}


export class World {
    constructor(scene, seed) {
        this.scene = scene;
        this.chunks = {};
        this.regions = {};
        this.seed = seed || Math.random() * 10000;

        // Стриминг регионов по дальности видимости от игрока.
        this.streamQueue = [];
        this.lastPlayerRegionKey = null;
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
            chunk.setVoxel(localX, y, localZ, value);
            const regionX = Math.floor(chunkX / REGION_SIZE);
            const regionZ = Math.floor(chunkZ / REGION_SIZE);
            const region = this.getRegion(regionX, regionZ);
            if (region) {
                region.needsUpdate = true;
            }
        }
    }

    // Генерирует воксели всех чанков региона (кэшируются, повторный вызов
    // для уже сгенерированных чанков — no-op) и строит его меш.
    loadRegion(rx, rz) {
        const key = this.getRegionKey(rx, rz);
        if (this.regions[key]) return;

        const startChunkX = rx * REGION_SIZE;
        const startChunkZ = rz * REGION_SIZE;
        for (let cx = 0; cx < REGION_SIZE; cx++) {
            for (let cz = 0; cz < REGION_SIZE; cz++) {
                this.generateChunkData(startChunkX + cx, startChunkZ + cz);
            }
        }

        const region = new WorldRegion(rx, rz, this);
        this.regions[key] = region;
        region.generateMesh();
    }

    // Убирает меш региона из сцены и освобождает GPU-память. Данные
    // вокселей чанков (this.chunks) НЕ удаляются — без системы сохранений
    // это самый простой способ не потерять сделанные игроком правки при
    // повторном заходе в тот же регион, а память на несколько тысяч
    // чанков (по 8 КБ каждый) в браузере не критична.
    unloadRegion(rx, rz) {
        const key = this.getRegionKey(rx, rz);
        const region = this.regions[key];
        if (!region) return;
        if (region.mesh) {
            this.scene.remove(region.mesh);
            region.mesh.geometry.dispose();
        }
        delete this.regions[key];
    }

    // Начальная область вокруг точки спавна — грузится сразу и
    // синхронно, чтобы поиску точки спавна в main.js было куда встать.
    // Дальше подгрузку/выгрузку по мере движения игрока берёт на себя
    // updateStreaming().
    generate() {
        const initialRadius = 1;
        for (let rx = -initialRadius; rx <= initialRadius; rx++) {
            for (let rz = -initialRadius; rz <= initialRadius; rz++) {
                this.loadRegion(rx, rz);
            }
        }
    }

    // Рельеф, пещеры, руды, вода и деревья считаются целиком в Rust/WASM —
    // JS только забирает готовый буфер вокселей.
    generateChunkData(chunkX, chunkZ) {
        const key = this.getChunkKey(chunkX, chunkZ);
        if (this.chunks[key]) return this.chunks[key];

        const chunk = new Chunk(chunkX, chunkZ);
        chunk.data = generate_chunk_voxels(chunkX, chunkZ, CHUNK_SIZE, WORLD_HEIGHT, this.seed);
        this.chunks[key] = chunk;
        return chunk;
    }

    // Подгружает регионы в радиусе видимости вокруг игрока и выгружает
    // те, что вышли за его пределы — аналог render distance в Minecraft.
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

            // Выгрузка дешёвая (просто убрать меш из сцены) — делаем сразу,
            // без размазывания по кадрам.
            for (const key of Object.keys(this.regions)) {
                if (!desired.has(key)) {
                    const [rx, rz] = key.split(',').map(Number);
                    this.unloadRegion(rx, rz);
                }
            }
            // Игрок мог быстро проскочить регион, не дождавшись его
            // загрузки — убираем из очереди то, что уже вышло за пределы
            // дальности прорисовки.
            this.streamQueue = this.streamQueue.filter(r => desired.has(this.getRegionKey(r.rx, r.rz)));
        }

        for (let i = 0; i < REGIONS_PER_FRAME && this.streamQueue.length > 0; i++) {
            const { rx, rz } = this.streamQueue.shift();
            this.loadRegion(rx, rz);
        }
    }

    update(deltaTime, playerPosition) {
        for (const key in this.regions) {
            if (this.regions[key].needsUpdate) {
                this.regions[key].generateMesh();
            }
        }
        this.updateStreaming(playerPosition);
    }

    getData() {
        const data = {};
        for(const key in this.chunks) {
            // RLE-сжатие (Rust/WASM): чанк почти всегда состоит из длинных
            // одинаковых пробегов (слои воздуха/камня), поэтому сжатый
            // массив обычно в десятки-сотни раз короче исходных 8192 байт.
            data[key] = Array.from(encode_chunk(this.chunks[key].data));
        }
        return { seed: this.seed, chunks: data };
    }

    loadData(data) {
        this.seed = data.seed;
        this.chunks = {};
        this.regions = {};

        const chunkVoxelCount = CHUNK_SIZE * WORLD_HEIGHT * CHUNK_SIZE;
        for(const key in data.chunks) {
            const [x, z] = key.split(',').map(Number);
            const chunk = new Chunk(x, z);
            chunk.data = decode_chunk(new Uint8Array(data.chunks[key]), chunkVoxelCount);
            this.chunks[key] = chunk;

            const regionX = Math.floor(x / REGION_SIZE);
            const regionZ = Math.floor(z / REGION_SIZE);
            const regionKey = this.getRegionKey(regionX, regionZ);
            if (!this.regions[regionKey]) {
                 this.regions[regionKey] = new WorldRegion(regionX, regionZ, this);
                 this.regions[regionKey].needsUpdate = true;
            }
        }
        this.update();
    }
}
