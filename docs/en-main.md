# LuminaEngine Documentation
<img width="492" height="312" alt="le" src="https://github.com/user-attachments/assets/81805185-14c1-448a-83bd-d9bee4dcc777" />

## 1. Introduction and Philosophy

**LuminaEngine** is a lightweight 3D game engine written in JavaScript, using the **THREE.js** library for rendering. The engine is designed based on the popular **Entity-Component-System (ECS)** architectural pattern, which makes it flexible and extensible.

The core philosophy of the engine is simplicity and modularity. Instead of monolithic classes, all game logic is divided into small, reusable **Components** that are attached to empty **GameObjects**.

### Core Principles:
*   **GameObject:** This is a "container" in the game world. By itself, it does nothing except exist at a specific point in space (`transform`). It can be a player, an enemy, a wall, a bullet, etc.
*   **Component:** This is the "behavior" or "property" of a GameObject. Components contain all the logic. For example, `PlayerController` (player control logic), `MeshRenderer` (model rendering logic), `Collider` (collision logic).
*   **Engine:** This is the central "orchestrator" that manages everything: it initializes the system, starts the game loop, updates all objects and components, and manages subsystems (rendering, input).

## 2. Core Concepts

### The Game Loop

The heart of any game engine. In `LuminaEngine`, it is implemented in the `Engine.gameLoop` method. On each frame, the following cycle occurs:

1.  **Calculate `deltaTime`**: The time elapsed since the previous frame is calculated. This is crucial for creating physics and movement that are independent of the frame rate (FPS).
2.  **Update all `GameObject`s**: The engine iterates through the list of all game objects and calls their `update(deltaTime)` method.
3.  **Update Components**: The `GameObject.update()` method, in turn, calls the `update(deltaTime)` methods of all its components. This is where all the game logic happens (movement, shooting, AI, etc.).
4.  **Rendering**: After the state of all objects has been updated, the `Renderer` draws the current scene on the screen.
5.  **Update UI**: Debug information (FPS, coordinates) is displayed.
6.  **Reset Input**: The mouse delta is reset to read the new offset in the next frame.
7.  **Schedule Next Frame**: `requestAnimationFrame()` tells the browser that we are ready to draw the next frame.

### Math and Coordinate System

*   **Coordinate System**: LuminaEngine uses a right-handed coordinate system, inherited from THREE.js (and OpenGL):
    *   **+X**: Right
    *   **+Y**: Up
    *   **-Z**: Into the screen (forward)
*   **`deltaTime`**: The time in seconds that has passed since the last frame. All movement should be multiplied by `deltaTime` to ensure constant speed, regardless of whether the game is running at 30 FPS or 144 FPS.
    *   Example: `position.x += speed * deltaTime;` // Correct!
    *   Example: `position.x += speed;` // Incorrect, speed will depend on FPS.
*   **Rotation**: Rotation in THREE.js is measured in **radians**. For display convenience in the UI, they are converted to degrees (`rotation * 180 / Math.PI`).
    *   **Yaw**: Rotation around the Y-axis (turning your head left and right). This is controlled by the `GameObject.transform` rotation.
    *   **Pitch**: Rotation around the X-axis (looking up and down). This is controlled by the `Camera`'s rotation, which is a child of the player's `GameObject`. This is a standard approach for FPS cameras to avoid camera roll when pitching and yawing simultaneously.

## 3. API Reference

### `Engine.js`

The central class that manages the entire application.

| Property/Method             | Description                                                                                                                              |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `constructor(canvasId)`     | Initializes `Renderer`, `InputManager`, and creates an empty list of game objects.                                                      |
| `renderer`                  | An instance of the `Renderer` class.                                                                                                    |
| `inputManager`              | An instance of the `InputManager` class.                                                                                                |
| `setPlayer(gameObject)`     | Sets the provided `GameObject` as the player. This is needed for the `Renderer` to display its coordinates in the UI.                      |
| `addGameObject(gameObject)` | Adds a `GameObject` to the engine. The object is added to the update list, and its `transform` is added to the THREE.js scene.            |
| `start()`                   | Starts the game loop. Before that, it calls the `start()` method on all added `GameObject`s for one-time initialization.                  |
| `gameLoop()`                | The main method that executes every frame. Described above.                                                                              |

---

### `GameObject.js`

A container for components, representing an object in the game world.

| Property/Method                            | Description                                                                                                                                                                 |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `constructor(name)`                        | Creates an object with a name and a `THREE.Object3D` as its `transform`.                                                                                                    |
| `transform`                                | An instance of `THREE.Object3D`. It contains the object's `position`, `rotation`, and `scale`. All child objects (like a camera) move with it.                                 |
| `addComponent(ComponentClass, ...args)`    | Creates an instance of `ComponentClass`, passing itself (`this`) and all other arguments (`...args`). Adds the component to the object. Returns the created component.      |
| `getComponent(ComponentClass)`             | Finds and returns the first component of the specified class attached to this object. Useful for interaction between components.                                            |
| `start()`                                  | Called by the engine once before the first frame. Delegates the call to all its components.                                                                                 |
| `update(deltaTime)`                        | Called by the engine every frame. Delegates the call to all its components, passing `deltaTime`.                                                                              |

---

### `Component.js`

The base class for all game logic. **This class is not used directly; it must be inherited from.**

