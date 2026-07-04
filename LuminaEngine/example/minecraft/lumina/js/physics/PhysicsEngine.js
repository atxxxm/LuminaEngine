// Lumina/js/physics/PhysicsEngine.js
//
// Пооосевые коллизии AABB против воксельного мира: тело двигается и
// разрешается отдельно по Y, X, Z. Это надёжнее прежнего «сдвинуть сразу
// по всем осям и вытолкнуть по минимальному перекрытию» (меньше застреваний
// и туннелирования) и, главное, делает чистым авто-шаг на 1 блок.
//
// Плюс физика воды: в воде слабее гравитация (выталкивание) и есть
// вертикальное демпфирование, так что игрок не проваливается камнем, а
// медленно тонет и может выгребать вверх (см. PlayerController).

import { BoxCollider } from './Colliders.js';
import { BLOCK } from '../../../game/blocks.js';
import * as THREE from 'three';

const EPS = 1e-3;
const STEP_HEIGHT = 1.05; // на сколько авто-шаг поднимает тело (чуть больше блока)

export class PhysicsEngine {
    constructor() {
        this.rigidBodies = [];
        this.gravity = new THREE.Vector3(0, -20, 0);
        this.world = null;
    }

    setWorld(world) {
        this.world = world;
    }

    addRigidBody(body) {
        this.rigidBodies.push(body);
    }

    isSolidAt(x, y, z) {
        return BLOCK.get(this.world.getVoxel(x, y, z)).isSolid;
    }

    isWaterAt(x, y, z) {
        return this.world.getVoxel(x, y, z) === BLOCK.WATER;
    }

    update(deltaTime) {
        if (!this.world) return;
        // Ограничиваем dt: на редком большом кадре (после подгрузки региона)
        // тело иначе может «прошить» блок за один шаг.
        const dt = Math.min(deltaTime, 0.05);

        for (const body of this.rigidBodies) {
            if (body.bodyType !== 'dynamic') continue;
            const collider = body.gameObject.getComponent(BoxCollider);
            if (!collider) continue;
            const half = collider.halfSize;

            body.inWater = this.bodyInWater(body, half);

            const g = body.inWater ? this.gravity.y * 0.28 : this.gravity.y;
            body.velocity.y += g * dt;

            if (body.inWater) {
                // Демпфирование, независимое от частоты кадров.
                const vDrag = Math.pow(0.55, dt * 60);
                const hDrag = Math.pow(0.85, dt * 60);
                body.velocity.y *= vDrag;
                body.velocity.x *= hDrag;
                body.velocity.z *= hDrag;
            } else if (body.velocity.y < -60) {
                body.velocity.y = -60; // терминальная скорость падения
            }

            this.moveAndCollide(body, half, dt);

            // Плавно гасим визуальный "довесок" от авто-шага (см. tryStepUp) —
            // сама позиция тела уже мгновенно на новой высоте (нужно для
            // корректных коллизий), а это только для камеры, чтобы шаг не
            // выглядел телепортом. Множитель не зависит от FPS.
            if (body.stepVisualOffset !== 0) {
                body.stepVisualOffset *= Math.pow(0.0001, dt);
                if (Math.abs(body.stepVisualOffset) < 0.001) body.stepVisualOffset = 0;
            }
        }
    }

