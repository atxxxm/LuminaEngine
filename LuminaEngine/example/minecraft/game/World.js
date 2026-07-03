// game/World.js

import * as THREE from 'three';
// --- УДАЛЕНО: `import { noise } from '../lib/perlin.js';` ---
// Генерация шума теперь происходит на GPU, эта библиотека больше не нужна.
import { BLOCK } from './blocks.js';
// --- ДОБАВЛЕНО: Импорт нашего GPU-генератора ---
import { GPUWorldGenerator } from './GPUWorldGenerator.js';
// --- ДОБАВЛЕНО: Rust/WASM greedy-мешер вокселей ---
import init, { generate_region_mesh } from '../../../engine/wasm/lumina-meshing/lumina_meshing.js';

await init();

const CHUNK_SIZE = 8; // Стандартный размер чанка
const WORLD_HEIGHT = 128;
const REGION_SIZE = 4; // 4x4 чанка в одном меше (64x64 блока)

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

// Общий на все регионы список материалов + таблицы свойств блоков по id,
// которые передаются в WASM-мешер. Строятся один раз из BLOCK.properties.
const MAX_BLOCK_ID = 256;
const globalMaterials = [];
const materialIndexOf = {};
const isTransparentTable = new Uint8Array(MAX_BLOCK_ID);
const topMaterialTable = new Uint16Array(MAX_BLOCK_ID);
const bottomMaterialTable = new Uint16Array(MAX_BLOCK_ID);
const sideMaterialTable = new Uint16Array(MAX_BLOCK_ID);

function materialIndexFor(textureName) {
    if (materialIndexOf[textureName] === undefined) {
        materialIndexOf[textureName] = globalMaterials.length;
        globalMaterials.push(getMaterial(textureName));
    }
    return materialIndexOf[textureName];
}

for (const idKey of Object.keys(BLOCK.properties)) {
    const id = Number(idKey);
    const props = BLOCK.properties[id];
    isTransparentTable[id] = props.isTransparent ? 1 : 0;

    if (!props.texture) continue;
    if (typeof props.texture === 'object') {
        topMaterialTable[id] = materialIndexFor(props.texture.top);
        bottomMaterialTable[id] = materialIndexFor(props.texture.bottom);
        sideMaterialTable[id] = materialIndexFor(props.texture.side);
    } else {
        const idx = materialIndexFor(props.texture);
        topMaterialTable[id] = idx;
        bottomMaterialTable[id] = idx;
        sideMaterialTable[id] = idx;
    }
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
        const regionWidth = REGION_SIZE * CHUNK_SIZE;
        const regionDepth = REGION_SIZE * CHUNK_SIZE;
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
    // --- ИЗМЕНЕНИЕ: Конструктор теперь принимает renderer ---
    constructor(scene, seed, renderer) {
        this.scene = scene;
        this.chunks = {};
        this.regions = {};
        this.seed = seed || Math.random() * 10000;

        // --- УДАЛЕНО: `noise.seed(this.seed);` ---

        // --- ДОБАВЛЕНО: Создаем экземпляр GPU-генератора ---
        this.gpuGenerator = new GPUWorldGenerator(renderer, this.seed);
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

    generate() {
        const radius = 3;
        for (let x = -radius; x < radius; x++) {
            for (let z = -radius; z < radius; z++) {
                this.generateChunkData(x, z);
            }
        }
        const regionRadius = Math.ceil(radius / REGION_SIZE);
         for (let rx = -regionRadius; rx < regionRadius; rx++) {
            for (let rz = -regionRadius; rz < regionRadius; rz++) {
                const key = this.getRegionKey(rx, rz);
                if (!this.regions[key]) {
                    this.regions[key] = new WorldRegion(rx, rz, this);
                }
                this.regions[key].generateMesh();
            }
        }
    }

    // --- ИЗМЕНЕНИЕ: Полностью переписан метод генерации данных чанка ---
    generateChunkData(chunkX, chunkZ) {
        const key = this.getChunkKey(chunkX, chunkZ);
        if (this.chunks[key]) return this.chunks[key];

        const chunk = new Chunk(chunkX, chunkZ);
        this.chunks[key] = chunk;

        // 1. Получаем карту высот для этого чанка от GPU
        const heightMap = this.gpuGenerator.generateHeightMap(chunkX, chunkZ);

        // 2. Заполняем чанк данными на основе полученной карты высот
        for (let x = 0; x < CHUNK_SIZE; x++) {
            for (let z = 0; z < CHUNK_SIZE; z++) {
                const index = z * CHUNK_SIZE + x;
                const normalizedHeight = heightMap[index]; // Высота от 0.0 до 1.0

                // Конвертируем нормализованную высоту в высоту в блоках
                const height = Math.floor(normalizedHeight * 20) + 40;

                for (let y = 0; y < WORLD_HEIGHT; y++) {
                    if (y === 0) {
                        chunk.setVoxel(x, y, z, BLOCK.BEDROCK);
                    } else if (y < height - 3) {
                        chunk.setVoxel(x, y, z, BLOCK.STONE);
                    } else if (y < height) {
                        chunk.setVoxel(x, y, z, BLOCK.DIRT);
                    } else if (y === height) {
                        chunk.setVoxel(x, y, z, BLOCK.GRASS);
                    } else {
                        chunk.setVoxel(x, y, z, BLOCK.AIR);
                    }
                }
            }
        }
        return chunk;
    }

    update() {
        for (const key in this.regions) {
            if (this.regions[key].needsUpdate) {
                this.regions[key].generateMesh();
            }
        }
    }

    getData() {
        const data = {};
        for(const key in this.chunks) {
            data[key] = Array.from(this.chunks[key].data);
        }
        return { seed: this.seed, chunks: data };
    }

    // --- ИЗМЕНЕНИЕ: Метод загрузки теперь тоже принимает renderer ---
    loadData(data, renderer) {
        this.seed = data.seed;
        // --- УДАЛЕНО: `noise.seed(this.seed);` ---

        // --- ДОБАВЛЕНО: Пересоздаем GPU-генератор с новым seed'ом ---
        // Важно сначала уничтожить старый, чтобы освободить ресурсы GPU
        if (this.gpuGenerator) this.gpuGenerator.dispose();
        this.gpuGenerator = new GPUWorldGenerator(renderer, this.seed);

        this.chunks = {};
        this.regions = {};

        for(const key in data.chunks) {
            const [x, z] = key.split(',').map(Number);
            const chunk = new Chunk(x, z);
            chunk.data = new Uint8Array(data.chunks[key]);
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
