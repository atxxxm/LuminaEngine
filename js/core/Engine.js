// Lumina/js/core/Engine.js

import { Renderer } from './Renderer.js';
import { InputManager } from './InputManager.js';

export class Engine {
    constructor(canvasId) {
        this.renderer = new Renderer(canvasId);
        this.inputManager = new InputManager(this.renderer.domElement);
        this.gameObjects = [];
        this.player = null; // <<-- ДОБАВИТЬ ЭТО
        
        this.lastTime = 0;
        this.fps = 0;
        this.frameCount = 0;
        this.fpsLastUpdate = 0;
    }
    
    // <<-- ДОБАВИТЬ ЭТОТ МЕТОД
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
        this.gameLoop();
    }

    gameLoop(currentTime = 0) {
        const deltaTime = (currentTime - this.lastTime) / 1000;
        this.lastTime = currentTime;

        this.frameCount++;
        if (currentTime > this.fpsLastUpdate + 1000) {
            this.fps = this.frameCount;
            this.frameCount = 0;
            this.fpsLastUpdate = currentTime;
        }
        
        this.gameObjects.forEach(go => go.update(deltaTime));
        this.renderer.render();
        
        // Передаем transform игрока в UI <<-- ИЗМЕНИТЬ ЭТУ СТРОКУ
        this.renderer.updateUI(this.fps, this.player ? this.player.transform : null);

        this.inputManager.resetMouseDelta();
        
        requestAnimationFrame(this.gameLoop.bind(this));
    }
}