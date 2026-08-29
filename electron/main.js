const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, globalShortcut, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

const _logFile = path.join(process.env.APPDATA || '.', 'Vaultix', 'vaultix.log');
function _log(msg) { try { fs.appendFileSync(_logFile, `[${new Date().toISOString()}] ${msg}\n`); } catch (e) {} }
process.on('uncaughtException', (err) => { _log('UNCAUGHT: ' + (err.stack || err)); });
process.on('unhandledRejection', (err) => { _log('UNHANDLED: ' + (err && err.stack || err)); });
const { spawn, exec } = require('child_process');
const { Store } = require('./store');
const { scanSteamGames, readSteamPlaytime, findSteamRoot } = require('./steam');
const { scanEpicGames } = require('./epic');
const { describeGame, listModels, findSavePaths } = require('./ai');
const { scanGogGames } = require('./gog');
const { evaluate: evalAchievements } = require('./achievements');
const { detectSteamId, getGameAchievements, fetchPlayerAchievements, getSteamFriends } = require('./steam-achievements');
const { DiscordRPC } = require('./discord-rpc');
const { autoUpdater } = require('electron-updater');

// FORCE data to %APPDATA%\Vaultix regardless of portable vs installed mode.
// This is the critical fix: electron-builder portable can reset userData on re-extract.
const forcedDataDir = path.join(process.env.APPDATA || app.getPath('appData'), 'Vaultix');
app.setPath('userData', forcedDataDir);
const dataDir = forcedDataDir;
fs.mkdirSync(dataDir, { recursive: true });
const storeFile = path.join(dataDir, 'vaultix.json');

// one-time migration: pull data that older portable builds kept next to the exe
if (!fs.existsSync(storeFile) && process.env.PORTABLE_EXECUTABLE_DIR) {
  const old = path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'VaultixData');
  try {
    if (fs.existsSync(path.join(old, 'vaultix.json'))) {
      fs.copyFileSync(path.join(old, 'vaultix.json'), storeFile);
      if (fs.existsSync(path.join(old, 'covers'))) {
        fs.cpSync(path.join(old, 'covers'), path.join(dataDir, 'covers'), { recursive: true });
      }
      console.log('migrated data from', old);
    }
  } catch (e) { console.error('data migration failed', e); }
}

const store = new Store(storeFile);
const coversDir = path.join(dataDir, 'covers');
fs.mkdirSync(coversDir, { recursive: true });
const screenshotsDir = path.join(dataDir, 'screenshots');
fs.mkdirSync(screenshotsDir, { recursive: true });

const startHidden = process.argv.includes('--hidden');
let win;
let overlay;
let tray;
let isQuitting = false;
const sessions = new Map(); // gameId -> { startedAt, pid, watcher, alertTimer }
const discord = new DiscordRPC();
let screenshotHotkeyRegistered = false;
const backupsDir = path.join(dataDir, 'backups');
fs.mkdirSync(backupsDir, { recursive: true });

// single instance
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }
app.on('second-instance', () => showWindow());

// ---------- tray icon (generated, no asset file needed) ----------
function makeIcon(size) {
  const buf = Buffer.alloc(size * size * 4);
  const r = size * 0.18;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // rounded-rect mask
      const cx = Math.min(x, size - 1 - x), cy = Math.min(y, size - 1 - y);
      const inCorner = cx < r && cy < r && Math.hypot(r - cx, r - cy) > r;
      const on = !inCorner && x > 1 && y > 1 && x < size - 2 && y < size - 2;
      // diagonal "V" stripe
      const stripe = Math.abs((x / size) - (y / size)) < 0.16 || Math.abs((x / size) - (1 - y / size)) < 0.16;
      if (!on) { buf[i + 3] = 0; continue; }
      const accent = stripe ? [255, 255, 255] : [244, 192, 102]; // BGR of #66c0f4 -> stored BGRA
      buf[i] = accent[0]; buf[i + 1] = accent[1]; buf[i + 2] = accent[2]; buf[i + 3] = 255;
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0b0f14',
    title: 'Vaultix',
    autoHideMenuBar: true,
    show: !startHidden,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));

  win.on('close', (e) => {
    if (!isQuitting && store.settings.minimizeToTray) {
      e.preventDefault();
      win.hide();
    }
  });
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}
function toggleWindow() {
  if (!win) return;
  if (win.isVisible() && win.isFocused()) win.hide();
  else showWindow();
}

