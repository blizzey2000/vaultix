const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vaultix', {
  getState: () => ipcRenderer.invoke('get-state'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),
  pickFile: (opts) => ipcRenderer.invoke('pick-file', opts),
  importCover: (p) => ipcRenderer.invoke('import-cover', p),
  addExeGame: (g) => ipcRenderer.invoke('add-exe-game', g),
  scanLibraries: () => ipcRenderer.invoke('scan-libraries'),
  addGames: (list) => ipcRenderer.invoke('add-games', list),
  syncSteamPlaytime: () => ipcRenderer.invoke('sync-steam-playtime'),
  updateGame: (patch) => ipcRenderer.invoke('update-game', patch),
  toggleFavorite: (id) => ipcRenderer.invoke('toggle-favorite', id),
  removeGame: (id) => ipcRenderer.invoke('remove-game', id),
  launchGame: (id) => ipcRenderer.invoke('launch-game', id),
  stopTracking: (id) => ipcRenderer.invoke('stop-tracking', id),
  aiDescribe: (name, gameId) => ipcRenderer.invoke('ai-describe', { name, gameId }),
  aiModels: () => ipcRenderer.invoke('ai-models'),
  getAchievements: () => ipcRenderer.invoke('get-achievements'),
  markAchievementsSeen: () => ipcRenderer.invoke('mark-achievements-seen'),
  testOverlay: () => ipcRenderer.invoke('test-overlay'),
  openFolder: (id) => ipcRenderer.invoke('open-folder', id),
  openStorePage: (id) => ipcRenderer.invoke('open-store-page', id),
  uninstallGame: (id) => ipcRenderer.invoke('uninstall-game', id),
  getSteamAchievements: (gameId) => ipcRenderer.invoke('get-steam-achievements', gameId),
  detectSteamId: () => ipcRenderer.invoke('detect-steam-id'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  getVersion: () => ipcRenderer.invoke('get-version'),
  exportLibrary: () => ipcRenderer.invoke('export-library'),
  importLibrary: () => ipcRenderer.invoke('import-library'),
  on: (channel, cb) => {
    const allowed = ['session-started', 'session-ended', 'achievement-unlocked', 'achievements-changed', 'update-status'];
    if (allowed.includes(channel)) ipcRenderer.on(channel, (e, data) => cb(data));
  },
});