| Property/Method           | Description                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `constructor(gameObject)` | Accepts the parent `GameObject` and stores references to it and its `transform` for easy access.                                            |
| `gameObject`              | A reference to the `GameObject` to which the component is attached.                                                                         |
| `transform`               | A convenient reference to `gameObject.transform`.                                                                                           |
| `engine`                  | A reference to the main `Engine`. It is set automatically by the engine.                                                                    |
| `start()`                 | **(Overridable)**. Called once before the first frame. Used for initialization (e.g., finding other components).                            |
| `update(deltaTime)`       | **(Overridable)**. Called every frame. All of the component's main logic should be here.                                                    |

---

### `InputManager.js`

Manages keyboard and mouse input, including Pointer Lock mode.

| Property/Method              | Description                                                                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `constructor(targetElement)` | Accepts a DOM element (usually the `<canvas>`), which will request Pointer Lock on click. Sets up all event listeners.                                                            |
| `keys`                       | An object that stores the state of the keys. For example, `keys['KeyW']` will be `true` if W is held down.                                                                         |
| `mouseDelta`                 | An object `{x, y}` that accumulates the mouse movement since the last reset.                                                                                                   |
| `onKeyDown(event)`           | Key press handler. If Pointer Lock is active, it prevents the browser's default action (`event.preventDefault()`) for most keys to avoid unwanted game interruptions.            |
| `isKeyDown(key)`             | Returns `true` if the key with the code `key` (e.g., `'Space'`, `'KeyA'`) is currently pressed.                                                                                     |
| `getMouseDelta()`            | Returns the accumulated mouse movement for the frame.                                                                                                                          |
| `resetMouseDelta()`          | Resets the accumulated mouse delta to 0. Called by the engine at the end of each frame.                                                                                        |

---

### `Renderer.js`

Responsible for all graphics, using THREE.js.

| Property/Method                  | Description                                                                                                                                        |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `constructor(canvasId)`          | Initializes the THREE.js scene, camera, and renderer, and configures them. Finds the DOM elements for displaying the UI.                             |
| `domElement`                     | A getter that returns the `<canvas>` element used for rendering. It is needed by `InputManager`.                                                       |
| `render()`                       | Calls `renderer.render(scene, camera)`, drawing the current state of the scene.                                                                     |
| `updateUI(fps, playerTransform)` | Updates the text fields on the screen. Displays the FPS and data about the player's position and rotation (`playerTransform`).                        |

---

## 4. How It Works Together: Example of Creating a Player

Let's say we want to create a controllable player.

**1. Create the `PlayerController.js` component:**

```javascript
// Lumina/js/game/components/PlayerController.js
import { Component } from '../../core/Component.js';

export class PlayerController extends Component {
    constructor(gameObject, speed = 5, sensitivity = 0.002) {
        super(gameObject);
        this.speed = speed;
        this.sensitivity = sensitivity;
        this.camera = this.engine.renderer.camera; // Get the camera
        
        // Attach the camera to the player so it moves with it
        this.transform.add(this.camera); 
    }

    start() {
        // Initial setup, if needed
    }

    update(deltaTime) {
        const input = this.engine.inputManager;

        // Rotation (Yaw/Pitch)
        const mouseDelta = input.getMouseDelta();
        // Rotate the player on the Y-axis (left/right)
        this.transform.rotation.y -= mouseDelta.x * this.sensitivity;
        // Rotate the camera on the X-axis (up/down)
        this.camera.rotation.x -= mouseDelta.y * this.sensitivity;
        
        // Clamp the vertical rotation (pitch)
        this.camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.camera.rotation.x));
        
        // Movement (WASD)
        const moveDirection = new THREE.Vector3();
        if (input.isKeyDown('KeyW')) moveDirection.z -= 1;
        if (input.isKeyDown('KeyS')) moveDirection.z += 1;
        if (input.isKeyDown('KeyA')) moveDirection.x -= 1;
        if (input.isKeyDown('KeyD')) moveDirection.x += 1;

        if (moveDirection.lengthSq() > 0) {
            moveDirection.normalize();
            // Apply the player's rotation to the movement direction
            moveDirection.applyQuaternion(this.transform.quaternion); 
            
            this.transform.position.add(moveDirection.multiplyScalar(this.speed * deltaTime));
        }
    }
}
```

**2. Use it in the main game file (`main.js`):**

```javascript
// Lumina/js/game/main.js
import { Engine } from '../core/Engine.js';
import { GameObject } from '../core/GameObject.js';
import { PlayerController } from './components/PlayerController.js';

// 1. Create the engine
const engine = new Engine('game-canvas');

// 2. Create a GameObject for the player
const player = new GameObject('Player');
player.transform.position.set(0, 1.7, 5); // Initial position

// 3. Add the controller component to the player
// Pass speed and sensitivity as arguments
player.addComponent(PlayerController, 5, 0.002);

// 4. Add the player to the engine
engine.addGameObject(player);
engine.setPlayer(player); // Set it as the main player

// 5. ... (create the world, other objects) ...

// 6. Start the game
engine.start();
```

This example demonstrates the full power of the component architecture:
*   `GameObject` is just a point in space.
*   `PlayerController` adds all the movement and look logic.
*   `Engine` ties it all together and makes it run in a loop.
