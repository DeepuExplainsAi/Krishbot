const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('krishbot', { get: () => ipcRenderer.invoke('cfg:get'), save: (v) => ipcRenderer.invoke('cfg:save', v) });
