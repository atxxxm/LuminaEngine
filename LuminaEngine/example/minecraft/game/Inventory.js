// game/Inventory.js
import { Component } from '../Lumina/js/core/Component.js';
import { BLOCK } from './blocks.js';

export class Inventory extends Component {
    constructor(gameObject, uiManager) {
        super(gameObject);
        this.uiManager = uiManager;
        this.hotbar = new Array(9).fill(null);
        this.inventory = new Array(27).fill(null); // 3 rows of 9
        this.selectedSlot = 0;

        // Слот, "взятый в руку" кликом, ожидающий второго клика для
        // перемещения/обмена. null, если сейчас ничего не выбрано.
        this.heldForMove = null;

        this.uiManager.onSlotClick((location, index) => this.handleSlotClick(location, index));
    }

    start() {
        // Give player some starting blocks
        this.addItem(BLOCK.STONE, 64);
        this.addItem(BLOCK.DIRT, 64);
        this.addItem(BLOCK.OAK_LOG, 64);
        this.addItem(BLOCK.OAK_LEAVES, 64);
        this.addItem(BLOCK.TORCH, 16);
        this.updateUI();
    }

    update(deltaTime) {
        const input = this.engine.inputManager;

        // Hotbar selection with scroll wheel
        const scroll = input.getScrollDelta();
        if (scroll !== 0) {
            this.selectedSlot = (this.selectedSlot - scroll + this.hotbar.length) % this.hotbar.length;
            this.updateUI();
        }

        // Hotbar selection with number keys
        for(let i = 1; i <= 9; i++) {
            if(input.wasKeyJustPressed(`Digit${i}`)) {
                this.selectedSlot = i - 1;
                this.updateUI();
            }
        }
    }

    getSlots(location) {
        return location === 'hotbar' ? this.hotbar : this.inventory;
    }

    addItem(blockId, count = 1) {
        // Порядок: сначала стакуем в хотбар, потом в основной инвентарь,
        // потом ищем пустой слот в хотбаре, потом в инвентаре.
        for (const location of ['hotbar', 'inventory']) {
            const slots = this.getSlots(location);
            for (let i = 0; i < slots.length; i++) {
                if (slots[i] && slots[i].id === blockId && slots[i].count < 64) {
                    slots[i].count += count;
                    this.updateUI();
                    return true;
                }
            }
        }
        for (const location of ['hotbar', 'inventory']) {
            const slots = this.getSlots(location);
            for (let i = 0; i < slots.length; i++) {
                if (slots[i] === null) {
                    slots[i] = { id: blockId, count: count };
                    this.updateUI();
                    return true;
                }
            }
        }
        return false;
    }

    // Клик по слоту (хотбар или основной инвентарь): первый клик "берёт"
    // предмет, второй клик по другому слоту меняет их местами или
    // объединяет стаки того же блока; клик по тому же слоту отменяет выбор.
    handleSlotClick(location, index) {
        if (!this.heldForMove) {
            const slots = this.getSlots(location);
            if (slots[index]) {
                this.heldForMove = { location, index };
            }
        } else if (this.heldForMove.location === location && this.heldForMove.index === index) {
            this.heldForMove = null;
        } else {
            this.moveOrMergeSlot(this.heldForMove.location, this.heldForMove.index, location, index);
            this.heldForMove = null;
        }
        this.updateUI();
    }

    moveOrMergeSlot(fromLocation, fromIndex, toLocation, toIndex) {
        const fromSlots = this.getSlots(fromLocation);
        const toSlots = this.getSlots(toLocation);
        const fromItem = fromSlots[fromIndex];
        if (!fromItem) return;

        const toItem = toSlots[toIndex];
        if (toItem && toItem.id === fromItem.id) {
            const spaceLeft = 64 - toItem.count;
            const moved = Math.min(spaceLeft, fromItem.count);
            toItem.count += moved;
            fromItem.count -= moved;
            fromSlots[fromIndex] = fromItem.count > 0 ? fromItem : null;
        } else {
            fromSlots[fromIndex] = toItem;
            toSlots[toIndex] = fromItem;
        }
    }

    getSelectedItem() {
        return this.hotbar[this.selectedSlot];
    }

    removeItemFromSelectedSlot(count = 1) {
        const item = this.getSelectedItem();
        if (item) {
            item.count -= count;
            if (item.count <= 0) {
                this.hotbar[this.selectedSlot] = null;
            }
            this.updateUI();
            return true;
        }
        return false;
    }

    updateUI() {
        this.uiManager.updateHotbar(this.hotbar, this.selectedSlot, this.heldForMove);
        this.uiManager.updateInventory(this.inventory, this.hotbar, this.heldForMove);
    }

    getData() {
        return {
            hotbar: this.hotbar,
            inventory: this.inventory
        };
    }

    loadData(data) {
        this.hotbar = data.hotbar || new Array(9).fill(null);
        this.inventory = data.inventory || new Array(27).fill(null);
        this.updateUI();
    }
}
