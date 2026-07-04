// game/blocks.js
import * as THREE from 'three';

export const BLOCK = {
    AIR: 0,
    BEDROCK: 1,
    STONE: 2,
    DIRT: 3,
    GRASS: 4,
    OAK_LOG: 5,
    OAK_LEAVES: 6,
    COAL_ORE: 7,
    IRON_ORE: 8,
    WATER: 9,
    SAND: 10,
    SNOW: 11,
    TORCH: 12,

    // ВАЖНО: id блоков здесь должны совпадать с константами BLOCK_* в
    // crates/lumina-worldgen/src/lib.rs — генератор мира зашивает эти id
    // напрямую в чанк на стороне Rust.
    properties: {
        0: { name: 'air', isTransparent: true, isSolid: false },
        1: { name: 'bedrock', isBreakable: false, isSolid: true, texture: 'bedrock.png' },
        2: { name: 'stone', isSolid: true, texture: 'stone.png' },
        3: { name: 'dirt', isSolid: true, texture: 'dirt.png' },
        4: { name: 'grass', isSolid: true, texture: { top: 'grass_top.png', bottom: 'dirt.png', side: 'grass_side.png' } },
        5: { name: 'oak_log', isSolid: true, texture: { top: 'oak_log_top.png', bottom: 'oak_log_top.png', side: 'oak_log.png' } },
        6: { name: 'oak_leaves', isTransparent: true, isSolid: true, texture: 'oak_leaves.png' },
        7: { name: 'coal_ore', isSolid: true, texture: 'coal_ore.png' },
        8: { name: 'iron_ore', isSolid: true, texture: 'iron_ore.png' },
        // Текстуры воды в проекте нет — используем плоский полупрозрачный
        // цвет вместо картинки (см. World.js: блоки с `color` вместо
        // `texture` получают MeshLambertMaterial без карты). isSolid:false —
        // игрок в воду проваливается/тонет, полноценного плавания нет.
        9: { name: 'water', isBreakable: false, isTransparent: true, isSolid: false, color: 0x2b6bdb, opacity: 0.6 },
        10: { name: 'sand', isSolid: true, texture: 'sand.png' },
        11: { name: 'snow', isSolid: true, texture: 'snow.png' },
        // Факел — источник света (World.js: BFS-распространение, см.
        // propagateLight/unlight). Текстуры нет — упрощённый светящийся
        // кубик цветом, не палка+пламя как в настоящем Minecraft.
        // isSolid:false — не мешает проходу, isTransparent:true — не
        // блокирует ни свет, ни соседние грани.
        12: { name: 'torch', isSolid: false, isTransparent: true, isBreakable: true, lightLevel: 14, color: 0xffaa33 },
    },

    get(id) {
        // Возвращаем пустой объект с isSolid: false для неизвестных ID
        return this.properties[id] || { isSolid: false };
    }
};