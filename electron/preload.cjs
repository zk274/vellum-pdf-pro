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
  minimizeWindow: () => ipcRenderer.invoke('vellum:window-minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('vellum:window-toggle-maximize'),
  closeWindow: () => ipcRenderer.invoke('vellum:window-close'),
  isWindowMaximized: () => ipcRenderer.invoke('vellum:window-is-maximized'),
  onWindowStateChange: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('vellum:window-state-changed', listener);
    return () => ipcRenderer.removeListener('vellum:window-state-changed', listener);
  },
  onMenuAction: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('vellum:menu-action', listener);
    return () => ipcRenderer.removeListener('vellum:menu-action', listener);
  },
});