    bodyInWater(body, half) {
        const pos = body.transform.position;
        // Тело в воде, если вода на уровне ног или центра.
        const feetY = pos.y - half.y + 0.1;
        return (
            this.isWaterAt(Math.floor(pos.x), Math.floor(feetY), Math.floor(pos.z)) ||
            this.isWaterAt(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z))
        );
    }

    moveAndCollide(body, half, dt) {
        const pos = body.transform.position;
        const vel = body.velocity;
        body.isGrounded = false;

        // Целевые горизонтальные координаты (до разрешения) — понадобятся
        // авто-шагу, т.к. resolveAxis обнуляет vel по заблокированной оси.
        const targetX = pos.x + vel.x * dt;
        const targetZ = pos.z + vel.z * dt;

        pos.y += vel.y * dt;
        this.resolveAxis(body, half, 'y');

        pos.x = targetX;
        const hitX = this.resolveAxis(body, half, 'x');

        pos.z = targetZ;
        const hitZ = this.resolveAxis(body, half, 'z');

        if (body.canStep && body.isGrounded && !body.inWater && (hitX || hitZ)) {
            this.tryStepUp(body, half, targetX, targetZ);
        }
    }

    // Двигает тело только что сдвинули по оси `axis`; выталкивает из твёрдых
    // блоков вдоль этой оси. Возвращает true при столкновении.
    resolveAxis(body, half, axis) {
        const pos = body.transform.position;
        const vel = body.velocity;
        const dir = vel[axis];
        if (dir === 0) return false; // по этой оси в этом кадре не двигались

        const bMin = { x: pos.x - half.x, y: pos.y - half.y, z: pos.z - half.z };
        const bMax = { x: pos.x + half.x, y: pos.y + half.y, z: pos.z + half.z };
        const lo = { x: Math.floor(bMin.x), y: Math.floor(bMin.y), z: Math.floor(bMin.z) };
        const hi = { x: Math.floor(bMax.x), y: Math.floor(bMax.y), z: Math.floor(bMax.z) };

        let corrected = null;
        for (let y = lo.y; y <= hi.y; y++) {
            for (let z = lo.z; z <= hi.z; z++) {
                for (let x = lo.x; x <= hi.x; x++) {
                    if (!this.isSolidAt(x, y, z)) continue;
                    // Реальное перекрытие по всем трём осям (не просто попадание
                    // в диапазон клеток) — иначе блок сбоку ложно засчитается.
                    if (!(bMin.x < x + 1 - EPS && bMax.x > x + EPS)) continue;
                    if (!(bMin.y < y + 1 - EPS && bMax.y > y + EPS)) continue;
                    if (!(bMin.z < z + 1 - EPS && bMax.z > z + EPS)) continue;

                    const cell = { x, y, z };
                    const blockMin = cell[axis];
                    const blockMax = cell[axis] + 1;
                    const np = dir > 0 ? blockMin - half[axis] : blockMax + half[axis];
                    if (corrected === null) corrected = np;
                    else corrected = dir > 0 ? Math.min(corrected, np) : Math.max(corrected, np);
                }
            }
        }

        if (corrected !== null) {
            pos[axis] = corrected;
            if (axis === 'y' && dir < 0) body.isGrounded = true;
            vel[axis] = 0;
            return true;
        }
        return false;
    }

    // Тело есть на земле, но его горизонтально заблокировало. Пробуем поднять
    // на STEP_HEIGHT к желаемой горизонтальной позиции — если там свободно,
    // «залезаем» на ступеньку (иначе откатываемся к заблокированной точке).
    // Физическая позиция сдвигается мгновенно (нужно для корректных
    // коллизий/raycast), но чтобы это не выглядело телепортом на экране,
    // копим отрицательный визуальный "довесок" — камера (см.
    // PlayerController) рисуется на body.stepVisualOffset ниже реальной
    // позиции и он сам плавно гасится к нулю в update().
    tryStepUp(body, half, targetX, targetZ) {
        const pos = body.transform.position;
        const blockedX = pos.x, blockedY = pos.y, blockedZ = pos.z;

        pos.y = blockedY + STEP_HEIGHT;
        pos.x = targetX;
        pos.z = targetZ;

        if (this.isFree(pos, half)) {
            body.velocity.y = 0; // не «выстреливаем» вверх — осядем гравитацией
            body.isGrounded = true;
            body.stepVisualOffset -= (pos.y - blockedY);
        } else {
            pos.set(blockedX, blockedY, blockedZ);
        }
    }

    // Свободна ли AABB от твёрдых блоков в текущей позиции.
    isFree(pos, half) {
        const bMin = { x: pos.x - half.x, y: pos.y - half.y, z: pos.z - half.z };
        const bMax = { x: pos.x + half.x, y: pos.y + half.y, z: pos.z + half.z };
        const lo = { x: Math.floor(bMin.x), y: Math.floor(bMin.y), z: Math.floor(bMin.z) };
        const hi = { x: Math.floor(bMax.x), y: Math.floor(bMax.y), z: Math.floor(bMax.z) };
        for (let y = lo.y; y <= hi.y; y++) {
            for (let z = lo.z; z <= hi.z; z++) {
                for (let x = lo.x; x <= hi.x; x++) {
                    if (!this.isSolidAt(x, y, z)) continue;
                    if (bMin.x < x + 1 - EPS && bMax.x > x + EPS &&
                        bMin.y < y + 1 - EPS && bMax.y > y + EPS &&
                        bMin.z < z + 1 - EPS && bMax.z > z + EPS) {
                        return false;
                    }
                }
            }
        }
        return true;
    }
}
