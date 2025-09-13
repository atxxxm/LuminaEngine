// Lumina/game/Maze/Maze.js

import { Engine } from '../../js/core/Engine.js';
import { GameObject } from '../../js/core/GameObject.js';
import { Component } from '../../js/core/Component.js';

class MazeGenerator {
    constructor(width, height) {
        this.width = width % 2 === 0 ? width + 1 : width;
        this.height = height % 2 === 0 ? height + 1 : height;
        this.grid = [];
    }
    
    generate() {
        for (let y = 0; y < this.height; y++) { this.grid[y] = []; for (let x = 0; x < this.width; x++) { this.grid[y][x] = 1; } }
        const stack = [];
        let startX = Math.floor(Math.random() * (this.width / 2)) * 2 + 1;
        let startY = Math.floor(Math.random() * (this.height / 2)) * 2 + 1;
        this.grid[startY][startX] = 0;
        stack.push([startX, startY]);
        while (stack.length > 0) {
            let [currentX, currentY] = stack[stack.length - 1];
            const neighbors = [];
            if (currentX > 1 && this.grid[currentY][currentX - 2] === 1) neighbors.push([currentX - 2, currentY]);
            if (currentX < this.width - 2 && this.grid[currentY][currentX + 2] === 1) neighbors.push([currentX + 2, currentY]);
            if (currentY > 1 && this.grid[currentY - 2][currentX] === 1) neighbors.push([currentX, currentY - 2]);
            if (currentY < this.height - 2 && this.grid[currentY + 2][currentX] === 1) neighbors.push([currentX, currentY + 2]);
            if (neighbors.length > 0) {
                const [nextX, nextY] = neighbors[Math.floor(Math.random() * neighbors.length)];
                this.grid[(currentY + nextY) / 2][(currentX + nextX) / 2] = 0;
                this.grid[nextY][nextX] = 0;
                stack.push([nextX, nextY]);
            } else { stack.pop(); }
        }
        const exit = this.createExit();
        return { grid: this.grid, exit: exit };
    }

    createExit() {
        const borderCells = [];
        for (let x = 0; x < this.width; x++) {
            if (this.grid[1][x] === 0) borderCells.push({ x, y: 0 });
            if (this.grid[this.height - 2][x] === 0) borderCells.push({ x, y: this.height - 1 });
        }
        for (let y = 0; y < this.height; y++) {
            if (this.grid[y][1] === 0) borderCells.push({ x: 0, y });
            if (this.grid[y][this.width - 2] === 0) borderCells.push({ x: this.width - 1, y });
        }
        if (borderCells.length > 0) {
            const exitCell = borderCells[Math.floor(Math.random() * borderCells.length)];
            this.grid[exitCell.y][exitCell.x] = 2;
            return exitCell;
        }
        return null;
    }

    getEmptyCells() {
        const emptyCells = [];
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                if (this.grid[y][x] === 0) {
                    emptyCells.push({ x, y });
                }
            }
        }
        return emptyCells;
    }
}

class PlayerController extends Component {
    constructor(gameObject, mazeGrid, mazeSize, exitPosition) {
        super(gameObject);
        this.mazeGrid = mazeGrid;
        this.mazeWidth = mazeSize.width;
        this.mazeHeight = mazeSize.height;
        this.exitPosition = exitPosition;
        this.speed = 3.5;
        this.playerRadius = 0.3; 
        this.sensitivity = 0.002;
        this.camera = null;
        this.coins = [];
        this.coinsCollected = 0;
        this.totalCoins = 0;
        this.isGameWon = false;
        this.startTime = 0;
        this.coinCounterUI = document.getElementById('coin-counter');
        this.resultsScreenUI = document.getElementById('results-screen');
        this.finalCoinsUI = document.getElementById('final-coins');
        this.finalTimeUI = document.getElementById('final-time');
    }

    start() {
        this.camera = this.engine.renderer.camera;
        this.camera.rotation.order = 'YXZ';
        this.transform.position.y = 0.7;
        this.startTime = performance.now();
    }

    setCoins(coins) {
        this.coins = coins;
        this.totalCoins = coins.length;
        this.updateUI();
    }

    updateUI() {
        this.coinCounterUI.textContent = `Монеты: ${this.coinsCollected} / ${this.totalCoins}`;
        if (this.coinsCollected === this.totalCoins && this.totalCoins > 0) {
            this.coinCounterUI.textContent += " - Найдите выход!";
            this.coinCounterUI.style.color = "#4CAF50";
        }
    }
    
