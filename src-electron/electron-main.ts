import { app, BrowserWindow, shell } from 'electron';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'node:url';
import Store from 'electron-store';

const currentDir = fileURLToPath(new URL('.', import.meta.url))

// needed in case process is undefined under Linux
const platform = process.platform || os.platform();

const store = new Store();

let mainWindow: BrowserWindow | undefined;

function createWindow() {
  const windowState = store.get('windowState') as {
    isMaximized: boolean;
    bounds: Electron.Rectangle;
  } | undefined;

  mainWindow = new BrowserWindow({
    ...(windowState?.bounds ?? { width: 1000, height: 800 }),
    icon: path.resolve(currentDir, 'icons/icon.png'), // tray icon
    show: false,
    useContentSize: true,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      // More info: https://v2.quasar.dev/quasar-cli-vite/developing-electron-apps/electron-preload-script
      preload: path.resolve(
        currentDir,
        path.join(process.env.QUASAR_ELECTRON_PRELOAD_FOLDER!, 'electron-preload' + process.env.QUASAR_ELECTRON_PRELOAD_EXTENSION!)
      )
    },
  });

  if (process.env.DEV) {
    mainWindow.loadURL(process.env.APP_URL)
  } else {
    mainWindow.loadFile('index.html')
  }

  const saveWindowState = () => {
    if (!mainWindow) return;

    store.set('windowState', {
      isMaximized: mainWindow.isMaximized(),
      bounds: mainWindow.getBounds(),
    });
  };

  mainWindow.on('close', saveWindowState);

  // Maximize on first launch or when isMaximized is true
  if (!windowState?.bounds || windowState.isMaximized) {
    mainWindow.maximize();
  }

  mainWindow.show();

  // Open links in browser window
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env.DEBUGGING) {
    // if on DEV or Production with debug enabled
    mainWindow.webContents.openDevTools();
  } else {
    // we're on production; no access to devtools pls
    mainWindow.webContents.on('devtools-opened', () => {
      mainWindow?.webContents.closeDevTools();
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = undefined;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === undefined) {
    createWindow();
  }
});
