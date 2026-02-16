import { app, BrowserWindow, ipcMain, powerMonitor, safeStorage, session, shell } from 'electron';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'node:url';
import Store from 'electron-store';

const currentDir = fileURLToPath(new URL('.', import.meta.url))

// needed in case process is undefined under Linux
const platform = process.platform || os.platform();

const store = new Store();

let mainWindow: BrowserWindow | undefined;

const SECURE_STORAGE_CHANNELS = {
  available: 'secure-storage:is-available',
  encrypt: 'secure-storage:encrypt',
  decrypt: 'secure-storage:decrypt',
} as const;

function validateSecureStorageInput(value: unknown, maxLength: number, fieldName: string): string {
  if (typeof value !== 'string') throw new Error(`${fieldName} must be a string`);
  if (value.length === 0) throw new Error(`${fieldName} must be non-empty`);
  if (value.length > maxLength) throw new Error(`${fieldName} exceeds max length`);
  return value;
}

function setupSecureStorageIpc() {
  ipcMain.handle(SECURE_STORAGE_CHANNELS.available, () => safeStorage.isEncryptionAvailable());

  ipcMain.handle(SECURE_STORAGE_CHANNELS.encrypt, (_event, plaintext: unknown) => {
    const normalized = validateSecureStorageInput(plaintext, 4096, 'plaintext');
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Secure storage is unavailable on this system');
    }
    const encrypted = safeStorage.encryptString(normalized);
    return encrypted.toString('base64');
  });

  ipcMain.handle(SECURE_STORAGE_CHANNELS.decrypt, (_event, encryptedBase64: unknown) => {
    const normalized = validateSecureStorageInput(encryptedBase64, 16384, 'encryptedBase64');
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Secure storage is unavailable on this system');
    }
    const encrypted = Buffer.from(normalized, 'base64');
    if (encrypted.byteLength === 0) {
      throw new Error('encryptedBase64 decodes to empty bytes');
    }
    return safeStorage.decryptString(encrypted);
  });
}

function isAllowedNavigation(url: string): boolean {
  if (process.env.DEV) {
    const appUrl = process.env.APP_URL;
    return typeof appUrl === 'string' && appUrl.length > 0 && url.startsWith(appUrl);
  }
  return url.startsWith('file://');
}

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
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
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

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  mainWindow.on('minimize', () => {
    mainWindow?.webContents.send('security:lock-requested', 'window-minimized');
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

app.whenReady().then(() => {
  const contentSecurityPolicy = process.env.DEV
    ? "default-src 'self' data: blob: https: http: ws: wss: 'unsafe-inline' 'unsafe-eval'; object-src 'none'; base-uri 'self';"
    : "default-src 'self'; connect-src 'self' https: wss:; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none';";

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = details.responseHeaders ?? {};
    responseHeaders['Content-Security-Policy'] = [contentSecurityPolicy];
    callback({ responseHeaders });
  });

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  setupSecureStorageIpc();

  powerMonitor.on('lock-screen', () => {
    mainWindow?.webContents.send('security:lock-requested', 'system-lock-screen');
  });

  createWindow();
});

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
