import { app, BrowserWindow, shell } from 'electron';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { fileURLToPath } from 'node:url';

const currentDir = fileURLToPath(new URL('.', import.meta.url))

// needed in case process is undefined under Linux
const platform = process.platform || os.platform();

// Simple JSON config store, replaces electron-store dependency
// Reads/writes the same config.json in userData for backwards compatibility
const configPath = path.join(app.getPath('userData'), 'config.json');

function configGet(key: string): unknown {
  try {
    const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return data[key];
  } catch {
    return undefined;
  }
}

function configSet(key: string, value: unknown): void {
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    // file doesn't exist or is invalid, start fresh
  }
  data[key] = value;
  fs.writeFileSync(configPath, JSON.stringify(data, null, '\t'));
}

let mainWindow: BrowserWindow | undefined;

function createWindow() {
  const windowState = configGet('windowState') as {
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
      backgroundThrottling: false, // keep Electrum WebSocket connections alive when window is minimized
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

    configSet('windowState', {
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

  // Open links in browser window — only allow safe schemes to prevent protocol abuse
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      const isHttps = parsed.protocol === 'https:';
      const isDevLocalhost = parsed.protocol === 'http:' && process.env.DEV && parsed.hostname === 'localhost';
      if (isHttps || isDevLocalhost) {
        void shell.openExternal(parsed.href);
      } else {
        console.warn('Blocked openExternal for disallowed URL scheme:', url);
      }
    } catch {
      console.warn('Blocked openExternal for invalid URL:', url);
    }
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
