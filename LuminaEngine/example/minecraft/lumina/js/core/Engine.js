// Lumina/js/core/Engine.js

import { Renderer } from './Renderer.js';
import { InputManager } from './InputManager.js';
import { PhysicsEngine } from '../physics/PhysicsEngine.js';

export class Engine {
    constructor(canvasId) {
        this.renderer = new Renderer(canvasId);
        this.inputManager = new InputManager(this.renderer.domElement);
        this.physicsEngine = new PhysicsEngine();
        this.gameObjects = [];
        this.player = null;
        
        this.lastTime = 0;
        this.fps = 0;
        this.frameCount = 0;
        this.fpsLastUpdate = 0;

        // Один и тот же Engine переиспользуется между заходами в миры
        // (создаётся один раз в main.js). running/rafId позволяют
        // остановить цикл при выходе в меню и не оставить "висящую"
        // цепочку requestAnimationFrame.
        this.running = false;
        this.rafId = null;
        this._boundLoop = this.gameLoop.bind(this);
    }

    setPlayer(gameObject) {
        this.player = gameObject;
    }

    addGameObject(gameObject) {
        this.gameObjects.push(gameObject);
        this.renderer.scene.add(gameObject.transform);
        gameObject.engine = this;
    }

    start() {
        this.gameObjects.forEach(go => go.start());
        this.lastTime = performance.now();
        this.fpsLastUpdate = this.lastTime;
        this.running = true;
        this.rafId = requestAnimationFrame(this._boundLoop);
    }

    // Останавливает игровой цикл и разбирает текущую сессию: даёт
    // компонентам шанс освободить ресурсы (onDestroy), убирает объекты со
    // сцены и обнуляет список. World сам по себе не gameObject — его меши
    // выгружает вызывающий код (main.js через world.dispose()).
    stop() {
        this.running = false;
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        this.gameObjects.forEach(go => {
            go.components.forEach(c => { if (c.onDestroy) c.onDestroy(); });
            this.renderer.scene.remove(go.transform);
        });
        this.gameObjects = [];
        this.player = null;
        // Иначе RigidBody прошлой сессии копятся в массиве между заходами.
        this.physicsEngine.rigidBodies = [];
        this.physicsEngine.world = null;
    }

    gameLoop(currentTime = 0) {
        if (!this.running) return;

        const deltaTime = (currentTime - this.lastTime) / 1000;
        this.lastTime = currentTime;

        this.frameCount++;
        if (currentTime > this.fpsLastUpdate + 1000) {
            this.fps = this.frameCount;
            this.frameCount = 0;
            this.fpsLastUpdate = currentTime;
        }

        this.physicsEngine.update(deltaTime);
        this.gameObjects.forEach(go => go.update(deltaTime));
        this.renderer.render();
        this.renderer.updateUI(this.fps, this.player ? this.player.transform : null);
        this.inputManager.lateUpdate();
        this.rafId = requestAnimationFrame(this._boundLoop);
    }
}
