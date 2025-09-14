# LuminaEngine
<img width="492" alt="LuminaEngine Logo" src="https://github.com/user-attachments/assets/81805185-14c1-448a-83bd-d9bee4dcc777" />

---

<details open>
<summary><strong>🇬🇧 English</strong></summary>

### What is LuminaEngine?

**LuminaEngine** is a lightweight 3D game engine built with JavaScript and **THREE.js**. It is designed around the **Entity-Component-System (ECS)** pattern, promoting a modular, flexible, and easy-to-understand approach to game development.

It's perfect for educational purposes, game jams, and rapid prototyping of 3D web experiences.

### ✨ Core Philosophy

*   **Simplicity:** No complex setup. The engine provides the essential tools to get you started quickly. The code is clear and well-commented to facilitate learning.
*   **Modularity:** Build your game objects by composing small, reusable **Components**. A `GameObject` is just a container; its behavior is defined entirely by the Components you attach.
*   **Flexibility:** Built on top of THREE.js, giving you direct access to its powerful rendering capabilities when you need to go beyond the engine's core features.

### 🚀 Key Concepts

*   **`Engine`**: The central orchestrator that runs the game loop and manages all systems (rendering, input).
*   **`GameObject`**: A container in the scene with a `transform` (position, rotation, scale).
*   **`Component`**: The logic and data. Attach components like `PlayerController` or `MeshRenderer` to bring your `GameObjects` to life.

### 🏁 Getting Started

1.  Clone this repository.
2.  Open `index.html` in your browser to see the project hub.
3.  Explore the `/example/3dGame/` folder to see a practical example of the engine in action.
4.  Check out the detailed [Documentation](docs/en-main.md) to learn more about the API.

</details>

<details>
<summary><strong>🇷🇺 Русский</strong></summary>

### Что такое LuminaEngine?

**LuminaEngine** — это легковесный 3D-игровой движок, созданный на JavaScript и **THREE.js**. Он основан на архитектурном паттерне **Entity-Component-System (ECS)**, что обеспечивает модульный, гибкий и простой для понимания подход к разработке игр.

Движок идеально подходит для образовательных целей, геймджемов и быстрого прототипирования 3D-проектов в вебе.

### ✨ Ключевая философия

*   **Простота:** Никакой сложной настройки. Движок предоставляет базовые инструменты, чтобы вы могли быстро начать работу. Код написан чисто и хорошо прокомментирован для облегчения изучения.
*   **Модульность:** Создавайте игровые объекты, комбинируя небольшие, переиспользуемые **Компоненты**. `GameObject` — это просто контейнер; его поведение полностью определяется добавленными компонентами.
*   **Гибкость:** Построен на базе THREE.js, что дает вам прямой доступ ко всей мощи этой библиотеки, когда базовых возможностей движка становится недостаточно.

### 🚀 Основные концепции

*   **`Engine`**: Центральный "оркестр", который запускает игровой цикл и управляет всеми системами (рендеринг, ввод).
*   **`GameObject`**: Контейнер на сцене, обладающий `transform` (позиция, вращение, масштаб).
*   **`Component`**: Логика и данные. Прикрепляйте компоненты, такие как `PlayerController` или `MeshRenderer`, чтобы "оживить" ваши `GameObject`'ы.

### 🏁 Начало работы

1.  Клонируйте этот репозиторий.
2.  Откройте файл `index.html` в браузере, чтобы увидеть хаб проекта.
3.  Изучите папку `/example/3dGame/`, чтобы увидеть практический пример работы движка.
4.  Ознакомьтесь с подробной [Документацией](docs/ru-main.md), чтобы узнать больше об API.

</details>

---

### 📄 License

This project is licensed under the MIT License.
