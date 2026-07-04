// Lumina/js/main.js
import * as THREE from 'three';
import { Engine } from './core/Engine.js';
import { GameObject } from './core/GameObject.js';
import { PlayerController } from '../../game/PlayerController.js';
import { RigidBody } from './physics/RigidBody.js';
import { BoxCollider } from './physics/Colliders.js';
import { World } from '../../game/World.js';
import { BLOCK } from '../../game/blocks.js';
import { Inventory } from '../../game/Inventory.js';
import { UIManager } from '../../game/UIManager.js';
import { BlockInteraction } from '../../game/BlockInteraction.js';
import { DayNightCycle } from '../../game/DayNightCycle.js';
import { WorldManager } from '../../game/WorldManager.js';

const MOUSE_SENSITIVITY_KEY = 'luminaCraftMouseSensitivity';
const DEFAULT_MOUSE_SENSITIVITY = 0.002;

const WORLD_HEIGHT = 128;   // совпадает с World.js/Rust
const SEA_LEVEL = 45;       // совпадает с WATER_LEVEL в lumina-worldgen

// Высота верхнего твёрдого блока в колонне (вода не в счёт), либо -1.
function surfaceHeight(world, x, z) {
    for (let y = WORLD_HEIGHT - 1; y > 0; y--) {
        if (BLOCK.get(world.getVoxel(x, y, z)).isSolid) return y;
    }
    return -1;
}

// Ищет сухую точку спавна (поверхность выше уровня моря) по расширяющимся
// кольцам вокруг начала координат — терраген теперь разнообразен, и жёсткая
// точка (8,8) нередко оказывалась под водой. Если рядом только океан,
// строит аварийную платформу.
function findSpawn(world) {
    const cx = 8, cz = 8;
    // Радиус ограничен областью, которую generate() успел сгенерировать
    // (регионы -1..1 → примерно -32..63 блока); дальше getVoxel вернёт
    // воздух и колонна просто не подойдёт.
    for (let r = 0; r <= 40; r++) {
        for (let dx = -r; dx <= r; dx++) {
            for (let dz = -r; dz <= r; dz++) {
                if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue; // только периметр кольца
                const x = cx + dx, z = cz + dz;
                const y = surfaceHeight(world, x, z);
                if (y >= SEA_LEVEL + 1) return { x, y, z };
            }
        }
    }
    // Всё вокруг — океан: платформа на уровне моря.
    const y = SEA_LEVEL + 2;
    for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
            world.setVoxel(cx + dx, y, cz + dz, BLOCK.GRASS);
        }
    }
    console.warn('Вокруг только океан — создана платформа спавна.');
    return { x: cx, y, z: cz };
}

