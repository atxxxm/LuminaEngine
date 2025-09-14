// example/3dGame/js/main.js

import * as THREE from 'three';
import { Engine } from 'engine/js/core/Engine.js';
import { GameObject } from 'engine/js/core/GameObject.js';
import { RigidBody } from 'engine/js/physics/RigidBody.js';
import { BoxCollider, HeightfieldCollider } from 'engine/js/physics/Colliders.js';
import { PlayerController } from './PlayerController.js';

const engine = new Engine('game-canvas');

function setupScene() {
    engine.renderer.scene.background = new THREE.Color(0x87ceeb);
    engine.renderer.scene.fog = new THREE.Fog(0x87ceeb, 0, 150);
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    engine.renderer.scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(-30, 50, -30);
    engine.renderer.scene.add(directionalLight);
}

function createTerrain() {
    const terrainSize = 1024;
    const segments = 1024;
    const geometry = new THREE.PlaneGeometry(terrainSize, terrainSize, segments, segments);
    const positions = geometry.attributes.position;
    const noise = (x, y) => (Math.sin(x * 0.1) + Math.sin(y * 0.15)) * 2 + (Math.sin(x * 0.05) + Math.cos(y * 0.03)) * 4;
    
    for (let i = 0; i < positions.count; i++) {
        positions.setZ(i, noise(positions.getX(i), positions.getY(i))); 
    }
    geometry.computeVertexNormals();

    const textureLoader = new THREE.TextureLoader();
    // Пути к текстурам изменены, теперь они ведут в локальную папку assets
    const grassTexture = textureLoader.load('assets/grass-tile.png'); // <-- ИЗМЕНЕНО
    grassTexture.wrapS = THREE.RepeatWrapping;
    grassTexture.wrapT = THREE.RepeatWrapping;
    grassTexture.repeat.set(100, 100);

    const material = new THREE.MeshLambertMaterial({ map: grassTexture });
    const wireframeMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true });
    const terrainMesh = new THREE.Mesh(geometry, material);
    const terrain = new GameObject('Terrain');
    terrain.transform.add(terrainMesh);
    terrain.transform.rotation.x = -Math.PI / 2;

    terrain.addComponent(RigidBody, { bodyType: 'static' });
    terrain.addComponent(HeightfieldCollider, geometry, segments, segments);
    engine.addGameObject(terrain);
}

function createSun() {
    const textureLoader = new THREE.TextureLoader();
    // Путь к солнцу также изменен
    const sunTexture = textureLoader.load('assets/sun.png'); // <-- ИЗМЕНЕНО
    const sunMaterial = new THREE.SpriteMaterial({ map: sunTexture, color: 0xffffee, fog: false });
    const sunSprite = new THREE.Sprite(sunMaterial);
    sunSprite.position.set(-150, 200, -250);
    sunSprite.scale.set(100, 100, 1);
    engine.renderer.scene.add(sunSprite);
}

function createPlayer() {
    const player = new GameObject('Player');
    player.transform.position.set(0, 15, 0);
    player.addComponent(RigidBody, { bodyType: 'dynamic' });
    player.addComponent(BoxCollider, new THREE.Vector3(0.8, 1.8, 0.8));
    player.addComponent(PlayerController);
    engine.addGameObject(player);
    engine.setPlayer(player);
}

setupScene();
createSun();
createTerrain();
createPlayer();
engine.start();