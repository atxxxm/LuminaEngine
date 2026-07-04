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

    // Меню стартует игру ровно один раз за загрузку страницы — "назад в
    // меню" из игры тут нет. Без этой защиты повторный клик (например,
    // двойной клик или гонка между обработчиками) вызвал бы startGame()
    // ещё раз поверх уже бегущего engine: addGameObject добавил бы второй
    // набор RigidBody/Inventory/keydown-слушателей, а engine.start()
    // запустил бы вторую параллельную цепочку requestAnimationFrame рядом
    // с первой.
    let gameStarted = false;

    async function enterWorld(meta) {
        if (gameStarted) return;
        gameStarted = true;
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
            const spawnX = 8;
            const spawnZ = 8;
            let spawnY = 128;
            let groundFound = false;

            while(spawnY > 0) {
                const blockId = world.getVoxel(spawnX, spawnY, spawnZ);
                // Важно: не "не воздух", а именно "твёрдый" — вода (id 9)
                // не воздух, но не годится как точка опоры для спавна.
                if (BLOCK.get(blockId).isSolid) {
                    groundFound = true;
                    break;
                }
                spawnY--;
            }

            if (!groundFound) {
                console.warn(`Не найдена земля в точке ${spawnX},${spawnZ}. Создаем платформу.`);
                spawnY = 64;
                for(let dx = -1; dx <= 1; dx++) {
                    for(let dz = -1; dz <= 1; dz++) {
                        world.setVoxel(spawnX + dx, spawnY, spawnZ + dz, 4);
                        // 8 — CHUNK_SIZE из World.js (было захардкожено 16)
                        const chunkToUpdate = world.getChunk(Math.floor((spawnX + dx) / 8), Math.floor((spawnZ + dz) / 8));
                        if(chunkToUpdate) chunkToUpdate.needsUpdate = true;
                    }
                }
            }

            player.transform.position.set(spawnX + 0.5, spawnY + 2, spawnZ + 0.5);
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

        // --- Setup Auto-Save and Inventory toggle ---
        document.addEventListener('keydown', (e) => {
            if (e.code === 'KeyE') {
                uiManager.toggleInventory();
            }
            if (e.code === 'KeyP') {
                worldManager.saveWorld(meta.id, world, player);
            }
        });

        // Start the engine
        engine.start();
    }
}

main();
