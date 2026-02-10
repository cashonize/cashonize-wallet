/**
 * This file is used specifically for security reasons.
 * Here you can access Nodejs stuff and inject functionality into
 * the renderer thread (accessible there through the "window" object)
 *
 * WARNING!
 * If you import anything from node_modules, then make sure that the package is specified
 * in package.json > dependencies and NOT in devDependencies
 *
 * Example (injects window.myAPI.doAThing() into renderer thread):
 *
 *   import { contextBridge } from 'electron'
 *
 *   contextBridge.exposeInMainWorld('myAPI', {
 *     doAThing: () => {}
 *   })
 *
 * WARNING!
 * If accessing Node functionality (like importing @electron/remote) then in your
 * electron-main.ts you will need to set the following when you instantiate BrowserWindow:
 *
 * mainWindow = new BrowserWindow({
 *   // ...
 *   webPreferences: {
 *     // ...
 *     sandbox: false // <-- to be able to import @electron/remote in preload script
 *   }
 * }
 */
import { contextBridge, ipcRenderer } from 'electron';

const SECURE_STORAGE_CHANNELS = {
  available: 'secure-storage:is-available',
  encrypt: 'secure-storage:encrypt',
  decrypt: 'secure-storage:decrypt',
} as const;

const SECURITY_EVENT_CHANNELS = {
  lockRequested: 'security:lock-requested',
} as const;

contextBridge.exposeInMainWorld('cashonizeSecureStorage', {
  isAvailable: () => ipcRenderer.invoke(SECURE_STORAGE_CHANNELS.available) as Promise<boolean>,
  encrypt: (plaintext: string) => ipcRenderer.invoke(SECURE_STORAGE_CHANNELS.encrypt, plaintext) as Promise<string>,
  decrypt: (encryptedBase64: string) => ipcRenderer.invoke(SECURE_STORAGE_CHANNELS.decrypt, encryptedBase64) as Promise<string>,
});

contextBridge.exposeInMainWorld('cashonizeElectronSecurity', {
  onLockRequested: (callback: (reason: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, reason: unknown) => {
      if (typeof reason === 'string') callback(reason);
    };
    ipcRenderer.on(SECURITY_EVENT_CHANNELS.lockRequested, listener);
    return () => {
      ipcRenderer.removeListener(SECURITY_EVENT_CHANNELS.lockRequested, listener);
    };
  },
});