function setupTray() {
  try {
    tray = new Tray(makeIcon(16));
    tray.setToolTip('Vaultix');
    const menu = Menu.buildFromTemplate([
      { label: 'Show Vaultix', click: showWindow },
      { type: 'separator' },
      { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
    ]);
    tray.setContextMenu(menu);
    tray.on('click', showWindow);
    tray.on('double-click', showWindow);
  } catch (e) { console.error('tray failed', e); }
}

// ---------- achievement overlay (transparent, click-through, always-on-top) ----------
function createOverlay() {
  const { width } = require('electron').screen.getPrimaryDisplay().workAreaSize;
  overlay = new BrowserWindow({
    width: 520, height: 150,
    x: Math.round(width / 2 - 260), y: 0,
    transparent: true, frame: false, resizable: false, movable: false,
    focusable: false, skipTaskbar: true, show: false, hasShadow: false,
    alwaysOnTop: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  overlay.setIgnoreMouseEvents(true);
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.loadFile(path.join(__dirname, '..', 'src', 'overlay.html'));
}

let overlayHideTimer = null;
function showOverlay(achievement) {
  if (!store.settings.overlayEnabled) return;
  try {
    if (!overlay || overlay.isDestroyed()) createOverlay();
    const push = () => {
      overlay.setAlwaysOnTop(true, 'screen-saver');
      overlay.showInactive();
      overlay.webContents.send('achievement', achievement);
      clearTimeout(overlayHideTimer);
      overlayHideTimer = setTimeout(() => { if (overlay && !overlay.isDestroyed()) overlay.hide(); }, 6500);
    };
    if (overlay.webContents.isLoading()) overlay.webContents.once('did-finish-load', push);
    else push();
  } catch (e) { console.error('overlay failed', e); }
}

// run the achievement engine; fire overlay + renderer event for anything new
function checkAchievements() {
  try {
    const { unlocked } = evalAchievements(store);
    for (const a of unlocked) {
      showOverlay(a);
      send('achievement-unlocked', a);
    }
    if (unlocked.length) send('achievements-changed');
  } catch (e) { console.error('achievements failed', e); }
}

function registerHotkey() {
  try { globalShortcut.unregisterAll(); } catch (e) {}
  const hk = store.settings.hotkey || 'CommandOrControl+Shift+V';
  try { globalShortcut.register(hk, toggleWindow); } catch (e) { console.error('hotkey failed', hk, e); }
  if (sessions.size > 0) registerScreenshotHotkey();
}

function registerScreenshotHotkey() {
  if (screenshotHotkeyRegistered) return;
  const hk = store.settings.screenshotHotkey || 'F12';
  try {
    globalShortcut.register(hk, () => takeScreenshot());
    screenshotHotkeyRegistered = true;
  } catch (e) { console.error('screenshot hotkey failed', hk, e); }
}

function unregisterScreenshotHotkey() {
  if (!screenshotHotkeyRegistered) return;
  const hk = store.settings.screenshotHotkey || 'F12';
  try { globalShortcut.unregister(hk); } catch (e) {}
  screenshotHotkeyRegistered = false;
}

async function takeScreenshot(gameId) {
  try {
    const id = gameId || (sessions.size > 0 ? [...sessions.keys()][0] : null);
    if (!id) return null;
    const gameDir = path.join(screenshotsDir, id);
    fs.mkdirSync(gameDir, { recursive: true });
    const filename = `ss_${Date.now()}.png`;
    const filepath = path.join(gameDir, filename);
    const ps = `Add-Type -AssemblyName System.Windows.Forms,System.Drawing;` +
      `$s=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds;` +
      `$b=New-Object Drawing.Bitmap($s.Width,$s.Height);` +
      `$g=[Drawing.Graphics]::FromImage($b);` +
      `$g.CopyFromScreen($s.Location,[Drawing.Point]::Empty,$s.Size);` +
      `$b.Save('${filepath.replace(/'/g, "''")}');` +
      `$g.Dispose();$b.Dispose()`;
    await new Promise((resolve, reject) => {
      exec(`powershell -NoProfile -Command "${ps}"`, { timeout: 5000 }, (err) => err ? reject(err) : resolve());
    });
    send('screenshot-taken', { gameId: id, filename, path: filepath });
    showOverlay({ icon: '📸', name: 'Screenshot saved', desc: filename });
    return { ok: true, filename, path: filepath };
  } catch (e) {
    console.error('screenshot failed', e);
    return { ok: false, error: e.message };
  }
}

// ---------- Discord Rich Presence ----------
async function startDiscord(gameName, startedAt) {
  if (!store.settings.discordRpc || !store.settings.discordClientId) return;
  try {
    await discord.connect(store.settings.discordClientId);
    discord.setActivity(`Playing ${gameName}`, 'via Vaultix', startedAt);
  } catch (e) { console.error('discord rpc failed', e.message); }
}
function stopDiscord() {
  try { discord.clearActivity(); } catch (e) {}
}

function applyAutoStart() {
  try {
    app.setLoginItemSettings({
      openAtLogin: store.settings.autoStart !== false,
      args: ['--hidden'],
    });
  } catch (e) { console.error('autostart failed', e); }
}

// ---------- auto-update from GitHub ----------
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.on('update-available', (info) => {
  console.log('update available', info.version);
  send('update-status', { status: 'downloading', version: info.version });
});
autoUpdater.on('update-downloaded', (info) => {
  console.log('update downloaded', info.version);
  send('update-status', { status: 'ready', version: info.version });
});
autoUpdater.on('update-not-available', () => {
  send('update-status', { status: 'up-to-date' });
});
autoUpdater.on('error', (err) => {
  console.error('auto-update error', err.message);
  send('update-status', { status: 'error', error: err.message });
});

app.whenReady().then(() => {
  createWindow();
  createOverlay();
  setupTray();
  registerHotkey();
  applyAutoStart();

  const st = store.appStats;
  st.opens = (st.opens || 0) + 1;
  if (!st.firstOpen) st.firstOpen = Date.now();
  store.appStats = st;
  setTimeout(checkAchievements, 1500);

  setTimeout(() => {
    try { autoUpdater.checkForUpdates(); } catch (e) { console.error('update check failed', e.message); }
  }, 5000);

  setTimeout(() => checkOllama(), 3000);
  setTimeout(() => autoScanLibraries(), 4000);
});

function autoScanLibraries() {
  try {
    const steam = scanSteamGames();
    const epic = scanEpicGames();
    const gog = scanGogGames();
    const haveSteam = new Set(store.games.filter((g) => g.type === 'steam').map((g) => g.appid));
    const haveEpic = new Set(store.games.filter((g) => g.type === 'epic').map((g) => g.appid));
    const haveGog = new Set(store.games.filter((g) => g.type === 'gog').map((g) => g.appid));
    const newGames = [
      ...(steam.games || []).filter((g) => !haveSteam.has(g.appid)),
      ...(epic.games || []).filter((g) => !haveEpic.has(g.appid)),
      ...(gog.games || []).filter((g) => !haveGog.has(g.appid)),
    ];
    if (newGames.length > 0) {
      send('new-games-found', { count: newGames.length });
    }
  } catch (e) { console.error('auto-scan failed', e); }
}

async function checkOllama() {
  const base = (store.settings.ollamaUrl || 'http://localhost:11434').replace(/\/+$/, '');
  try {
    const r = await fetch(base + '/api/tags', { signal: AbortSignal.timeout(3000) });
    if (r.ok) return;
  } catch (e) { /* not running */ }
  try {
    const ollamaApp = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama app.exe');
    if (fs.existsSync(ollamaApp)) {
      const p = spawn(ollamaApp, [], { detached: true, stdio: 'ignore' });
      p.unref();
      console.log('auto-started ollama app');
    } else {
      const p = spawn('ollama', ['serve'], { detached: true, stdio: 'ignore', shell: true });
      p.unref();
      console.log('auto-started ollama serve (app not found)');
    }
  } catch (e) {
    console.error('could not auto-start ollama', e.message);
    send('ollama-not-running');
  }
}

ipcMain.handle('start-ollama', async () => {
  try {
    const ollamaApp = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama app.exe');
    if (fs.existsSync(ollamaApp)) {
      const p = spawn(ollamaApp, [], { detached: true, stdio: 'ignore' });
      p.unref();
    } else {
      const p = spawn('ollama', ['serve'], { detached: true, stdio: 'ignore', shell: true });
      p.unref();
    }
    await new Promise((r) => setTimeout(r, 3000));
    const base = (store.settings.ollamaUrl || 'http://localhost:11434').replace(/\/+$/, '');
    const r = await fetch(base + '/api/tags', { signal: AbortSignal.timeout(3000) });
    return { ok: r.ok };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
app.on('window-all-closed', () => { /* keep alive in tray */ });
app.on('before-quit', () => { isQuitting = true; });
app.on('will-quit', () => globalShortcut.unregisterAll());

// ---------- helpers ----------
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
function send(channel, payload) { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); }

function finalizeSession(gameId) {
  const s = sessions.get(gameId);
  if (!s) return;
  if (s.watcher) clearInterval(s.watcher);
  if (s.alertTimer) clearInterval(s.alertTimer);
  const end = Date.now();
  const minutes = Math.max(0, Math.round((end - s.startedAt) / 60000));
  const games = store.games;
  const g = games.find((x) => x.id === gameId);
  if (g) {
    g.playtimeMinutes = (g.playtimeMinutes || 0) + minutes;
    g.lastPlayed = end;
    g.launchCount = (g.launchCount || 0) + 1;
    store.games = games;
    store.addSession({ gameId, start: s.startedAt, end, minutes, source: 'vaultix' });
  }
  sessions.delete(gameId);
  if (sessions.size === 0) {
    stopSteamAchievementPolling();
    unregisterScreenshotHotkey();
    stopDiscord();
  }
  send('session-ended', {
    gameId, minutes,
    name: g ? g.name : '',
    playtimeMinutes: g ? g.playtimeMinutes : 0,
    totalMinutes: g ? (g.playtimeMinutes || 0) + (g.steamPlaytimeMinutes || 0) : 0,
    lastPlayed: g ? g.lastPlayed : null,
  });
  checkAchievements();
  if (store.settings.minimizeOnPlay && win && !win.isDestroyed()) showWindow();
}

function watchPid(gameId, pid) {
  const w = setInterval(() => {
    exec(`tasklist /FI "PID eq ${pid}" /NH`, (err, out) => {
      if (err) return;
      if (!out || !out.includes(String(pid))) finalizeSession(gameId);
    });
  }, 5000);
  if (sessions.get(gameId)) sessions.get(gameId).watcher = w;
}

function watchImage(gameId, imageName) {
  let sawIt = false;
  const w = setInterval(() => {
    exec(`tasklist /FI "IMAGENAME eq ${imageName}" /NH`, (err, out) => {
      if (err) return;
      const running = out && out.toLowerCase().includes(imageName.toLowerCase());
      if (running) sawIt = true;
      else if (sawIt) finalizeSession(gameId);
    });
  }, 5000);
  if (sessions.get(gameId)) sessions.get(gameId).watcher = w;
}

// ---------- IPC ----------
ipcMain.handle('get-state', () => ({
  games: store.games,
  settings: store.settings,
  sessions: store.sessions,
  running: [...sessions.entries()].map(([id, s]) => ({ id, startedAt: s.startedAt })),
}));

ipcMain.handle('save-settings', (e, settings) => {
  store.settings = Object.assign(store.settings, settings);
  registerHotkey();
  applyAutoStart();
  return store.settings;
});

ipcMain.handle('pick-file', async (e, opts) => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: opts && opts.images
      ? [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
      : [{ name: 'Programs', extensions: ['exe', 'lnk', 'bat', 'url'] }],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('import-cover', async (e, srcPath) => {
  try {
    const ext = path.extname(srcPath) || '.png';
    const dest = path.join(coversDir, uid() + ext);
    fs.copyFileSync(srcPath, dest);
    return 'file://' + dest.replace(/\\/g, '/');
  } catch (err) { return null; }
});

ipcMain.handle('add-exe-game', (e, game) => {
  const games = store.games;
  const norm = (p) => path.normalize(p || '').toLowerCase();
  if (game.exePath && games.some((g) => g.type === 'exe' && norm(g.exePath) === norm(game.exePath))) {
    return games.find((g) => g.type === 'exe' && norm(g.exePath) === norm(game.exePath));
  }
  const entry = {
    id: uid(),
    type: 'exe',
    name: game.name || path.basename(game.exePath, path.extname(game.exePath)),
    exePath: game.exePath,
    args: game.args || '',
    cover: game.cover || '',
    description: game.description || '',
    imageName: path.basename(game.exePath),
    favorite: false,
    playtimeMinutes: 0,
    steamPlaytimeMinutes: 0,
    launchCount: 0,
    lastPlayed: null,
    addedAt: Date.now(),
  };
  games.push(entry);
  store.games = games;
  checkAchievements();
  return entry;
});

// ---------- session alerts ----------
function startSessionAlert(gameId, gameName) {
  const mins = store.settings.sessionAlertMinutes;
  if (!mins || mins <= 0) return;
  const s = sessions.get(gameId);
  if (!s) return;
  s.alertTimer = setInterval(() => {
    const elapsed = Math.round((Date.now() - s.startedAt) / 60000);
    send('session-alert', { gameId, name: gameName, minutes: elapsed });
    showOverlay({ icon: '⏰', name: `${gameName}`, desc: `You've been playing for ${elapsed} minutes` });
  }, mins * 60000);
}

// combined scan: steam + epic + gog, filtered against what's already in the library
ipcMain.handle('scan-libraries', () => {
  const steam = scanSteamGames();
  const epic = scanEpicGames();
  const gog = scanGogGames();
  const haveSteam = new Set(store.games.filter((g) => g.type === 'steam').map((g) => g.appid));
  const haveEpic = new Set(store.games.filter((g) => g.type === 'epic').map((g) => g.appid));
  const haveGog = new Set(store.games.filter((g) => g.type === 'gog').map((g) => g.appid));
  return {
    steamRoot: steam.steamRoot,
    epicDir: epic.epicDir,
    gogDir: gog.gogDir,
    errors: [steam.error, epic.error, gog.error].filter(Boolean),
    newSteam: (steam.games || []).filter((g) => !haveSteam.has(g.appid)),
    newEpic: (epic.games || []).filter((g) => !haveEpic.has(g.appid)),
    newGog: (gog.games || []).filter((g) => !haveGog.has(g.appid)),
  };
});

ipcMain.handle('add-games', (e, picked) => {
  const games = store.games;
  const have = new Set(games.map((g) => g.type + ':' + g.appid));
  const added = [];
  let skipped = 0;
  for (const g of picked || []) {
    const key = g.type + ':' + g.appid;
    if (have.has(key)) { skipped++; continue; }
    have.add(key);
    const entry = {
      id: uid(),
      type: g.type,
      appid: g.appid,
      epicAppName: g.epicAppName,
      launchUrl: g.launchUrl || '',
      name: g.name,
      cover: g.cover || g.headerImage || '',
      description: '',
      installDir: g.installDir || '',
      exePath: g.exePath || '',
      imageName: g.imageName || '',
      favorite: false,
      playtimeMinutes: 0,
      steamPlaytimeMinutes: g.steamPlaytimeMinutes || 0,
      launchCount: 0,
      lastPlayed: g.lastPlayed || null,
      addedAt: Date.now(),
    };
    games.push(entry);
    added.push(entry);
  }
  store.games = games;
  checkAchievements();
  return { added, skipped };
});

ipcMain.handle('sync-steam-playtime', () => {
  const root = findSteamRoot();
  if (!root) return { ok: false, error: 'Steam not found' };
  const pt = readSteamPlaytime(root);
  const games = store.games;
  let updated = 0;
  for (const g of games) {
    if (g.type !== 'steam' || !pt[g.appid]) continue;
    g.steamPlaytimeMinutes = pt[g.appid].minutes;
    if (pt[g.appid].lastPlayed && (!g.lastPlayed || pt[g.appid].lastPlayed > g.lastPlayed)) {
      g.lastPlayed = pt[g.appid].lastPlayed;
    }
    updated++;
  }
  store.games = games;
  return { ok: true, updated };
});

ipcMain.handle('update-game', (e, patch) => {
  const games = store.games;
  const g = games.find((x) => x.id === patch.id);
  if (!g) return null;
  Object.assign(g, patch);
  store.games = games;
  return g;
});

ipcMain.handle('toggle-favorite', (e, id) => {
  const games = store.games;
  const g = games.find((x) => x.id === id);
  if (!g) return null;
  g.favorite = !g.favorite;
  store.games = games;
  checkAchievements();
  return g.favorite;
});

ipcMain.handle('remove-game', (e, id) => {
  store.games = store.games.filter((g) => g.id !== id);
  if (sessions.has(id)) finalizeSession(id);
  return true;
});

ipcMain.handle('launch-game', async (e, id) => {
  const g = store.games.find((x) => x.id === id);
  if (!g) return { ok: false, error: 'not found' };
  if (sessions.has(id)) return { ok: false, error: 'already running' };
  try {
    if (g.type === 'exe') {
      if (!fs.existsSync(g.exePath)) return { ok: false, error: 'exe missing: ' + g.exePath };
      const args = g.args ? g.args.trim() : '';
      if (args) {
        exec(`start "" "${g.exePath}" ${args}`, { cwd: path.dirname(g.exePath) });
      } else {
        const err = await shell.openPath(g.exePath);
        if (err) return { ok: false, error: err };
      }
      sessions.set(id, { startedAt: Date.now(), pid: null });
      const imgName = g.imageName || path.basename(g.exePath);
      if (imgName) watchImage(id, imgName);
    } else if (g.type === 'gog') {
      if (g.exePath && fs.existsSync(g.exePath)) {
        const err = await shell.openPath(g.exePath);
        if (err) return { ok: false, error: err };
      } else {
        shell.openExternal(`goggalaxy://openGameView/${g.appid}`);
      }
      sessions.set(id, { startedAt: Date.now(), pid: null });
      if (g.imageName) watchImage(id, g.imageName);
    } else if (g.type === 'epic') {
      shell.openExternal(g.launchUrl || `com.epicgames.launcher://apps/${g.appid}?action=launch&silent=true`);
      sessions.set(id, { startedAt: Date.now(), pid: null });
      if (g.imageName) watchImage(id, g.imageName);
    } else {
      shell.openExternal('steam://rungameid/' + g.appid);
      sessions.set(id, { startedAt: Date.now(), pid: null });
      if (g.imageName) watchImage(id, g.imageName);
    }
    const hr = new Date().getHours();
    if (hr >= 2 && hr < 5 && !store.appStats.nightOwl) {
      store.appStats = { ...store.appStats, nightOwl: true };
    }
    checkAchievements();
    if (g.type === 'steam' && g.appid) startSteamAchievementPolling(id, g.appid);
    registerScreenshotHotkey();
    startDiscord(g.name, Date.now());
    startSessionAlert(id, g.name);
    send('session-started', { gameId: id, startedAt: Date.now() });
    if (store.settings.minimizeOnPlay && win && !win.isDestroyed()) {
      setTimeout(() => { if (sessions.has(id)) win.hide(); }, 1200);
    }
    return { ok: true };
  } catch (err) {
    sessions.delete(id);
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle('stop-tracking', (e, id) => { finalizeSession(id); return true; });

// ---------- Steam achievement polling ----------
const steamAchCache = new Map(); // appid -> { apiName -> achieved }
let steamPollInterval = null;

function startSteamAchievementPolling(gameId, appid) {
  const apiKey = store.settings.steamApiKey;
  const steamId = store.settings.steamId || detectSteamId();
  if (!apiKey || !steamId || !appid) return;

  const poll = async () => {
    try {
      const res = await fetchPlayerAchievements(appid, apiKey, steamId);
      if (!res) return;
      const prev = steamAchCache.get(appid) || new Map();
      const curr = new Map();
      const newUnlocks = [];
      for (const a of res) {
        curr.set(a.apiName, a.achieved);
        if (a.achieved && !prev.get(a.apiName)) {
          newUnlocks.push(a);
        }
      }
      steamAchCache.set(appid, curr);

      // store the achievements state on the game
      const games = store.games;
      const g = games.find((x) => x.id === gameId);
      if (g) {
        if (!g.steamAchievements) g.steamAchievements = {};
        for (const a of res) {
          if (a.achieved && !g.steamAchievements[a.apiName]) {
            g.steamAchievements[a.apiName] = a.unlockTime || Date.now();
          }
        }
        g.steamAchievementsTotal = res.length;
        g.steamAchievementsUnlocked = res.filter((a) => a.achieved).length;
        store.games = games;
      }

      if (prev.size > 0) {
        for (const u of newUnlocks) {
          showOverlay({ icon: '🏆', name: u.apiName, desc: 'Steam Achievement Unlocked!' });
          send('achievement-unlocked', { icon: '🏆', name: u.apiName, desc: 'Steam Achievement Unlocked!' });
        }
      }
    } catch (e) { /* silent */ }
  };

  poll();
  steamPollInterval = setInterval(poll, 30000);
}

function stopSteamAchievementPolling() {
  if (steamPollInterval) { clearInterval(steamPollInterval); steamPollInterval = null; }
}

ipcMain.handle('ai-describe', async (e, { name, gameId }) => {
  try {
    const { ollamaUrl, ollamaModel } = store.settings;
    const r = await describeGame({ name, ollamaUrl, ollamaModel });
    if (r.ok && !r.stub && gameId) {
      const games = store.games;
      const g = games.find((x) => x.id === gameId);
      if (g) {
        let desc = r.description || '';
        const tags = [r.genre, r.year, r.developer].filter(Boolean).join(' · ');
        if (tags) desc += `\n\n[${tags}]`;
        if (r.uncertain) desc += '\n(model was unsure this game exists — double-check)';
        g.description = desc;
        store.games = games;
      }
      store.appStats = { ...store.appStats, aiDescribes: (store.appStats.aiDescribes || 0) + 1 };
      checkAchievements();
    }
    return r;
  } catch (err) { return { ok: false, error: String(err) }; }
});
ipcMain.handle('ai-models', () => listModels(store.settings.ollamaUrl));

ipcMain.handle('get-achievements', () => {
  const { list } = evalAchievements(store);
  return { list, unlockedCount: list.filter((a) => a.unlocked).length, total: list.length };
});
ipcMain.handle('mark-achievements-seen', () => {
  const a = store.achievements;
  for (const k in a) a[k].seen = true;
  store.achievements = a;
  return true;
});
ipcMain.handle('get-steam-achievements', async (e, gameId) => {
  const g = store.games.find((x) => x.id === gameId);
  if (!g || g.type !== 'steam' || !g.appid) return { ok: false, error: 'not a steam game' };
  const apiKey = store.settings.steamApiKey;
  const steamId = store.settings.steamId || detectSteamId();
  if (!apiKey || !steamId) return { ok: false, error: 'Steam API key or Steam ID not set. Configure in Settings.' };
  return getGameAchievements(g.appid, apiKey, steamId);
});

ipcMain.handle('install-update', () => {
  autoUpdater.quitAndInstall(false, true);
});
ipcMain.handle('check-update', async () => {
  try {
    const r = await autoUpdater.checkForUpdates();
    return r ? { version: r.updateInfo.version } : { error: 'No response from update server' };
  } catch (e) { return { error: e.message }; }
});
ipcMain.handle('get-version', () => app.getVersion());

ipcMain.handle('detect-steam-id', () => {
  return detectSteamId() || null;
});

ipcMain.handle('test-overlay', () => {
  showOverlay({ icon: '🏆', name: 'Test Achievement', desc: 'This is what an unlock looks like in-game' });
  return true;
});

ipcMain.handle('open-folder', (e, id) => {
  const g = store.games.find((x) => x.id === id);
  if (!g) return false;
  const target = g.type === 'exe' ? g.exePath : g.installDir;
  if (target && fs.existsSync(target)) { shell.showItemInFolder(target); return true; }
  return false;
});
ipcMain.handle('open-store-page', (e, id) => {
  const g = store.games.find((x) => x.id === id);
  if (!g) return false;
  if (g.type === 'steam') shell.openExternal('steam://store/' + g.appid);
  else if (g.type === 'epic') shell.openExternal('com.epicgames.launcher://store/p/' + g.appid);
  return true;
});
ipcMain.handle('uninstall-game', (e, id) => {
  const g = store.games.find((x) => x.id === id);
  if (!g) return false;
  if (g.type === 'steam') shell.openExternal('steam://uninstall/' + g.appid);
  else if (g.type === 'epic' && g.installDir) shell.openPath(g.installDir);
  else if (g.type === 'exe') {
    const ac = process.env.WINDIR ? path.join(process.env.WINDIR, 'System32', 'appwiz.cpl') : 'appwiz.cpl';
    shell.openPath(ac);
  }
  return true;
});

// ---------- backup / restore ----------
ipcMain.handle('export-library', async () => {
  const r = await dialog.showSaveDialog(win, {
    defaultPath: `vaultix-backup-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (r.canceled) return { ok: false };
  fs.writeFileSync(r.filePath, JSON.stringify({ ...store.raw(), exportedAt: Date.now() }, null, 2));
  return { ok: true, path: r.filePath };
});

ipcMain.handle('import-library', async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (r.canceled) return { ok: false };
  let data;
  try { data = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')); }
  catch (e) { return { ok: false, error: 'bad file' }; }

  // snapshot current
  try {
    fs.copyFileSync(store.file, path.join(dataDir, `vaultix.backup-${Date.now()}.json`));
  } catch (e) {}

  const games = store.games;
  const key = (g) => g.type + ':' + (g.appid || path.normalize(g.exePath || '').toLowerCase() || g.id);
  const have = new Set(games.map(key));
  let merged = 0;
  for (const g of data.games || []) {
    if (have.has(key(g))) continue;
    have.add(key(g));
    games.push(g);
    merged++;
  }
  store.games = games;
  if (Array.isArray(data.sessions)) {
    store.sessions = [...store.sessions, ...data.sessions];
  }
  if (data.settings) store.settings = Object.assign(store.settings, data.settings);
  return { ok: true, merged };
});

// ---------- screenshots ----------
ipcMain.handle('take-screenshot', async (e, gameId) => {
  return takeScreenshot(gameId);
});

ipcMain.handle('get-screenshots', (e, gameId) => {
  const gameDir = path.join(screenshotsDir, gameId);
  try {
    if (!fs.existsSync(gameDir)) return [];
    return fs.readdirSync(gameDir)
      .filter((f) => f.endsWith('.png'))
      .sort((a, b) => b.localeCompare(a))
      .map((f) => ({
        filename: f,
        path: 'file://' + path.join(gameDir, f).replace(/\\/g, '/'),
        time: parseInt(f.replace('ss_', '').replace('.png', ''), 10) || 0,
      }));
  } catch (e) { return []; }
});

ipcMain.handle('delete-screenshot', (e, { gameId, filename }) => {
  try {
    fs.unlinkSync(path.join(screenshotsDir, gameId, filename));
    return true;
  } catch (e) { return false; }
});

ipcMain.handle('open-screenshot', (e, filepath) => {
  shell.openPath(filepath.replace('file://', '').replace(/\//g, '\\'));
});

// ---------- Steam friends ----------
ipcMain.handle('get-steam-friends', async () => {
  const apiKey = store.settings.steamApiKey;
  const steamId = store.settings.steamId || detectSteamId();
  if (!apiKey || !steamId) return { ok: false, error: 'Steam API key or ID not set' };
  const friends = await getSteamFriends(apiKey, steamId);
  return { ok: true, friends };
});

// ---------- save file backup ----------
function expandEnvPath(p) {
  return p.replace(/%([^%]+)%/g, (_, k) => process.env[k] || `%${k}%`);
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  let count = 0;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      count += copyDirRecursive(s, d);
    } else {
      fs.copyFileSync(s, d);
      count++;
    }
  }
  return count;
}

ipcMain.handle('find-save-paths', async (e, { name }) => {
  const { ollamaUrl, ollamaModel } = store.settings;
  return findSavePaths({ name, ollamaUrl, ollamaModel });
});

ipcMain.handle('backup-saves', async (e, { gameId, gameName, paths }) => {
  const results = { backed: 0, errors: [], destinations: [] };
  const safeName = gameName.replace(/[<>:"/\\|?*]/g, '_');
  const timestamp = new Date().toISOString().slice(0, 10);
  const targets = [];
  const drivePath = store.settings.backupDrivePath;
  const gdrivePath = store.settings.googleDrivePath;
  if (drivePath) targets.push(path.join(drivePath, safeName, timestamp));
  if (gdrivePath) targets.push(path.join(gdrivePath, 'VaultixSaves', safeName, timestamp));

  if (!targets.length) return { ok: false, error: 'No backup destinations configured. Set paths in Settings.' };

  for (const savePath of paths) {
    const expanded = expandEnvPath(savePath);
    if (!fs.existsSync(expanded)) {
      results.errors.push(`Not found: ${expanded}`);
      continue;
    }
    const stat = fs.statSync(expanded);
    for (const target of targets) {
      try {
        const basename = path.basename(expanded);
        const dest = path.join(target, basename);
        if (stat.isDirectory()) {
          results.backed += copyDirRecursive(expanded, dest);
        } else {
          fs.mkdirSync(target, { recursive: true });
          fs.copyFileSync(expanded, dest);
          results.backed++;
        }
        if (!results.destinations.includes(target)) results.destinations.push(target);
      } catch (err) {
        results.errors.push(`${expanded} -> ${target}: ${err.message}`);
      }
    }
  }

  // store the paths on the game for future backups
  const games = store.games;
  const g = games.find((x) => x.id === gameId);
  if (g) { g.savePaths = paths; store.games = games; }

  return { ok: true, ...results };
});

ipcMain.handle('pick-folder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

// ---------- streak / stats ----------
ipcMain.handle('get-streak', () => {
  const sessions = store.sessions;
  const days = new Set();
  for (const s of sessions) {
    const d = new Date(s.start || s.end);
    days.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
  }
  let streak = 0;
  const check = new Date();
  const todayKey = `${check.getFullYear()}-${check.getMonth()}-${check.getDate()}`;
  if (!days.has(todayKey)) check.setDate(check.getDate() - 1);
  while (true) {
    const key = `${check.getFullYear()}-${check.getMonth()}-${check.getDate()}`;
    if (days.has(key)) { streak++; check.setDate(check.getDate() - 1); }
    else break;
  }
  const now = Date.now();
  const weekAgo = now - 7 * 86400000;
  let weeklyMinutes = 0;
  for (const s of sessions) {
    if ((s.start || s.end || 0) >= weekAgo) weeklyMinutes += s.minutes || 0;
  }
  return { streak, weeklyMinutes, goalMinutes: store.settings.weeklyGoalMinutes || 0 };
});
