// Lumina/js/physics/RigidBody.js

import { Component } from '../core/Component.js';
import * as THREE from 'three';

export class RigidBody extends Component {
    constructor(gameObject, options = {}) {
        super(gameObject);
        
        // 'dynamic' - объект, подверженный гравитации и столкновениям
        // 'static' - объект, который не двигается
        this.bodyType = options.bodyType || 'dynamic';
        
        // Скорость объекта
        this.velocity = new THREE.Vector3();

        // Находится ли объект на земле (для прыжков)
        this.isGrounded = false;

        // Выставляется движком: тело сейчас в воде (плавучесть/сопротивление).
        this.inWater = false;

        // Разрешать авто-шаг на 1 блок (включает PlayerController для игрока).
        this.canStep = options.canStep || false;

        // Визуальная поправка камеры при авто-шаге — см. PhysicsEngine.tryStepUp.
        this.stepVisualOffset = 0;
    }

    start() {
        this.engine.physicsEngine.addRigidBody(this);
    }
}
