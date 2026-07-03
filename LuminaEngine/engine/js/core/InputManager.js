// Lumina/js/core/InputManager.js

export class InputManager {
    constructor(targetElement) {
        this.keys = {};
        this.lastKeys = {}; // Состояние клавиш на предыдущем кадре
        this.mouseDelta = { x: 0, y: 0 };
        this.lockElement = targetElement;
        this.boundOnMouseMove = this.onMouseMove.bind(this);

        document.addEventListener('keydown', this.onKeyDown.bind(this));
        document.addEventListener('keyup', (e) => this.keys[e.code] = false);

        document.addEventListener('click', () => {
            this.lockElement.requestPointerLock();
        });

        document.addEventListener('pointerlockchange', () => {
            const instructions = document.getElementById('instructions');
            if (document.pointerLockElement === this.lockElement) {
                document.addEventListener('mousemove', this.boundOnMouseMove, false);
                if (instructions) instructions.style.display = 'none';
            } else {
                document.removeEventListener('mousemove', this.boundOnMouseMove, false);
                if (instructions) instructions.style.display = 'block';
                this.keys = {};
            }
        });
    }
    
    onKeyDown(event) {
        this.keys[event.code] = true;
        if (document.pointerLockElement === this.lockElement) {
            if (event.code !== 'Escape') {
                event.preventDefault();
            }
        }
    }

    onMouseMove(event) {
        this.mouseDelta.x += event.movementX;
        this.mouseDelta.y += event.movementY;
    }

    isKeyDown(key) {
        return this.keys[key] || false;
    }

    // Проверяет, была ли клавиша нажата именно в этом кадре
    wasKeyJustPressed(key) {
        return this.isKeyDown(key) && !this.lastKeys[key];
    }

    getMouseDelta() {
        return { ...this.mouseDelta };
    }

    resetMouseDelta() {
        this.mouseDelta.x = 0;
        this.mouseDelta.y = 0;
    }

    // Вызывается в конце игрового цикла
    lateUpdate() {
        this.lastKeys = { ...this.keys };
        this.resetMouseDelta();
    }
}