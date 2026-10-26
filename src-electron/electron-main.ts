import { app, BrowserWindow, session, shell } from 'electron';
import path from 'path';
import os from 'os';
import fs from 'fs';
import {
  registerQuasarRuntime,
  resolveElectronAssetsPath,
} from '#q-app/electron/main';

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

// Links leave the app for the browser, and only safe schemes go there, to prevent protocol abuse
function openExternalIfSafe(url: string) {
  try {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const isDevLocalhost = parsed.protocol === 'http:' && import.meta.env.QUASAR_DEV && parsed.hostname === 'localhost';
    if (isHttps || isDevLocalhost) {
      void shell.openExternal(parsed.href);
    } else {
      console.warn('Blocked openExternal for disallowed URL scheme:', url);
    }
  } catch {
    console.warn('Blocked openExternal for invalid URL:', url);
  }
}

// The window only ever shows the app's own page: another page loaded in it would look like the wallet
function isAppPage(url: string, currentUrl: string) {
  try {
    const target = new URL(url);
    const current = new URL(currentUrl);
    return target.origin === current.origin && target.pathname === current.pathname;
  } catch {
    return false;
  }
}

function createWindow() {
  const windowState = configGet('windowState') as {
    isMaximized: boolean;
    bounds: Electron.Rectangle;
  } | undefined;

  mainWindow = new BrowserWindow({
    ...(windowState?.bounds ?? { width: 1000, height: 800 }),
    icon: resolveElectronAssetsPath('icons/icon.png'), // tray icon
    show: false,
    useContentSize: true,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true, // Electron's default, written out so it stays on
      backgroundThrottling: false, // keep Electrum WebSocket connections alive when window is minimized
      // More info: https://quasar.dev/quasar-cli-vite/developing-electron-apps/electron-preload-script
      preload: path.join(import.meta.dirname, 'electron-preload.cjs')
    },
  });

  if (import.meta.env.QUASAR_DEV) {
    mainWindow.loadURL(import.meta.env.QUASAR_APP_URL)
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

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalIfSafe(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event) => {
    if (isAppPage(event.url, mainWindow?.webContents.getURL() ?? '')) return;
    event.preventDefault();
    openExternalIfSafe(event.url);
  });

  if (import.meta.env.QUASAR_DEBUG) {
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
  registerQuasarRuntime();
  // Grant only what the app uses: the camera for scanning QR codes, and clipboard writes should Chromium ask
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    const mediaTypes = 'mediaTypes' in details ? details.mediaTypes ?? [] : [];
    const isCamera = permission === 'media' && mediaTypes.length > 0 && mediaTypes.every(mediaType => mediaType === 'video');
    callback(isCamera || permission === 'clipboard-sanitized-write');
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
