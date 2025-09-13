// Lumina/js/core/InputManager.js

export class InputManager {
    constructor(targetElement) {
        this.keys = {};
        this.mouseDelta = { x: 0, y: 0 };
        this.lockElement = targetElement;

        // <<-- МЫ ПОЛНОСТЬЮ ЗАМЕНИМ СТАРЫЙ ОБРАБОТЧИК 'keydown'
        document.addEventListener('keydown', this.onKeyDown.bind(this));
        document.addEventListener('keyup', (e) => this.keys[e.code] = false);

        document.addEventListener('click', () => {
            this.lockElement.requestPointerLock();
        });

        document.addEventListener('pointerlockchange', () => {
            const instructions = document.getElementById('instructions');
            if (document.pointerLockElement === this.lockElement) {
                document.addEventListener('mousemove', this.onMouseMove.bind(this), false);
                if (instructions) instructions.style.display = 'none';
            } else {
                document.removeEventListener('mousemove', this.onMouseMove.bind(this), false);
                if (instructions) instructions.style.display = 'block';
                // Сбрасываем все зажатые клавиши, когда теряем фокус, чтобы избежать "залипания"
                this.keys = {}; 
            }
        });
    }
    
    // <<-- НОВЫЙ МЕТОД ДЛЯ ОБРАБОТКИ НАЖАТИЙ
    onKeyDown(event) {
        this.keys[event.code] = true;

        // Проверяем, активен ли режим блокировки курсора
        if (document.pointerLockElement === this.lockElement) {
            // Если да, то отменяем стандартное действие браузера для нажатой клавиши.
            // Это предотвратит прокрутку страницы при нажатии на пробел,
            // поиск по странице при нажатии '/', и т.д.
            // Ключевые сочетания типа F11, F12, Ctrl+W все равно будут работать.
            
            // Мы не блокируем Escape, так как он нужен для выхода из Pointer Lock.
            // Браузер и так не позволит этого сделать.
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

    getMouseDelta() {
        return { ...this.mouseDelta };
    }

    resetMouseDelta() {
        this.mouseDelta.x = 0;
        this.mouseDelta.y = 0;
    }
}