    winGame() {
        if (this.isGameWon) return;
        this.isGameWon = true;

        const duration = (performance.now() - this.startTime) / 1000;
        document.exitPointerLock();

        this.finalCoinsUI.textContent = `Монет собрано: ${this.coinsCollected} / ${this.totalCoins}`;
        this.finalTimeUI.textContent = `Время: ${duration.toFixed(2)} секунд`;
        this.resultsScreenUI.style.display = 'flex';
    }

    isColliding(x, z) {
        const currentCellX = Math.floor(x + this.mazeWidth / 2);
        const currentCellY = Math.floor(z + this.mazeHeight / 2);
        for (let i = -1; i <= 1; i++) {
            for (let j = -1; j <= 1; j++) {
                const checkX = currentCellX + i;
                const checkY = currentCellY + j;
                if (this.mazeGrid[checkY] && this.mazeGrid[checkY][checkX] === 1) {
                    const wallX = checkX - this.mazeWidth / 2;
                    const wallZ = checkY - this.mazeHeight / 2;
                    const closestX = Math.max(wallX - 0.5, Math.min(x, wallX + 0.5));
                    const closestZ = Math.max(wallZ - 0.5, Math.min(z, wallZ + 0.5));
                    const distanceX = x - closestX;
                    const distanceZ = z - closestZ;
                    const distanceSquared = (distanceX * distanceX) + (distanceZ * distanceZ);
                    if (distanceSquared < (this.playerRadius * this.playerRadius)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }
    
    update(deltaTime) {
        if (!this.camera || this.isGameWon) return;

        const input = this.engine.inputManager;
        const moveSpeed = this.speed * deltaTime;
        const mouseDelta = input.getMouseDelta();
        this.transform.rotation.y -= mouseDelta.x * this.sensitivity;
        this.camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.camera.rotation.x - mouseDelta.y * this.sensitivity));
        const moveVector = new THREE.Vector3();
        if (input.isKeyDown('KeyW')) moveVector.z -= 1;
        if (input.isKeyDown('KeyS')) moveVector.z += 1;
        if (input.isKeyDown('KeyA')) moveVector.x -= 1;
        if (input.isKeyDown('KeyD')) moveVector.x += 1;
        if (moveVector.lengthSq() > 0) {
            moveVector.normalize().multiplyScalar(moveSpeed);
            moveVector.applyQuaternion(this.transform.quaternion);
            const nextX = this.transform.position.x + moveVector.x;
            const nextZ = this.transform.position.z + moveVector.z;
            if (!this.isColliding(nextX, this.transform.position.z)) { this.transform.position.x = nextX; }
            if (!this.isColliding(this.transform.position.x, nextZ)) { this.transform.position.z = nextZ; }
        }
        
        const playerPos = this.transform.position;
        for (let i = this.coins.length - 1; i >= 0; i--) {
            const coin = this.coins[i];
            if (playerPos.distanceTo(coin.transform.position) < 0.8) {
                this.engine.renderer.scene.remove(coin.transform);
                this.coins.splice(i, 1);
                this.coinsCollected++;
                this.updateUI();
            }
        }
        
        const allCoinsCollected = this.coinsCollected === this.totalCoins && this.totalCoins > 0;
        if (allCoinsCollected) {
            if (playerPos.distanceTo(this.exitPosition) < 1.0) {
                this.winGame();
            }
        }
    }
}

class CoinBehavior extends Component {
    constructor(gameObject) { super(gameObject); this.time = Math.random() * Math.PI * 2; this.bobHeight = 0.1; this.bobSpeed = 2; this.rotationSpeed = 1.5; this.baseY = 0.5; }
    start() { const geometry = new THREE.CylinderGeometry(0.3, 0.3, 0.08, 16); const material = new THREE.MeshStandardMaterial({ color: 0xFFD700, metalness: 0.5, roughness: 0.2 }); const mesh = new THREE.Mesh(geometry, material); mesh.rotation.x = Math.PI / 2; this.transform.add(mesh); this.transform.position.y = this.baseY; }
    update(deltaTime) { this.time += deltaTime; this.transform.rotation.y += this.rotationSpeed * deltaTime; this.transform.position.y = this.baseY + Math.sin(this.time * this.bobSpeed) * this.bobHeight; }
}

function runMazeGame(mazeSizeValue = 21) {
    const engine = new Engine('lumina-canvas');
    const scene = engine.renderer.scene;
    scene.background = new THREE.Color(0x000000);
    const textureLoader = new THREE.TextureLoader();
    const wallTexture = textureLoader.load('./textures/tileable_wall.png');
    wallTexture.wrapS = THREE.RepeatWrapping; wallTexture.wrapT = THREE.RepeatWrapping; wallTexture.repeat.set(1, 1);
    const floorTexture = textureLoader.load('./textures/tileable_grass.png');
    floorTexture.wrapS = THREE.RepeatWrapping; floorTexture.wrapT = THREE.RepeatWrapping;
    const mazeSize = { width: mazeSizeValue, height: mazeSizeValue };
    const mazeGenerator = new MazeGenerator(mazeSize.width, mazeSize.height);
    const mazeData = mazeGenerator.generate();
    const mazeGrid = mazeData.grid;
    const exitCell = mazeData.exit;
    floorTexture.repeat.set(mazeSize.width, mazeSize.height);
    const mazeObject = new THREE.Group();
    const wallGeometry = new THREE.BoxGeometry(1, 2, 1);
    const wallMaterial = new THREE.MeshStandardMaterial({ map: wallTexture });
    for (let y = 0; y < mazeSize.height; y++) { for (let x = 0; x < mazeSize.width; x++) { if (mazeGrid[y][x] === 1) { const wall = new THREE.Mesh(wallGeometry, wallMaterial); wall.position.set(x - mazeSize.width / 2, 1, y - mazeSize.height / 2); mazeObject.add(wall); } } }
    const floorGeometry = new THREE.PlaneGeometry(mazeSize.width, mazeSize.height);
    const floorMaterial = new THREE.MeshStandardMaterial({ map: floorTexture });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    mazeObject.add(floor);
    scene.add(mazeObject);
    const exitPosition = new THREE.Vector3(exitCell.x - mazeSize.width / 2, 0.01, exitCell.y - mazeSize.height / 2);
    const exitGeometry = new THREE.PlaneGeometry(1, 1);
    const exitMaterial = new THREE.MeshStandardMaterial({ color: 0x00ff00, emissive: 0x00ff00, emissiveIntensity: 0.5 });
    const exitTile = new THREE.Mesh(exitGeometry, exitMaterial);
    exitTile.position.copy(exitPosition);
    exitTile.rotation.x = -Math.PI / 2;
    scene.add(exitTile);
    const player = new GameObject('Player');
    player.transform.add(engine.renderer.camera);
    const playerController = player.addComponent(PlayerController, mazeGrid, mazeSize, exitPosition);
    engine.addGameObject(player);
    engine.setPlayer(player);
    const emptyCells = mazeGenerator.getEmptyCells();
    const spawnPoints = [...emptyCells].sort(() => 0.5 - Math.random());
    const playerSpawn = spawnPoints.pop();
    player.transform.position.set(playerSpawn.x - mazeSize.width / 2, 0, playerSpawn.y - mazeSize.height / 2);
    const coinCount = Math.floor(Math.random() * 6) + 5;
    const coins = [];
    for (let i = 0; i < coinCount && spawnPoints.length > 0; i++) {
        const coinSpawn = spawnPoints.pop();
        const coin = new GameObject(`Coin_${i}`);
        coin.addComponent(CoinBehavior);
        coin.transform.position.set(coinSpawn.x - mazeSize.width / 2, 0, coinSpawn.y - mazeSize.height / 2);
        engine.addGameObject(coin);
        coins.push(coin);
    }
    playerController.setCoins(coins);
    const moonTexture = textureLoader.load('./textures/moon.png');
    const moonMaterial = new THREE.SpriteMaterial({ map: moonTexture });
    const moonSprite = new THREE.Sprite(moonMaterial);
    moonSprite.scale.set(40, 40, 1);
    moonSprite.position.set(100, 50, -200);
    scene.add(moonSprite);
    const starGeometry = new THREE.BufferGeometry();
    const starVertices = [];
    for (let i = 0; i < 1000; i++) { const x = THREE.MathUtils.randFloatSpread(2000); const y = THREE.MathUtils.randFloat(10, 500); const z = THREE.MathUtils.randFloatSpread(2000); starVertices.push(x, y, z); }
    starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starVertices, 3));
    const starMaterial = new THREE.PointsMaterial({ color: 0xffffff, size: 0.5 });
    const stars = new THREE.Points(starGeometry, starMaterial);
    scene.add(stars);
    const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
    scene.add(ambientLight);
    const moonLight = new THREE.DirectionalLight(0xaabbff, 0.3);
    moonLight.position.copy(moonSprite.position);
    scene.add(moonLight);
    engine.start();
}

// === Управляющий блок ===

const urlParams = new URLSearchParams(window.location.search);
const currentSize = parseInt(urlParams.get('size')) || 21;

runMazeGame(currentSize);

const restartButton = document.getElementById('restart-button');
const newMazeButton = document.getElementById('new-maze-button');

restartButton.addEventListener('click', () => {
    window.location.search = `?size=${currentSize}`;
});

newMazeButton.addEventListener('click', () => {
    let newSize = currentSize + 10;
    if (newSize % 2 === 0) newSize++; 
    window.location.search = `?size=${newSize}`;
});