function formatDate(timestamp) {
    return new Date(timestamp).toLocaleString('ru-RU', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
}

function main() {
    const engine = new Engine('game-canvas');
    const uiManager = new UIManager();
    const worldManager = new WorldManager();

    const screens = document.querySelectorAll('.menu-screen');
    function showScreen(id) {
        screens.forEach(el => el.classList.toggle('active', el.id === id));
    }

    // --- Главное меню ---
    document.getElementById('play-btn').addEventListener('click', () => {
        showScreen('screen-worlds');
        refreshWorldList();
    });
    document.getElementById('settings-btn').addEventListener('click', () => {
        showScreen('screen-settings');
    });

    // --- Настройки ---
    const sensitivitySlider = document.getElementById('mouse-sensitivity-slider');
    const sensitivityValue = document.getElementById('mouse-sensitivity-value');
    const savedSensitivity = parseFloat(localStorage.getItem(MOUSE_SENSITIVITY_KEY));
    sensitivitySlider.value = Number.isFinite(savedSensitivity) ? savedSensitivity : DEFAULT_MOUSE_SENSITIVITY;
    sensitivityValue.textContent = sensitivitySlider.value;
    sensitivitySlider.addEventListener('input', () => {
        localStorage.setItem(MOUSE_SENSITIVITY_KEY, sensitivitySlider.value);
        sensitivityValue.textContent = sensitivitySlider.value;
    });
    document.getElementById('settings-back-btn').addEventListener('click', () => {
        showScreen('screen-main');
    });

    // --- Список миров ---
    const worldListEl = document.getElementById('world-list');

    async function refreshWorldList() {
        const worlds = await worldManager.listWorlds();
        worldListEl.innerHTML = '';

        if (worlds.length === 0) {
            const hint = document.createElement('div');
            hint.className = 'empty-hint';
            hint.textContent = 'Миров пока нет — создай первый.';
            worldListEl.appendChild(hint);
            return;
        }

        for (const meta of worlds) {
            const entry = document.createElement('div');
            entry.className = 'world-entry';

            const info = document.createElement('div');
            info.className = 'world-info';
            info.innerHTML = `
                <div class="world-name"></div>
                <div class="world-meta">Сид: ${meta.seed} · последний заход: ${formatDate(meta.lastPlayedAt)}</div>
            `;
            info.querySelector('.world-name').textContent = meta.name;

            const actions = document.createElement('div');
            actions.className = 'world-actions';

            const playBtn = document.createElement('button');
            playBtn.textContent = 'Играть';
            playBtn.addEventListener('click', () => enterWorld(meta));

            const renameBtn = document.createElement('button');
            renameBtn.textContent = 'Переименовать';
            renameBtn.addEventListener('click', async () => {
                const newName = prompt('Новое имя мира:', meta.name);
                if (newName && newName.trim()) {
                    await worldManager.renameWorld(meta.id, newName.trim());
                    refreshWorldList();
                }
            });

            const deleteBtn = document.createElement('button');
            deleteBtn.textContent = 'Удалить';
            deleteBtn.addEventListener('click', async () => {
                if (confirm(`Удалить мир "${meta.name}"? Это необратимо.`)) {
                    await worldManager.deleteWorld(meta.id);
                    refreshWorldList();
                }
            });

            actions.append(playBtn, renameBtn, deleteBtn);
            entry.append(info, actions);
            worldListEl.appendChild(entry);
        }
    }

    document.getElementById('worlds-back-btn').addEventListener('click', () => {
        showScreen('screen-main');
    });

    // --- Создание мира ---
    const newWorldNameInput = document.getElementById('new-world-name');
    const newWorldSeedInput = document.getElementById('new-world-seed');

    document.getElementById('create-world-btn').addEventListener('click', async () => {
        const worldCount = (await worldManager.listWorlds()).length;
        newWorldNameInput.value = `Мир ${worldCount + 1}`;
        newWorldSeedInput.value = '';
        showScreen('screen-create-world');
        newWorldNameInput.focus();
        newWorldNameInput.select();
    });

    document.getElementById('create-world-back-btn').addEventListener('click', () => {
        showScreen('screen-worlds');
    });

    async function confirmCreateWorld() {
        const name = newWorldNameInput.value.trim();
        if (!name) {
            alert('Введи название мира.');
            return;
        }
        const meta = await worldManager.createWorld(name, newWorldSeedInput.value);
        enterWorld(meta);
    }
    document.getElementById('confirm-create-world-btn').addEventListener('click', confirmCreateWorld);
    for (const input of [newWorldNameInput, newWorldSeedInput]) {
        input.addEventListener('keydown', (e) => {
            if (e.code === 'Enter') confirmCreateWorld();
        });
    }

    // --- Пауза / выход в меню ---
    // Активная игровая сессия (или null в меню). Одна за раз — второй заход
    // невозможен, пока текущий не завершён через exitToMenu(). Это же
    // защищает от повторного startGame() поверх уже бегущего engine.
    let session = null;
    const pauseMenu = document.getElementById('pause-menu');
    const canvasEl = engine.renderer.domElement;

    document.getElementById('resume-btn').addEventListener('click', () => {
        if (session) session.enterPlaying();
    });
    document.getElementById('save-quit-btn').addEventListener('click', () => exitToMenu(true));
    document.getElementById('quit-btn').addEventListener('click', () => exitToMenu(false));

    async function exitToMenu(save) {
        if (!session) return;
        const s = session;
        session = null; // сразу, чтобы обработчики/кнопки не сработали дважды

        pauseMenu.classList.remove('active');
        if (uiManager.inventoryVisible) uiManager.toggleInventory();
        if (document.pointerLockElement) document.exitPointerLock();

        if (save) await worldManager.saveWorld(s.meta.id, s.world, s.player);

        s.abort.abort();      // снимает все keydown/pointerlock-слушатели сессии
        engine.stop();         // останавливает цикл, вызывает onDestroy, чистит сцену
        s.world.dispose();     // выгружает меши регионов
        showScreen('screen-main');
    }

    async function enterWorld(meta) {
        if (session) return;
        await worldManager.touchWorld(meta.id);
        const saveData = await worldManager.loadWorld(meta.id);
        startGame(meta, saveData);
    }

    function startGame(meta, saveData) {
        screens.forEach(el => el.classList.remove('active'));

        const world = new World(engine.renderer.scene, meta.seed);
        engine.physicsEngine.setWorld(world);

        if (saveData) {
            world.loadData(saveData.world);
        } else {
            world.generate();
        }

        // --- Create Player ---
        const player = new GameObject('Player');
        player.addComponent(RigidBody, { bodyType: 'dynamic' });
        player.addComponent(BoxCollider, new THREE.Vector3(0.6, 1.8, 0.6));
        player.addComponent(PlayerController);
        const inventory = player.addComponent(Inventory, uiManager);
        player.addComponent(BlockInteraction, world);

        // --- Логика безопасного спавна ---
        if (saveData && saveData.player) {
            player.transform.position.fromArray(saveData.player.position);
            player.transform.rotation.fromArray(saveData.player.rotation);
            inventory.loadData(saveData.player.inventory);
        } else {
            const spawn = findSpawn(world);
            player.transform.position.set(spawn.x + 0.5, spawn.y + 2, spawn.z + 0.5);
        }

        engine.addGameObject(player);
        engine.setPlayer(player);

        // --- Create Sky Manager ---
        const skyManager = new GameObject('SkyManager');
        skyManager.addComponent(DayNightCycle);
        engine.addGameObject(skyManager);

        // --- Add world update to the game loop ---
        // Позиция игрока нужна World.update() для подгрузки/выгрузки
        // регионов по дальности видимости (render distance).
        const worldUpdater = new GameObject('WorldUpdater');
        worldUpdater.update = (deltaTime) => world.update(deltaTime, player.transform.position);
        engine.addGameObject(worldUpdater);

        // --- Состояние UI сессии: playing | inventory | paused ---
        // Захват курсора держится только в 'playing'. Все три оверлея
        // (ничего / инвентарь / пауза) взаимоисключающи.
        let uiState = 'playing';
        const abort = new AbortController();

        function enterPlaying() {
            uiState = 'playing';
            pauseMenu.classList.remove('active');
            if (uiManager.inventoryVisible) uiManager.toggleInventory();
            canvasEl.requestPointerLock();
        }
        function enterPaused() {
            uiState = 'paused';
            if (uiManager.inventoryVisible) uiManager.toggleInventory();
            pauseMenu.classList.add('active');
            if (document.pointerLockElement) document.exitPointerLock();
        }
        function toggleInventory() {
            if (uiState === 'paused') return;
            if (uiState === 'inventory') {
                enterPlaying();
            } else {
                uiState = 'inventory';
                uiManager.toggleInventory(); // открывает инвентарь и снимает захват курсора
            }
        }

        document.addEventListener('keydown', (e) => {
            if (e.code === 'KeyE') {
                toggleInventory();
            } else if (e.code === 'Escape') {
                // Открытие паузы по Esc обрабатывает pointerlockchange (браузер
                // сам снимает захват). Здесь только закрываем оверлеи обратно.
                if (uiState !== 'playing') enterPlaying();
            } else if (e.code === 'KeyP') {
                worldManager.saveWorld(meta.id, world, player);
            }
        }, { signal: abort.signal });

        // Потеря захвата во время игры (Esc, alt-tab) → пауза.
        document.addEventListener('pointerlockchange', () => {
            if (!document.pointerLockElement && uiState === 'playing') {
                enterPaused();
            }
        }, { signal: abort.signal });

        session = { meta, world, player, abort, enterPlaying };

        // Start the engine
        engine.start();
    }
}

main();
