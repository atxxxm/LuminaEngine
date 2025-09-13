// Lumina/game/devgame.js

import { Engine } from '../js/core/Engine.js';
import { GameObject } from '../js/core/GameObject.js';
import { Component } from '../js/core/Component.js';

// --- Компоненты для тестовой сцены ---

class NoclipController extends Component {
    constructor(gameObject) {
        super(gameObject);
        this.speed = 10;
        this.sensitivity = 0.002;
        this.minY = -1;
        this.maxY = 63;
        this.camera = null;
    }

    start() {
        this.camera = this.engine.renderer.camera;
        this.camera.rotation.order = 'YXZ'; // Это по-прежнему важно!
    }
    
    update(deltaTime) {
        if (!this.camera) return;

        const input = this.engine.inputManager;
        const moveSpeed = this.speed * deltaTime;
        
        // --- Логика движения ---
        // Используем встроенные методы three.js для перемещения вдоль локальных осей
        // Это и есть "перемещение относительно взгляда"
        if (input.isKeyDown('KeyW')) this.transform.translateZ(-moveSpeed);
        if (input.isKeyDown('KeyS')) this.transform.translateZ(moveSpeed);
        if (input.isKeyDown('KeyA')) this.transform.translateX(-moveSpeed);
        if (input.isKeyDown('KeyD')) this.transform.translateX(moveSpeed);

        // Вертикальное движение происходит в мировых координатах, оно не зависит от наклона камеры
        if (input.isKeyDown('Space')) this.transform.position.y += moveSpeed;
        if (input.isKeyDown('ControlLeft')) this.transform.position.y -= moveSpeed;

        // Ограничения по высоте
        this.transform.position.y = Math.max(this.minY, Math.min(this.maxY, this.transform.position.y));
        
        // --- Логика вращения ---
        const mouseDelta = input.getMouseDelta();
        
        // Вращаем родительский объект (игрока) по оси Y для горизонтального обзора (Yaw)
        this.transform.rotation.y -= mouseDelta.x * this.sensitivity;
        
        // Вращаем саму камеру по оси X для вертикального обзора (Pitch)
        this.camera.rotation.x -= mouseDelta.y * this.sensitivity;
        
        // Ограничиваем вертикальный обзор, чтобы не "перевернуться"
        this.camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.camera.rotation.x));
    }
}

class RotatingCube extends Component {
    // ... (Этот класс остается без изменений) ...
    start() {
        const geometry = new THREE.BoxGeometry(2, 2, 2);
        this.material = new THREE.MeshStandardMaterial({ color: 0xff0000 });
        const mesh = new THREE.Mesh(geometry, this.material);
        this.transform.add(mesh);
        
        this.transform.position.set(0, 5, 0);
        this.time = 0;
    }
    
    update(deltaTime) {
        this.time += deltaTime;
        this.transform.rotation.x += 0.5 * deltaTime;
        this.transform.rotation.y += 0.5 * deltaTime;
        const hue = (this.time * 0.1) % 1;
        this.material.color.setHSL(hue, 1.0, 0.5);
    }
}

// --- Основная функция запуска игры ---

export function runDevGame() {
    const engine = new Engine('lumina-canvas');

    // Создаем "игрока" - это пустой GameObject, который будет контейнером для камеры
    const player = new GameObject('Player');
    
    // Помещаем камеру ВНУТРЬ игрока. Теперь, когда мы двигаем/вращаем игрока,
    // камера будет двигаться и вращаться вместе с ним.
    player.transform.add(engine.renderer.camera);
    
    player.addComponent(NoclipController);
    engine.addGameObject(player);
    
    // <<-- ВАЖНО: Указываем движку, кто наш игрок
    engine.setPlayer(player);

    // Создаем куб
    const cube = new GameObject('TestCube');
    cube.addComponent(RotatingCube);
    engine.addGameObject(cube);
    
    // Настраиваем сцену (остается без изменений)
    const floorGeometry = new THREE.PlaneGeometry(1000, 1000);
    const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x444444, side: THREE.DoubleSide });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1.01;
    engine.renderer.scene.add(floor);
    
    const ambientLight = new THREE.AmbientLight(0x404040, 1);
    engine.renderer.scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(5, 10, 7.5);
    engine.renderer.scene.add(directionalLight);
    
    // Запускаем движок
    engine.start();
}