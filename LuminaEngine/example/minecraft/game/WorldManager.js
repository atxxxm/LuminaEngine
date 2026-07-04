// game/WorldManager.js
//
// Раньше (SaveManager) был ровно один слот сохранения на всё приложение
// (фиксированный ключ в IndexedDB) — теперь список именованных миров, как
// в меню выбора мира в Minecraft. Метаданные (имя/сид/даты) и тяжёлые
// данные (воксели чанков) специально лежат в РАЗНЫХ object store: список
// миров должен открываться мгновенно, не разбирая мегабайты чанков.
import { Inventory } from './Inventory.js';

const DB_NAME = 'luminaCraftDB';
const DB_VERSION = 2;
const META_STORE = 'worldsMeta';
const DATA_STORE = 'worldsData';

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
            const db = request.result;
            // Старый формат (один слот 'worlds' на весь IndexedDB) —
            // без миграции, менять было бы не на что: там всего один мир.
            if (db.objectStoreNames.contains('worlds')) {
                db.deleteObjectStore('worlds');
            }
            if (!db.objectStoreNames.contains(META_STORE)) {
                db.createObjectStore(META_STORE, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(DATA_STORE)) {
                db.createObjectStore(DATA_STORE, { keyPath: 'id' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function requestToPromise(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// Ждёт полного коммита транзакции — просто дождаться отдельного request
// внутри неё недостаточно: следующий вызов (например, listWorlds() сразу
// после renameWorld()) может открыть новую транзакцию раньше, чем эта
// закоммитится.
function awaitTx(tx) {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

function generateWorldId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

// Пустая строка → случайный сид; число в виде текста → само число;
// произвольный текст (как в Minecraft можно вбить слово) → детерминированный
// хэш этого текста в число, чтобы им можно было пользоваться повторно.
export function seedToNumber(input) {
    const trimmed = (input || '').trim();
    if (trimmed === '') {
        return Math.floor(Math.random() * 1_000_000);
    }
    const asNumber = Number(trimmed);
    if (Number.isFinite(asNumber)) {
        return asNumber;
    }
    let hash = 0;
    for (let i = 0; i < trimmed.length; i++) {
        hash = (hash * 31 + trimmed.charCodeAt(i)) >>> 0;
    }
    return hash;
}

export class WorldManager {
    async listWorlds() {
        const db = await openDB();
        const tx = db.transaction(META_STORE, 'readonly');
        const all = await requestToPromise(tx.objectStore(META_STORE).getAll());
        return all.sort((a, b) => b.lastPlayedAt - a.lastPlayedAt);
    }

    async createWorld(name, seedInput) {
        const db = await openDB();
        const meta = {
            id: generateWorldId(),
            name,
            seed: seedToNumber(seedInput),
            createdAt: Date.now(),
            lastPlayedAt: Date.now(),
        };
        const tx = db.transaction(META_STORE, 'readwrite');
        tx.objectStore(META_STORE).put(meta);
        await awaitTx(tx);
        return meta;
    }

    async renameWorld(id, newName) {
        const db = await openDB();
        const tx = db.transaction(META_STORE, 'readwrite');
        const meta = await requestToPromise(tx.objectStore(META_STORE).get(id));
        if (!meta) return;
        meta.name = newName;
        tx.objectStore(META_STORE).put(meta);
        await awaitTx(tx);
    }

    async touchWorld(id) {
        const db = await openDB();
        const tx = db.transaction(META_STORE, 'readwrite');
        const meta = await requestToPromise(tx.objectStore(META_STORE).get(id));
        if (!meta) return;
        meta.lastPlayedAt = Date.now();
        tx.objectStore(META_STORE).put(meta);
        await awaitTx(tx);
    }

    async deleteWorld(id) {
        const db = await openDB();
        const tx = db.transaction([META_STORE, DATA_STORE], 'readwrite');
        tx.objectStore(META_STORE).delete(id);
        tx.objectStore(DATA_STORE).delete(id);
        await awaitTx(tx);
    }

    async saveWorld(id, world, player) {
        const playerData = {
            position: player.transform.position.toArray(),
            rotation: player.transform.rotation.toArray(),
            inventory: player.getComponent(Inventory).getData()
        };
        const saveData = { world: world.getData(), player: playerData };

        try {
            const db = await openDB();
            const tx = db.transaction([DATA_STORE, META_STORE], 'readwrite');
            tx.objectStore(DATA_STORE).put({ id, ...saveData });
            const meta = await requestToPromise(tx.objectStore(META_STORE).get(id));
            if (meta) {
                meta.lastPlayedAt = Date.now();
                tx.objectStore(META_STORE).put(meta);
            }
            await awaitTx(tx);
            console.log("Мир сохранен!");
        } catch (e) {
            console.error("Не удалось сохранить мир:", e);
        }
    }

    async loadWorld(id) {
        try {
            const db = await openDB();
            const tx = db.transaction(DATA_STORE, 'readonly');
            const data = await requestToPromise(tx.objectStore(DATA_STORE).get(id));
            return data || null;
        } catch (e) {
            console.error("Не удалось загрузить мир:", e);
            return null;
        }
    }
}
