const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vellumDesktop', {
  isDesktopApp: true,
  platform: process.platform,
  getBackendUrl: () => ipcRenderer.invoke('vellum:get-backend-url'),
  getBackendStatus: () => ipcRenderer.invoke('vellum:get-backend-status'),
  restartBackend: () => ipcRenderer.invoke('vellum:restart-backend'),
  openFileDialog: () => ipcRenderer.invoke('vellum:open-file-dialog'),
  saveFileDialog: (defaultFilename) => ipcRenderer.invoke('vellum:save-file-dialog', defaultFilename),
  printDocument: () => ipcRenderer.invoke('vellum:print-document'),
  onMenuAction: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('vellum:menu-action', listener);
    return () => ipcRenderer.removeListener('vellum:menu-action', listener);
  },
});

