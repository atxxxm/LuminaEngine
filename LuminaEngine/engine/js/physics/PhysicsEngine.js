// Lumina/js/physics/PhysicsEngine.js

import { Collider, BoxCollider, HeightfieldCollider } from './Colliders.js';
import * as THREE from 'three';

export class PhysicsEngine {
    constructor() {
        this.rigidBodies = [];
        this.gravity = new THREE.Vector3(0, -9.81, 0);
    }

    addRigidBody(body) {
        this.rigidBodies.push(body);
    }

    update(deltaTime) {
        this.rigidBodies.forEach(body => {
            if (body.bodyType === 'dynamic') {
                body.velocity.y += this.gravity.y * deltaTime;
                body.transform.position.add(body.velocity.clone().multiplyScalar(deltaTime));
                body.isGrounded = false;
            }
        });

        const iterations = 4;
        for (let i = 0; i < iterations; i++) {
            this.detectAndResolveCollisions();
        }
    }

    detectAndResolveCollisions() {
        for (let i = 0; i < this.rigidBodies.length; i++) {
            for (let j = i + 1; j < this.rigidBodies.length; j++) {
                const bodyA = this.rigidBodies[i];
                const bodyB = this.rigidBodies[j];

                if (bodyA.bodyType === 'static' && bodyB.bodyType === 'static') continue;

                const colliderA = bodyA.gameObject.getComponent(Collider);
                const colliderB = bodyB.gameObject.getComponent(Collider);

                if (colliderA && colliderB) {
                    if (colliderA.type === 'box' && colliderB.type === 'box') {
                        this.resolveAABBCollision(bodyA, bodyB, colliderA, colliderB);
                    }
                    else if (colliderA.type === 'box' && colliderB.type === 'heightfield') {
                        this.resolveBoxVsHeightfield(bodyA, bodyB, colliderA, colliderB);
                    }
                    else if (colliderA.type === 'heightfield' && colliderB.type === 'box') {
                        this.resolveBoxVsHeightfield(bodyB, bodyA, colliderB, colliderA);
                    }
                }
            }
        }
    }

    resolveBoxVsHeightfield(boxBody, hfBody, boxCollider, hfCollider) {
        if (boxBody.bodyType !== 'dynamic') return;

        const boxPos = boxBody.transform.position;
        const boxHalfSize = boxCollider.halfSize;

        const corners = [
            new THREE.Vector3(boxPos.x - boxHalfSize.x, boxPos.y - boxHalfSize.y, boxPos.z - boxHalfSize.z),
            new THREE.Vector3(boxPos.x + boxHalfSize.x, boxPos.y - boxHalfSize.y, boxPos.z - boxHalfSize.z),
            new THREE.Vector3(boxPos.x - boxHalfSize.x, boxPos.y - boxHalfSize.y, boxPos.z + boxHalfSize.z),
            new THREE.Vector3(boxPos.x + boxHalfSize.x, boxPos.y - boxHalfSize.y, boxPos.z + boxHalfSize.z),
        ];

        let maxPenetration = 0;

        for (const corner of corners) {
            const terrainHeight = hfCollider.getHeightAt(corner.x, corner.z);
            const penetration = terrainHeight - corner.y;

            if (penetration > maxPenetration) {
                maxPenetration = penetration;
            }
        }

        if (maxPenetration > 0) {
            boxBody.transform.position.y += maxPenetration;
            boxBody.velocity.y = 0;
            boxBody.isGrounded = true;
        }
    }

    resolveAABBCollision(bodyA, bodyB, colliderA, colliderB) {
        const posA = bodyA.transform.position;
        const posB = bodyB.transform.position;
        const halfSizeA = colliderA.halfSize;
        const halfSizeB = colliderB.halfSize;

        const delta = new THREE.Vector3().subVectors(posB, posA);
        const overlap = new THREE.Vector3(
            (halfSizeA.x + halfSizeB.x) - Math.abs(delta.x),
            (halfSizeA.y + halfSizeB.y) - Math.abs(delta.y),
            (halfSizeA.z + halfSizeB.z) - Math.abs(delta.z)
        );

        if (overlap.x > 0 && overlap.y > 0 && overlap.z > 0) {
            const minOverlapAxis = this.findMinOverlapAxis(overlap);
            const penetration = overlap[minOverlapAxis];
            const normal = new THREE.Vector3();
            normal[minOverlapAxis] = Math.sign(delta[minOverlapAxis]);

            if (bodyA.bodyType === 'dynamic' && bodyB.bodyType === 'static') {
                posA.sub(normal.clone().multiplyScalar(penetration));
            } else if (bodyA.bodyType === 'static' && bodyB.bodyType === 'dynamic') {
                posB.add(normal.clone().multiplyScalar(penetration));
            } else if (bodyA.bodyType === 'dynamic' && bodyB.bodyType === 'dynamic') {
                const halfMove = normal.clone().multiplyScalar(penetration * 0.5);
                posA.sub(halfMove);
                posB.add(halfMove);
            }

                        if (minOverlapAxis === 'y') {
                if (normal.y < -0.7) {
                    if (bodyA.bodyType === 'dynamic') { bodyA.isGrounded = true; bodyA.velocity.y = 0; }
                }
                if (normal.y > 0.7) {
                    if (bodyB.bodyType === 'dynamic') { bodyB.isGrounded = true; bodyB.velocity.y = 0; }
                }
            }
        }
    }

    findMinOverlapAxis(overlap) {
        if (overlap.x < overlap.y) {
            return overlap.x < overlap.z ? 'x' : 'z';
        } else {
            return overlap.y < overlap.z ? 'y' : 'z';
        }
    }
}