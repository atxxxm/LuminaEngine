// example/3dGame/js/PlayerController.js

import * as THREE from 'three';
import { Component } from 'engine/js/core/Component.js';
import { RigidBody } from 'engine/js/physics/RigidBody.js';

export class PlayerController extends Component {
    constructor(gameObject) {
        super(gameObject);
        this.moveSpeed = 5.0;
        this.jumpForce = 6.0;
        this.mouseSensitivity = 0.002;
        
        this.pitch = 0;
        this.yaw = 0;

        this.moveDirection = new THREE.Vector3();
    }

    start() {
        this.rigidBody = this.gameObject.getComponent(RigidBody); // RigidBody теперь импортируется
        if (!this.rigidBody) {
            console.error('PlayerController requires a RigidBody component.');
        }

        this.camera = this.engine.renderer.camera;
        this.transform.add(this.camera);
        this.camera.position.set(0, 1.6, 0);
    }

    update(deltaTime) {
        this.handleMouseLook();
        this.handleMovement(deltaTime);
    }

    handleMouseLook() {
        const mouseDelta = this.engine.inputManager.getMouseDelta();
        this.yaw -= mouseDelta.x * this.mouseSensitivity;
        this.pitch -= mouseDelta.y * this.mouseSensitivity;
        this.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.pitch));
        this.transform.rotation.y = this.yaw;
        this.camera.rotation.x = this.pitch;
    }

    handleMovement(deltaTime) {
        if (!this.rigidBody) return;
        const input = this.engine.inputManager;

        this.rigidBody.velocity.x = 0;
        this.rigidBody.velocity.z = 0;
        this.moveDirection.set(0, 0, 0);

        if (input.isKeyDown('KeyW')) this.moveDirection.z -= 1;
        if (input.isKeyDown('KeyS')) this.moveDirection.z += 1;
        if (input.isKeyDown('KeyA')) this.moveDirection.x -= 1;
        if (input.isKeyDown('KeyD')) this.moveDirection.x += 1;
        if (input.isKeyDown('ShiftLeft')) {
            this.moveSpeed = 10.0;
        } else {
            this.moveSpeed = 5.0;
        }

        if (this.moveDirection.lengthSq() > 0) {
            this.moveDirection.normalize().multiplyScalar(this.moveSpeed);
            this.moveDirection.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
            this.rigidBody.velocity.x = this.moveDirection.x;
            this.rigidBody.velocity.z = this.moveDirection.z;
        }

        if (input.wasKeyJustPressed('Space') && this.rigidBody.isGrounded) {
            this.rigidBody.velocity.y = this.jumpForce;
        }
    }
}