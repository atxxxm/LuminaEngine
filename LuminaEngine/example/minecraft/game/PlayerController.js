// game/PlayerController.js
import { Component } from '../Lumina/js/core/Component.js';
import { RigidBody } from '../Lumina/js/physics/RigidBody.js';
import * as THREE from 'three';

export class PlayerController extends Component {
    constructor(gameObject) {
        super(gameObject);
        this.camera = null;
        this.rigidBody = null;

        this.moveSpeed = 4.0;
        this.runSpeed = 7.0;
        this.crouchSpeed = 2.0;
        this.swimSpeed = 3.5;
        this.jumpForce = 8;
        this.swimUpForce = 4.5;
        this.swimDownForce = 3.5;

        // Куда возвращать при падении в пустоту. Задаётся из main.js
        // (точка спавна нового мира или сохранённая позиция).
        this.spawnPoint = new THREE.Vector3(8.5, 70, 8.5);

        // Настройка из меню "Настройки" (main.js), хранится отдельно от
        // сохранений миров — это предпочтение игрока, а не часть мира.
        const savedSensitivity = parseFloat(localStorage.getItem('luminaCraftMouseSensitivity'));
        this.mouseSensitivity = Number.isFinite(savedSensitivity) ? savedSensitivity : 0.002;

        this.isCrouching = false;
        this.standHeight = 0.8;
        this.crouchHeight = 0.6;
        // Лерпнутая высота камеры (присед) без учёта rigidBody.stepVisualOffset —
        // тот добавляется поверх при записи в camera.position.y, а не мешается
        // с этим значением, иначе шаг и присед "боролись" бы за одну переменную.
        this.cameraHeight = this.standHeight;
    }

    start() {
        this.rigidBody = this.gameObject.getComponent(RigidBody);
        if (!this.rigidBody) {
            console.error("PlayerController requires a RigidBody component.");
            return;
        }

        this.rigidBody.canStep = true; // авто-шаг на 1 блок

        this.camera = this.engine.renderer.camera;
        this.transform.add(this.camera);
        this.camera.position.set(0, this.standHeight, 0);
        // Камера — общий на все сессии объект (engine.renderer.camera):
        // без сброса в новый мир унаследовался бы поворот из прошлого.
        this.camera.rotation.set(0, 0, 0);
    }

    onDestroy() {
        // Снимаем камеру с transform игрока — иначе при выходе в меню она
        // осталась бы ребёнком удаляемого объекта.
        if (this.camera && this.camera.parent) {
            this.camera.parent.remove(this.camera);
        }
    }

    update(deltaTime) {
        // --- Защита от падения в пустоту ---
        if (this.transform.position.y < -8) {
            // Респавн к реальной точке спавна мира (раньше был хардкод).
            this.transform.position.copy(this.spawnPoint);
            this.rigidBody.velocity.set(0, 0, 0); // остановить падение
            return; // пропускаем остальную логику в этом кадре
        }
        
        if (!this.engine.inputManager.isPointerLocked()) {
            this.rigidBody.velocity.x = 0;
            this.rigidBody.velocity.z = 0;
            return;
        }

        // Camera rotation
        const mouseDelta = this.engine.inputManager.getMouseDelta();
        this.transform.rotateY(-mouseDelta.x * this.mouseSensitivity);
        this.camera.rotateX(-mouseDelta.y * this.mouseSensitivity);

        // Clamp camera pitch
        const maxPitch = Math.PI / 2 * 0.99;
        this.camera.rotation.x = THREE.MathUtils.clamp(this.camera.rotation.x, -maxPitch, maxPitch);

        // Movement
        const input = this.engine.inputManager;
        const moveDirection = new THREE.Vector3();
        if (input.isKeyDown('KeyW')) moveDirection.z -= 1;
        if (input.isKeyDown('KeyS')) moveDirection.z += 1;
        if (input.isKeyDown('KeyA')) moveDirection.x -= 1;
        if (input.isKeyDown('KeyD')) moveDirection.x += 1;

        if (moveDirection.lengthSq() > 0) {
            moveDirection.normalize().applyQuaternion(this.transform.quaternion);
        }

        // Speed modification
        this.isCrouching = input.isKeyDown('ControlLeft');
        const isRunning = input.isKeyDown('ShiftLeft') && !this.isCrouching;
        const inWater = this.rigidBody.inWater;
        const currentSpeed = inWater
            ? this.swimSpeed
            : (this.isCrouching ? this.crouchSpeed : (isRunning ? this.runSpeed : this.moveSpeed));

        this.rigidBody.velocity.x = moveDirection.x * currentSpeed;
        this.rigidBody.velocity.z = moveDirection.z * currentSpeed;

        // Crouching height adjust + плавная поправка от авто-шага (см.
        // PhysicsEngine.tryStepUp / RigidBody.stepVisualOffset) — без неё
        // подъём на ступеньку выглядел бы мгновенным телепортом камеры.
        const targetHeight = this.isCrouching ? this.crouchHeight : this.standHeight;
        this.cameraHeight = THREE.MathUtils.lerp(this.cameraHeight, targetHeight, deltaTime * 10);
        this.camera.position.y = this.cameraHeight + this.rigidBody.stepVisualOffset;

        if (inWater) {
            // В воде Space — выгребать вверх, Ctrl — вниз; иначе плавучесть
            // из PhysicsEngine медленно тянет ко дну.
            if (input.isKeyDown('Space')) {
                this.rigidBody.velocity.y = this.swimUpForce;
            } else if (input.isKeyDown('ControlLeft')) {
                this.rigidBody.velocity.y = -this.swimDownForce;
            }
        } else if (input.wasKeyJustPressed('Space') && this.rigidBody.isGrounded) {
            this.rigidBody.velocity.y = this.jumpForce;
        }
    }
}