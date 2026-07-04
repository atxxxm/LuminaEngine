// game/DayNightCycle.js
import { Component } from '../Lumina/js/core/Component.js';
import * as THREE from 'three';

export class DayNightCycle extends Component {
    constructor(gameObject) {
        super(gameObject);
        this.dayDuration = 600; // 10 minutes per day
        this.time = this.dayDuration * 0.25; // Start at morning

        this.sun = null;
        this.ambientLight = null;
        this.fog = null;

        this.dayColor = new THREE.Color(0x87ceeb);
        this.nightColor = new THREE.Color(0x000033);
        this.sunsetColor = new THREE.Color(0xff8c00);
        this.skyColor = new THREE.Color();
    }

    start() {
        const scene = this.engine.renderer.scene;

        this.sun = new THREE.DirectionalLight(0xffffff, 1);
        this.sun.position.set(0, 1, 0);
        scene.add(this.sun);

        // Тени от солнца. Без shadow mapping свет проходит сквозь блоки, и
        // пещеры получались освещены не хуже поверхности. Фрустум тени —
        // не на весь мир (это нереально), а небольшой ортографический бокс,
        // который каждый кадр следует за игроком (см. update()).
        this.sun.castShadow = true;
        this.sun.shadow.mapSize.set(2048, 2048);
        const shadowRange = 48;
        this.sun.shadow.camera.left = -shadowRange;
        this.sun.shadow.camera.right = shadowRange;
        this.sun.shadow.camera.top = shadowRange;
        this.sun.shadow.camera.bottom = -shadowRange;
        this.sun.shadow.camera.near = 1;
        this.sun.shadow.camera.far = 220;
        this.sun.shadow.bias = -0.0015;

        this.sun.target = new THREE.Object3D();
        scene.add(this.sun.target);

        this.ambientLight = new THREE.AmbientLight(0xcccccc, 0.2);
        scene.add(this.ambientLight);

        this.fog = new THREE.Fog(0x87ceeb, 0, 128);
        scene.fog = this.fog;
    }

    update(deltaTime) {
        this.time = (this.time + deltaTime) % this.dayDuration;
        const angle = (this.time / this.dayDuration) * 2 * Math.PI;

        const sunX = Math.cos(angle);
        const sunY = Math.sin(angle);

        // Направление света то же (sunX, sunY, 0.5), но теперь и сам свет, и
        // цель тени привязаны к позиции игрока — иначе ортографический
        // фрустум тени (фиксированного размера) остался бы висеть у начала
        // координат мира и не покрывал бы игрока при удалении от спавна.
        const player = this.engine.player;
        const origin = player ? player.transform.position : this.sun.target.position;
        const distance = 80;
        this.sun.position.set(
            origin.x + sunX * distance,
            origin.y + sunY * distance,
            origin.z + 0.5 * distance
        );
        this.sun.target.position.copy(origin);

        // Light intensity
        this.sun.intensity = Math.max(0, sunY) * 1.2 + 0.1;
        this.ambientLight.intensity = Math.max(0.1, sunY * 0.5) + 0.1;

        // Sky color and fog
        if (sunY > 0.1) {
            this.skyColor.copy(this.dayColor);
        } else if (sunY > -0.1) {
            this.skyColor.copy(this.dayColor).lerp(this.sunsetColor, 1 - (sunY + 0.1) / 0.2);
        } else {
            this.skyColor.copy(this.sunsetColor).lerp(this.nightColor, 1 - (sunY + 0.2) / 0.1);
        }

        this.engine.renderer.scene.background = this.skyColor;
        this.fog.color = this.skyColor;
    }

    onDestroy() {
        // Свет и туман добавлены прямо в сцену, а не в transform, поэтому
        // Engine.stop() их не уберёт — иначе каждый следующий заход в мир
        // добавлял бы ещё одно солнце/ambient, а мир становился всё ярче.
        const scene = this.engine.renderer.scene;
        if (this.sun) {
            scene.remove(this.sun);
            if (this.sun.target) scene.remove(this.sun.target);
        }
        if (this.ambientLight) scene.remove(this.ambientLight);
        scene.fog = null;
        scene.background = null;
    }
}