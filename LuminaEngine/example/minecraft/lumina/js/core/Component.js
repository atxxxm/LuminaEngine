export class Component {
    constructor(gameObject) {
        this.gameObject = gameObject;
        this.transform = gameObject.transform;
        this.engine = null; // Будет установлено движком
    }

    start() {
        // Переопределяется в дочерних классах
    }

    update(deltaTime) {
        // Переопределяется в дочерних классах
    }

    // Вызывается движком при остановке сессии (Engine.stop). Здесь
    // компонент освобождает то, что добавил вне своего transform: объекты
    // сцены, свет, глобальные слушатели и т.п. По умолчанию — ничего.
    onDestroy() {
        // Переопределяется в дочерних классах
    }
}