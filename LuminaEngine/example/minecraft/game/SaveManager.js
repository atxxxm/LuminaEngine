// game/SaveManager.js
import { Inventory } from './Inventory.js';

const DB_NAME = 'luminaCraftDB';
const DB_VERSION = 1;
const STORE_NAME = 'worlds';

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            request.result.createObjectStore(STORE_NAME);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export class SaveManager {
    constructor() {
        this.saveKey = 'luminaCraftWorld';
    }

    async hasSavedWorld() {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const request = tx.objectStore(STORE_NAME).count(this.saveKey);
            request.onsuccess = () => resolve(request.result > 0);
            request.onerror = () => reject(request.error);
        });
    }

    async saveWorld(world, player) {
        const playerData = {
            position: player.transform.position.toArray(),
            rotation: player.transform.rotation.toArray(),
            inventory: player.getComponent(Inventory).getData()
        };
        const worldData = world.getData();

        const saveData = {
            world: worldData,
            player: playerData
        };

        try {
            const db = await openDB();
            await new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, 'readwrite');
                tx.objectStore(STORE_NAME).put(saveData, this.saveKey);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
            console.log("Мир сохранен!");
        } catch (e) {
            console.error("Не удалось сохранить мир:", e);
        }
    }

    async loadWorld() {
        try {
            const db = await openDB();
            return await new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, 'readonly');
                const request = tx.objectStore(STORE_NAME).get(this.saveKey);
                request.onsuccess = () => resolve(request.result || null);
                request.onerror = () => reject(request.error);
            });
        } catch (e) {
            console.error("Не удалось загрузить мир:", e);
            return null;
        }
    }
}
