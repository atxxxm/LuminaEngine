// game/UIManager.js
import { BLOCK } from './blocks.js';

export class UIManager {
    constructor() {
        this.hotbarElement = document.getElementById('hotbar');
        this.inventoryElement = document.getElementById('inventory');
        this.mainInventoryGrid = document.getElementById('main-inventory-grid');
        this.hotbarInventoryGrid = document.getElementById('hotbar-inventory-grid');
        this.inventoryVisible = false;
        this.onSlotClickCallback = null;
    }

    // Inventory регистрирует сюда обработчик кликов по слотам (хотбар и
    // основной инвентарь), чтобы UIManager не знал о логике перемещения
    // предметов и оставался чистым слоем отображения.
    onSlotClick(callback) {
        this.onSlotClickCallback = callback;
    }

    toggleInventory() {
        this.inventoryVisible = !this.inventoryVisible;
        this.inventoryElement.style.display = this.inventoryVisible ? 'block' : 'none';
        if (this.inventoryVisible) {
            document.exitPointerLock();
        }
    }

    createSlotElement(item, location, index, isSelected, isHeld) {
        const slot = document.createElement('div');
        slot.className = 'hotbar-slot';
        if (isSelected) slot.classList.add('selected');
        if (isHeld) slot.classList.add('held');

        if (item) {
            const blockProps = BLOCK.get(item.id);
            const texture = typeof blockProps.texture === 'object' ? blockProps.texture.side : blockProps.texture;
            slot.style.backgroundImage = `url(textures/${texture})`;
            slot.title = blockProps.name || '';

            const count = document.createElement('div');
            count.className = 'item-count';
            count.textContent = item.count > 1 ? item.count : '';
            slot.appendChild(count);
        }

        slot.addEventListener('click', () => {
            if (this.onSlotClickCallback) this.onSlotClickCallback(location, index);
        });

        return slot;
    }

    updateHotbar(hotbarData, selectedSlot, heldForMove) {
        this.hotbarElement.innerHTML = '';
        for (let i = 0; i < hotbarData.length; i++) {
            const isHeld = !!heldForMove && heldForMove.location === 'hotbar' && heldForMove.index === i;
            const slot = this.createSlotElement(hotbarData[i], 'hotbar', i, i === selectedSlot, isHeld);
            this.hotbarElement.appendChild(slot);
        }
    }

    updateInventory(inventoryData, hotbarData, heldForMove) {
        this.mainInventoryGrid.innerHTML = '';
        for (let i = 0; i < inventoryData.length; i++) {
            const isHeld = !!heldForMove && heldForMove.location === 'inventory' && heldForMove.index === i;
            const slot = this.createSlotElement(inventoryData[i], 'inventory', i, false, isHeld);
            this.mainInventoryGrid.appendChild(slot);
        }

        this.hotbarInventoryGrid.innerHTML = '';
        for (let i = 0; i < hotbarData.length; i++) {
            const isHeld = !!heldForMove && heldForMove.location === 'hotbar' && heldForMove.index === i;
            const slot = this.createSlotElement(hotbarData[i], 'hotbar', i, false, isHeld);
            this.hotbarInventoryGrid.appendChild(slot);
        }
    }
}
