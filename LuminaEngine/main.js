// Lumina/main.js

const { app, BrowserWindow, globalShortcut } = require('electron');
const path = require('path');

function createWindow() {
    // Создаем окно приложения.
    const win = new BrowserWindow({
        width: 1280,
        height: 720,
        title: "LuminaEngine",
        webPreferences: {
            // preload: path.join(__dirname, 'preload.js') // нам пока не нужно
        }
    });

    // и загружаем index.html нашего приложения.
    win.loadFile('example/3dGame/game.html');

    // Убираем стандартное меню (Файл, Правка и т.д.) для более игрового вида
    win.setMenuBarVisibility(false);

    // Открыть DevTools для отладки (можно закомментировать для финальной версии)
    // win.webContents.openDevTools();
}

// Этот метод будет вызван, когда Electron закончит
// инициализацию и будет готов к созданию окон.
app.whenReady().then(() => {
    // РЕШАЕМ ПРОБЛЕМУ С CTRL+W
    // Регистрируем глобальный перехватчик для сочетания клавиш.
    // Он сработает, даже если окно не в фокусе.
    globalShortcut.register('CommandOrControl+W', () => {
        // Вместо того чтобы закрывать окно, мы можем просто ничего не делать.
        // Или вывести сообщение в консоль для отладки.
        console.log('Перехвачено нажатие Ctrl+W, закрытие окна предотвращено.');
        // Важно: не вызывайте win.close() здесь, если не хотите, чтобы оно закрывалось.
    });

    createWindow();

    app.on('activate', () => {
        // На macOS принято повторно создавать окно в приложении, когда
        // на иконку в доке кликают, если других окон нет.
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

// Выход из приложения, когда все окна закрыты (кроме macOS).
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// Важно: нужно отменять регистрацию шорткатов при выходе из приложения
app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});