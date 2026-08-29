const fs = require('fs');
const path = require('path');

const DEFAULT_SETTINGS = {
  background: '',
  theme: 'default',
  accent: '#66c0f4',
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'qwen2.5:3b',
  hotkey: 'CommandOrControl+Shift+V',
  autoStart: true,
  minimizeToTray: true,
  minimizeOnPlay: true,
  dynamicAccent: true,
  overlayEnabled: true,
  overlayCorner: 'top',
  steamApiKey: '',
  steamId: '',
  screenshotHotkey: 'F12',
  weeklyGoalMinutes: 0,
  discordRpc: false,
  discordClientId: '',
  sessionAlertMinutes: 0,
  backupDrivePath: 'G:\\VaultixSaves',
  googleDrivePath: '',
  homeWidgets: ['streak', 'friends', 'recent', 'all'],
};

const GAME_DEFAULTS = {
  favorite: false,
  background: '',
  playtimeMinutes: 0,
  steamPlaytimeMinutes: 0,
  launchCount: 0,
  lastPlayed: null,
  rating: 0,
  tags: [],
  collection: '',
  notes: '',
  savePaths: [],
};

class Store {
  constructor(file) {
    this.file = file;
    this.data = {
      version: 3,
      games: [],
      sessions: [],
      settings: { ...DEFAULT_SETTINGS },
      achievements: {},          // id -> { unlocked: ts|null, progress: number, seen: bool }
      appStats: { opens: 0, firstOpen: null, aiDescribes: 0 },
    };
    this.load();
  }
  load() {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (e) { return; /* first run */ }

    this.data.version = 3;
    this.data.games = Array.isArray(parsed.games) ? parsed.games : [];
    this.data.sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
    this.data.settings = Object.assign({ ...DEFAULT_SETTINGS }, parsed.settings || {});
    this.data.achievements = parsed.achievements && typeof parsed.achievements === 'object' ? parsed.achievements : {};
    this.data.appStats = Object.assign({ opens: 0, firstOpen: null, aiDescribes: 0 }, parsed.appStats || {});

    // migration / backfill
    for (const g of this.data.games) {
      for (const [k, v] of Object.entries(GAME_DEFAULTS)) {
        if (g[k] === undefined) g[k] = v;
      }
    }
    if (parsed.version !== 3) this.save();
  }
  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file); // atomic-ish: never leave a half-written file
    } catch (e) { console.error('store save failed', e); }
  }
  get games() { return this.data.games; }
  set games(v) { this.data.games = v; this.save(); }
  get sessions() { return this.data.sessions; }
  set sessions(v) { this.data.sessions = v; this.save(); }
  get settings() { return this.data.settings; }
  set settings(v) { this.data.settings = v; this.save(); }
  get achievements() { return this.data.achievements; }
  set achievements(v) { this.data.achievements = v; this.save(); }
  get appStats() { return this.data.appStats; }
  set appStats(v) { this.data.appStats = v; this.save(); }

  addSession(rec) {
    this.data.sessions.push(rec);
    if (this.data.sessions.length > 5000) this.data.sessions = this.data.sessions.slice(-5000);
    this.save();
  }

  raw() { return this.data; }
}

module.exports = { Store, DEFAULT_SETTINGS, GAME_DEFAULTS };
