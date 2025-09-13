// Lumina/js/core/Renderer.js

export class Renderer {
    constructor(canvasId) {
        // ... (конструктор остается без изменений) ...
        this.canvas = document.getElementById(canvasId);
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        
        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);

        this.coordsDisplay = document.getElementById('coords-display');
        this.fpsDisplay = document.getElementById('fps-display');
        
        window.addEventListener('resize', this.onWindowResize.bind(this), false);
    }

    get domElement() {
        return this.renderer.domElement;
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    render() {
        this.renderer.render(this.scene, this.camera);
    }
    
    // <<-- ПОЛНОСТЬЮ ЗАМЕНИТЬ МЕТОД updateUI
    updateUI(fps, playerTransform) {
        this.fpsDisplay.textContent = `FPS: ${fps}`;
        
        if (!playerTransform) return; // Не обновляем, если игрока нет
        
        const pos = playerTransform.position;
        
        // Pitch (вертикальный наклон) берем с камеры, так как она вращается по X
        const pitch = (this.camera.rotation.x * 180 / Math.PI).toFixed(1);
        // Yaw (горизонтальный поворот) берем с родительского объекта игрока
        const yaw = (playerTransform.rotation.y * 180 / Math.PI).toFixed(1);

        this.coordsDisplay.innerHTML = `
            X: ${pos.x.toFixed(2)}<br>
            Y: ${pos.y.toFixed(2)}<br>
            Z: ${pos.z.toFixed(2)}<br>
            Pitch: ${pitch}° Yaw: ${yaw}°
        `;
    }
}