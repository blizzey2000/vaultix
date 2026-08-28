// ---------- Browser-preview mock (inert inside Electron) ----------
const V = window.vaultix || (() => {
  const now = Date.now();
  const demo = {
    games: [
      { id: '1', type: 'steam', appid: '1659040', name: 'HITMAN World of Assassination', cover: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1659040/library_600x900.jpg', description: '', favorite: true, playtimeMinutes: 64, steamPlaytimeMinutes: 1806, launchCount: 24, lastPlayed: now - 2 * 86400000 },
      { id: '2', type: 'steam', appid: '620', name: 'Portal 2', cover: 'https://cdn.cloudflare.steamstatic.com/steam/apps/620/library_600x900.jpg', description: '', favorite: false, playtimeMinutes: 0, steamPlaytimeMinutes: 340, launchCount: 8, lastPlayed: now - 20 * 86400000 },
      { id: '3', type: 'epic', appid: 'Fortnite', name: 'Fortnite', cover: '', description: '', favorite: false, playtimeMinutes: 120, steamPlaytimeMinutes: 0, launchCount: 3, lastPlayed: now - 5 * 86400000, imageName: 'FortniteClient-Win64-Shipping.exe' },
      { id: '4', type: 'exe', name: 'My Game', exePath: 'C:/Games/mygame.exe', cover: '', description: '', favorite: false, playtimeMinutes: 15, steamPlaytimeMinutes: 0, launchCount: 1, lastPlayed: now - 40 * 86400000 },
    ],
    sessions: [
      { gameId: '1', start: now - 2 * 86400000, end: now - 2 * 86400000 + 40 * 60000, minutes: 40, source: 'vaultix' },
      { gameId: '1', start: now - 1 * 86400000, end: now - 1 * 86400000 + 24 * 60000, minutes: 24, source: 'vaultix' },
      { gameId: '3', start: now - 5 * 86400000, end: now - 5 * 86400000 + 120 * 60000, minutes: 120, source: 'vaultix' },
    ],
    settings: { accent: '#66c0f4', background: '', dynamicAccent: true, ollamaUrl: 'http://localhost:11434', ollamaModel: 'qwen2.5:3b', hotkey: 'CommandOrControl+Shift+V', autoStart: true, minimizeToTray: true, minimizeOnPlay: true },
    running: [],
  };
  const ok = async () => ({ ok: true });
  return {
    getState: async () => JSON.parse(JSON.stringify(demo)),
    saveSettings: async (s) => Object.assign(demo.settings, s),
    pickFile: async () => null, importCover: async () => null,
    addExeGame: ok, scanLibraries: async () => ({ newSteam: [], newEpic: [], errors: [] }), addGames: async () => ({ added: [], skipped: 0 }),
    syncSteamPlaytime: async () => ({ ok: true, updated: 0 }),
    updateGame: async (p) => { Object.assign(demo.games.find((g) => g.id === p.id) || {}, p); },
    toggleFavorite: async (id) => { const g = demo.games.find((x) => x.id === id); g.favorite = !g.favorite; return g.favorite; },
    removeGame: ok, launchGame: async () => ({ ok: false, error: 'preview mode' }), stopTracking: ok,
    aiDescribe: async (name, gameId) => { const g = demo.games.find((x) => x.id === gameId); if (g) g.description = 'A sleek stealth-action sandbox where Agent 47 stalks targets across sprawling, systemic levels.\n\n[Stealth · 2024 · IO Interactive]'; return { ok: true, description: 'A sleek stealth-action sandbox where Agent 47 stalks targets across sprawling, systemic levels.', genre: 'Stealth', year: '2024', developer: 'IO Interactive', model: 'qwen2.5:3b (mock)' }; },
    aiModels: async () => ({ ok: true, models: ['qwen2.5:3b', 'llama3.1:latest'] }),
    getAchievements: async () => ({ list: [
      { id: 'open-5', icon: '🚪', name: 'Regular', desc: 'Open Vaultix 5 times', goal: 5, progress: 5, unlocked: now - 3 * 86400000, gameId: null },
      { id: 'open-15', icon: '🔑', name: 'Creature of Habit', desc: 'Open Vaultix 15 times', goal: 15, progress: 8, unlocked: null, gameId: null },
      { id: 'library-10', icon: '📚', name: 'Collector', desc: 'Add 10 games to your vault', goal: 10, progress: 4, unlocked: null, gameId: null },
      { id: '1:play-5h', icon: '🎮', name: 'HITMAN World of Assassination: 5 hours', desc: 'Play HITMAN World of Assassination for 5 hours', goal: 300, progress: 300, unlocked: now - 86400000, gameId: '1' },
      { id: '1:play-25h', icon: '🎮', name: 'HITMAN World of Assassination: 25 hours', desc: 'Play HITMAN World of Assassination for 25 hours', goal: 1500, progress: 1870, unlocked: now - 3600000, gameId: '1' },
    ], unlockedCount: 3, total: 5 }),
    markAchievementsSeen: ok, testOverlay: ok,
    getSteamAchievements: async () => ({ ok: false, error: 'preview mode' }),
    detectSteamId: async () => '76561198012345678',
    installUpdate: ok, checkUpdate: async () => null, getVersion: async () => '1.0.0',
    openFolder: ok, openStorePage: ok, uninstallGame: ok, exportLibrary: ok, importLibrary: async () => ({ ok: true, merged: 0 }),
    on: () => {},
  };
})();

let state = { games: [], settings: {}, sessions: [], running: [] };
let selectedId = null;
let scanCandidates = [];
let currentView = 'home';
let npTimer = null;

const el = (id) => document.getElementById(id);

function toast(msg, ms = 2600) {
  const t = el('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), ms);
}
window.toast = toast;

const combinedMin = (g) => (g.playtimeMinutes || 0) + (g.steamPlaytimeMinutes || 0);
function fmtPlaytime(min) {
  if (!min) return '0 min';
  if (min < 60) return `${Math.round(min)} min`;
  return `${(min / 60).toFixed(1)} hrs`;
}
function fmtLast(ts) {
  if (!ts) return 'Never';
  const d = new Date(ts);
  const days = Math.floor((Date.now() - d) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
const runningIds = () => state.running.map((r) => r.id);
function escapeHtml(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }

function applySettings() {
  const s = state.settings || {};
  document.documentElement.style.setProperty('--accent', s.accent || '#66c0f4');
  document.documentElement.style.setProperty('--accent-2', s.accent2 || shade(s.accent || '#66c0f4', -0.2));
  el('bg').style.backgroundImage = s.background ? `url("${s.background}")` : 'none';
}
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  r = Math.max(0, Math.min(255, r + r * amt));
  g = Math.max(0, Math.min(255, g + g * amt));
  b = Math.max(0, Math.min(255, b + b * amt));
  return '#' + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
}

function heroImageFor(g) {
  if (g.type === 'steam' && g.appid) return `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.appid}/library_hero.jpg`;
  return g.cover || '';
}
function logoImageFor(g) {
  if (g.type === 'steam' && g.appid) return `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.appid}/logo.png`;
  return '';
}
function coverHtml(g) {
  if (g.cover) return `<img src="${escapeAttr(g.cover)}" data-n="${escapeAttr(g.name)}" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'fallback',textContent:this.dataset.n}))" />`;
  return `<div class="fallback">${escapeHtml(g.name)}</div>`;
}

function cardHtml(g, i) {
  return `<div class="card ${g.id === selectedId ? 'selected' : ''}" data-id="${g.id}" style="animation-delay:${Math.min(i * 22, 360)}ms">
    <span class="badge">${g.type}</span>
    ${runningIds().includes(g.id) ? '<span class="running-dot"></span>' : ''}
    <button class="fav-star ${g.favorite ? 'on' : ''}" data-fav="${g.id}" title="Favorite">${g.favorite ? '★' : '☆'}</button>
    ${coverHtml(g)}
    <div class="cap">${escapeHtml(g.name)}</div>
  </div>`;
}
function wireCards(root) {
  root.querySelectorAll('.card').forEach((c) => {
    c.onclick = (e) => { if (e.target.closest('.fav-star')) return; openDetail(c.dataset.id); };
  });
  root.querySelectorAll('.fav-star').forEach((b) => {
    b.onclick = async (e) => { e.stopPropagation(); await V.toggleFavorite(b.dataset.fav); await refresh(); };
  });
}

const sortedGames = () => [...state.games].sort((a, b) =>
  (b.favorite - a.favorite) || (b.lastPlayed || 0) - (a.lastPlayed || 0) || a.name.localeCompare(b.name));

// ---------- views ----------
function switchView(v) {
  currentView = v;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === v));
  document.querySelectorAll('main .view').forEach((s) => s.classList.toggle('hidden', s.id !== v));
  if (v === 'home') renderHome();
  if (v === 'library') renderLibrary();
  if (v === 'stats') window.Stats.render(state.games, state.sessions);
  if (v === 'achievements') renderAchievements();
}

let achCache = [];
async function renderAchievements() {
  const res = await V.getAchievements();
  achCache = res.list;
  el('ach-count').textContent = `(${res.unlockedCount}/${res.total})`;
  const order = { progress: 0, locked: 1, done: 2 };
  const withState = res.list.map((a) => ({
    ...a,
    _s: a.unlocked ? 'done' : (a.progress > 0 ? 'progress' : 'locked'),
  })).sort((a, b) => order[a._s] - order[b._s] || (b.progress / b.goal) - (a.progress / a.goal));
  el('ach-list').innerHTML = withState.map(achCardHtml).join('');
  V.markAchievementsSeen();
}
function achCardHtml(a) {
  const pct = Math.min(100, Math.round((a.progress / a.goal) * 100));
  const done = !!a.unlocked;
  return `<div class="ach-card ${done ? 'done' : ''} ${a._s === 'locked' ? 'locked' : ''}">
    <div class="ach-icon">${done ? a.icon : '🔒'}</div>
    <div class="ach-body">
      <div class="ach-name">${escapeHtml(a.name)}</div>
      <div class="ach-desc">${escapeHtml(a.desc)}</div>
      ${done
        ? `<div class="ach-when">Unlocked ${fmtLast(a.unlocked)}</div>`
        : `<div class="ach-bar"><span style="width:${pct}%"></span></div><div class="ach-prog">${a.progress} / ${a.goal}</div>`}
    </div>
  </div>`;
}

function renderHome() {
  const games = sortedGames();
  el('home-empty').classList.toggle('hidden', games.length > 0);
  el('home-count').textContent = games.length ? `(${games.length})` : '';

  const featured = games[0];
  const hero = el('home-hero');
  if (featured) {
    hero.classList.remove('hidden');
    const bg = heroImageFor(featured);
    setBg(el('hh-bg'), bg, featured.cover);
    const logo = logoImageFor(featured);
    el('hh-name').textContent = featured.name;
    el('hh-name').classList.remove('hidden');
    el('hh-logo').classList.add('hidden');
    if (logo) tryImg(logo, () => { el('hh-logo').src = logo; el('hh-logo').classList.remove('hidden'); el('hh-name').classList.add('hidden'); });
    el('hh-meta').textContent = `${featured.type} · ${fmtPlaytime(combinedMin(featured))} · ${fmtLast(featured.lastPlayed)}`;
    el('hh-play').onclick = () => launch(featured.id);
  } else hero.classList.add('hidden');

  const recent = games.slice(0, 12);
  el('home-recent').innerHTML = recent.map((g) => `
    <div class="rail-item card" data-id="${g.id}">
      ${runningIds().includes(g.id) ? '<span class="running-dot"></span>' : ''}
      ${coverHtml(g)}<div class="cap">${escapeHtml(g.name)}</div>
    </div>`).join('');
  wireCards(el('home-recent'));

  el('home-grid').innerHTML = games.map((g, i) => cardHtml(g, i)).join('');
  wireCards(el('home-grid'));
}

function renderLibrary() {
  const q = el('search').value.toLowerCase().trim();
  const games = sortedGames().filter((g) => !q || g.name.toLowerCase().includes(q));
  el('empty').classList.toggle('hidden', games.length > 0);
  el('grid').innerHTML = games.map((g, i) => cardHtml(g, i)).join('');
  wireCards(el('grid'));
}

function setBg(node, url, fallback) {
  if (!url) { if (fallback) node.style.backgroundImage = `url("${fallback}")`; return; }
  tryImg(url, () => (node.style.backgroundImage = `url("${url}")`), () => { if (fallback) node.style.backgroundImage = `url("${fallback}")`; });
}
function tryImg(src, onOk, onErr) {
  const im = new Image();
  im.onload = onOk; im.onerror = onErr || (() => {});
  im.src = src;
}

// ---------- detail ----------
async function openDetail(id) {
  selectedId = id;
  const g = state.games.find((x) => x.id === id);
  if (!g) return;
  const d = el('detail');
  d.classList.remove('hidden', 'closing');
  d.style.removeProperty('--accent');
  d.style.removeProperty('--accent-2');

  el('d-hero-bg').style.backgroundImage = '';
  if (g.background) {
    setBg(el('d-hero-bg'), g.background, g.cover);
    el('bg').style.backgroundImage = `url("${g.background}")`;   // also theme the app while open
  } else {
    setBg(el('d-hero-bg'), heroImageFor(g), g.cover);
  }

  const logo = logoImageFor(g);
  el('d-name').textContent = g.name;
  el('d-name').classList.remove('hidden');
  el('d-logo').classList.add('hidden');
  if (logo) tryImg(logo, () => { el('d-logo').src = logo; el('d-logo').classList.remove('hidden'); el('d-name').classList.add('hidden'); });

  el('d-fav').textContent = g.favorite ? '★' : '☆';
  el('d-fav').classList.toggle('on', !!g.favorite);
  el('d-last').textContent = fmtLast(g.lastPlayed);
  el('d-playtime').textContent = fmtPlaytime(combinedMin(g));
  el('d-playtime').title = g.type === 'steam'
    ? `${fmtPlaytime(g.steamPlaytimeMinutes)} on Steam + ${fmtPlaytime(g.playtimeMinutes)} tracked here`
    : `${fmtPlaytime(g.playtimeMinutes)} tracked here`;
  el('d-launches').textContent = g.launchCount || 0;
  el('d-type').textContent = g.type === 'steam' ? 'Steam' : g.type === 'epic' ? 'Epic' : 'Executable';
  el('d-desc').textContent = g.description || 'No description yet. Hit "AI describe" to generate one locally with Ollama.';
  el('d-desc').classList.toggle('empty', !g.description);
  el('d-image').value = g.imageName || '';
  el('d-cover').src = g.cover || '';
  el('d-path').textContent = g.exePath || g.installDir || (g.type === 'steam' ? `steam://rungameid/${g.appid}` : g.launchUrl || '');
  el('d-spark').innerHTML = window.Stats.sparkline(g.id, state.sessions);
  el('d-sessions').innerHTML = window.Stats.sessionsList(g.id, state.sessions);
  renderDetailAchievements(g.id);
  renderSteamAchievements(g);
  el('d-storepage').style.display = g.type === 'exe' ? 'none' : '';

  const running = runningIds().includes(id);
  el('d-play-label').textContent = running ? 'Running…' : 'Play';
  el('d-play').disabled = running;
  el('d-stop').classList.toggle('hidden', !running);

  // dynamic accent from cover art
  if (state.settings.dynamicAccent && g.cover) {
    window.dominantColor(g.cover).then((c) => {
      if (c && selectedId === id) {
        d.style.setProperty('--accent', c.accent);
        d.style.setProperty('--accent-2', c.accent2);
      }
    });
  }
  syncActiveCards();
}

async function renderDetailAchievements(gameId) {
  const box = el('d-ach');
  const res = await V.getAchievements();
  const mine = res.list.filter((a) => a.gameId === gameId);
  const done = mine.filter((a) => a.unlocked).length;
  el('d-ach-count').textContent = mine.length ? `(${done}/${mine.length})` : '';
  box.innerHTML = mine.map((a) => {
    const pct = Math.min(100, Math.round((a.progress / a.goal) * 100));
    return `<div class="ach-chip ${a.unlocked ? 'done' : ''}">
      <span class="c-ico">${a.unlocked ? a.icon : '🔒'}</span>
      <span class="c-name">${escapeHtml(a.name.replace(/^.*?:\s*/, ''))}</span>
      <span class="c-bar"><span style="width:${pct}%"></span></span>
    </div>`;
  }).join('') || '<p class="hint">No achievements for this game.</p>';
}

function closeDetail() {
  const d = el('detail');
  d.classList.add('closing');
  setTimeout(() => { d.classList.add('hidden'); d.classList.remove('closing'); }, 220);
  selectedId = null;
  applySettings(); // restore the global background
  syncActiveCards();
}
function syncActiveCards() {
  document.querySelectorAll('.card').forEach((c) => c.classList.toggle('selected', c.dataset.id === selectedId));
}
window.gotoGame = (id) => { switchView('home'); openDetail(id); };

async function launch(id) {
  const r = await V.launchGame(id);
  if (!r.ok) return toast('Launch failed: ' + r.error);
  toast('Launching…');
  if (!runningIds().includes(id)) state.running.push({ id, startedAt: Date.now() });
  showNowPlaying();
  if (selectedId === id) openDetail(id);
}

async function refresh() {
  state = await V.getState();
  applySettings();
  if (currentView === 'home') renderHome();
  else if (currentView === 'library') renderLibrary();
  else if (currentView === 'stats') window.Stats.render(state.games, state.sessions);
  if (selectedId && !el('detail').classList.contains('hidden')) openDetail(selectedId);
  showNowPlaying();
}

// ---------- now playing ----------
function showNowPlaying() {
  const np = el('now-playing');
  const run = state.running[0];
  if (!run) {
    np.classList.add('hidden');
    if (npTimer) { clearInterval(npTimer); npTimer = null; }
    return;
  }
  const g = state.games.find((x) => x.id === run.id);
  if (!g) return;
  np.classList.remove('hidden');
  el('np-cover').src = g.cover || '';
  el('np-name').textContent = g.name;
  el('np-stop').onclick = async () => { await V.stopTracking(run.id); toast('Stopped tracking'); await refresh(); };
  const tick = () => {
    const secs = Math.floor((Date.now() - run.startedAt) / 1000);
    const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
    el('np-timer').textContent = (h ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  };
  tick();
  if (npTimer) clearInterval(npTimer);
  npTimer = setInterval(tick, 1000);
}

// ---------- wire: detail ----------
el('d-back').onclick = closeDetail;
el('d-fav').onclick = async () => { await V.toggleFavorite(selectedId); await refresh(); };
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const m = [...document.querySelectorAll('.modal')].find((x) => !x.classList.contains('hidden'));
    if (m) m.classList.add('hidden');
    else if (!el('detail').classList.contains('hidden')) closeDetail();
  }
});
el('d-play').onclick = () => launch(selectedId);
el('d-stop').onclick = async () => { await V.stopTracking(selectedId); toast('Stopped tracking'); await refresh(); };
el('d-save').onclick = async () => {
  await V.updateGame({ id: selectedId, imageName: el('d-image').value.trim() });
  toast('Saved'); await refresh();
};
el('d-remove').onclick = async () => {
  if (!confirm('Remove this game from Vaultix?')) return;
  await V.removeGame(selectedId); closeDetail(); await refresh();
};
el('d-folder').onclick = async () => { if (!await V.openFolder(selectedId)) toast('Folder not found'); };
el('d-storepage').onclick = () => V.openStorePage(selectedId);
el('d-uninstall').onclick = async () => { if (confirm('Open the uninstaller for this game?')) V.uninstallGame(selectedId); };
el('d-ai').onclick = async () => {
  const g = state.games.find((x) => x.id === selectedId);
  if (!g) return;
  const btn = el('d-ai');
  btn.classList.add('loading'); btn.disabled = true;
  const r = await V.aiDescribe(g.name, selectedId);
  btn.classList.remove('loading'); btn.disabled = false;
  if (!r.ok) return toast('AI: ' + r.error, 4000);
  await refresh();
  toast(r.stub ? 'Ollama not reachable — see Settings' : `Generated with ${r.model || 'Ollama'}`, r.stub ? 4000 : 2600);
};
el('d-cover-btn').onclick = async () => {
  const p = await V.pickFile({ images: true });
  if (!p) return;
  const url = await V.importCover(p);
  if (url) { await V.updateGame({ id: selectedId, cover: url }); await refresh(); }
};
el('d-bg-btn').onclick = async () => {
  const p = await V.pickFile({ images: true });
  if (!p) return;
  const url = await V.importCover(p);
  if (url) { await V.updateGame({ id: selectedId, background: url }); await refresh(); toast('Background set'); }
};
el('d-bg-clear').onclick = async () => { await V.updateGame({ id: selectedId, background: '' }); await refresh(); toast('Background cleared'); };

// ---------- wire: tabs / search ----------
document.querySelectorAll('.tab').forEach((t) => t.onclick = () => switchView(t.dataset.view));
el('search').oninput = () => { if (el('search').value.trim() && currentView !== 'library') switchView('library'); else renderLibrary(); };

// ---------- wire: add game ----------
el('btn-add').onclick = () => el('modal-add').classList.remove('hidden');
el('a-cancel').onclick = () => el('modal-add').classList.add('hidden');
el('a-pick').onclick = async () => {
  const p = await V.pickFile();
  if (!p) return;
  el('a-exe').value = p;
  if (!el('a-name').value) el('a-name').value = p.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
};
el('a-confirm').onclick = async () => {
  const exePath = el('a-exe').value;
  if (!exePath) return toast('Pick an executable first');
  const entry = await V.addExeGame({ name: el('a-name').value, exePath, args: el('a-args').value });
  el('modal-add').classList.add('hidden');
  el('a-exe').value = el('a-name').value = el('a-args').value = '';
  await refresh();
  if (entry && entry.id) { openDetail(entry.id); if (el('a-ai').checked) el('d-ai').click(); }
};

// ---------- wire: scan libraries ----------
el('btn-scan').onclick = async () => {
  el('modal-scan').classList.remove('hidden');
  el('scan-status').textContent = 'Scanning Steam and Epic…';
  el('scan-list').innerHTML = '';
  const res = await V.scanLibraries();
  const seen = new Set();
  scanCandidates = [...(res.newSteam || []), ...(res.newEpic || [])]
    .filter((g) => { const k = g.type + ':' + g.appid; if (seen.has(k)) return false; seen.add(k); return true; });
  if (!scanCandidates.length) {
    el('scan-status').textContent = (res.errors && res.errors.length ? res.errors.join(' · ') + ' — ' : '') + 'No new games found.';
    return;
  }
  el('scan-status').textContent = `Found ${scanCandidates.length} new game(s)`;
  el('scan-list').innerHTML = scanCandidates.map((g, i) => `
    <label class="steam-row">
      <input type="checkbox" data-i="${i}" checked />
      <img src="${escapeAttr(g.cover || g.headerImage || '')}" onerror="this.style.visibility='hidden'" />
      <span class="n">${escapeHtml(g.name)}<br><small>${g.type.toUpperCase()} · ${escapeHtml(String(g.appid))}</small></span>
    </label>`).join('');
};
el('scan-cancel').onclick = () => el('modal-scan').classList.add('hidden');
el('scan-all').onclick = () => el('scan-list').querySelectorAll('input').forEach((c) => (c.checked = true));
el('scan-confirm').onclick = async () => {
  const btn = el('scan-confirm');
  if (btn.disabled) return;
  const picked = [...el('scan-list').querySelectorAll('input:checked')].map((c) => scanCandidates[+c.dataset.i]);
  if (!picked.length) return toast('Nothing selected');
  btn.disabled = true;
  const r = await V.addGames(picked);
  btn.disabled = false;
  el('modal-scan').classList.add('hidden');
  await refresh();
  toast(`Added ${r.added.length} game(s)` + (r.skipped ? ` · ${r.skipped} already in library` : ''));
};

// ---------- wire: stats ----------
el('stats-sync').onclick = async () => {
  const r = await V.syncSteamPlaytime();
  if (r.ok) { toast(`Synced ${r.updated} Steam game(s)`); await refresh(); window.Stats.render(state.games, state.sessions); }
  else toast('Sync failed: ' + r.error);
};

// ---------- wire: settings ----------
el('btn-settings').onclick = async () => {
  const s = state.settings;
  el('set-bg').value = s.background || '';
  el('set-accent').value = s.accent || '#66c0f4';
  el('set-dynaccent').checked = s.dynamicAccent !== false;
  el('set-overlay').checked = s.overlayEnabled !== false;
  el('set-hotkey').value = s.hotkey || 'CommandOrControl+Shift+V';
  el('set-autostart').checked = s.autoStart !== false;
  el('set-tray').checked = s.minimizeToTray !== false;
  el('set-minplay').checked = s.minimizeOnPlay !== false;
  el('set-steamkey').value = s.steamApiKey || '';
  el('set-steamid').value = s.steamId || '';
  el('set-ollamaurl').value = s.ollamaUrl || 'http://localhost:11434';
  el('set-ollamamodel').value = s.ollamaModel || 'qwen2.5:3b';
  el('modal-settings').classList.remove('hidden');
  const st = el('set-ai-status');
  st.textContent = 'Checking Ollama…';
  const r = await V.aiModels();
  if (r.ok) {
    el('ollama-models').innerHTML = r.models.map((m) => `<option value="${escapeAttr(m)}">`).join('');
    st.textContent = `Ollama online · ${r.models.length} model(s). Descriptions run 100% locally.`;
  } else {
    st.textContent = 'Ollama not reachable. Install from ollama.com, then `ollama pull qwen2.5:3b`.';
  }
};
el('set-cancel').onclick = () => el('modal-settings').classList.add('hidden');
el('set-bg-pick').onclick = async () => {
  const p = await V.pickFile({ images: true });
  if (!p) return;
  el('set-bg').value = (await V.importCover(p)) || '';
};
el('set-bg-clear').onclick = () => (el('set-bg').value = '');
el('set-overlay-test').onclick = () => V.testOverlay();
el('set-steam-link').onclick = () => { window.open('https://steamcommunity.com/dev/apikey', '_blank'); };
el('set-steamid-detect').onclick = async () => {
  const id = await V.detectSteamId();
  if (id) { el('set-steamid').value = id; toast('Detected Steam ID: ' + id); }
  else toast('Could not detect Steam ID');
};
el('set-export').onclick = async () => { const r = await V.exportLibrary(); if (r.ok) toast('Exported to ' + r.path); };
el('set-import').onclick = async () => {
  const r = await V.importLibrary();
  if (r.ok) { toast(`Imported · ${r.merged} new game(s)`); await refresh(); }
  else if (r.error) toast('Import failed: ' + r.error);
};
el('set-save').onclick = async () => {
  state.settings = await V.saveSettings({
    background: el('set-bg').value,
    accent: el('set-accent').value,
    dynamicAccent: el('set-dynaccent').checked,
    overlayEnabled: el('set-overlay').checked,
    hotkey: el('set-hotkey').value.trim() || 'CommandOrControl+Shift+V',
    autoStart: el('set-autostart').checked,
    minimizeToTray: el('set-tray').checked,
    minimizeOnPlay: el('set-minplay').checked,
    steamApiKey: el('set-steamkey').value.trim(),
    steamId: el('set-steamid').value.trim(),
    ollamaUrl: el('set-ollamaurl').value.trim() || 'http://localhost:11434',
    ollamaModel: el('set-ollamamodel').value.trim() || 'qwen2.5:3b',
  });
  el('modal-settings').classList.add('hidden');
  applySettings();
  toast('Settings saved');
};

// ---------- gamepad nav hooks ----------
window.vaultixNav = {
  back: () => {
    const m = [...document.querySelectorAll('.modal')].find((x) => !x.classList.contains('hidden'));
    if (m) return m.classList.add('hidden');
    if (!el('detail').classList.contains('hidden')) return closeDetail();
  },
  menu: () => el('btn-settings').click(),
  section: (dir) => {
    const order = ['home', 'library', 'stats'];
    const i = order.indexOf(currentView);
    switchView(order[(i + dir + order.length) % order.length]);
    if (window.vaultixGamepad) setTimeout(window.vaultixGamepad.refocus, 60);
  },
};

// ---------- events ----------
V.on('session-started', ({ gameId, startedAt }) => {
  if (!runningIds().includes(gameId)) state.running.push({ id: gameId, startedAt });
  showNowPlaying();
  if (currentView === 'home') renderHome(); else renderLibrary();
});
V.on('session-ended', (info) => {
  state.running = state.running.filter((r) => r.id !== info.gameId);
  toast(`${info.name || 'Session'} — +${info.minutes} min · ${fmtPlaytime(info.totalMinutes)} total`, 5000);
  refresh();
});
V.on('achievement-unlocked', (a) => {
  showAchievementBanner(a);
});
V.on('achievements-changed', () => {
  if (currentView === 'achievements') renderAchievements();
  if (selectedId && !el('detail').classList.contains('hidden')) renderDetailAchievements(selectedId);
});

// ---------- auto-update ----------
let pendingUpdate = null;
V.on('update-status', (info) => {
  if (info.status === 'downloading') {
    toast(`Downloading update v${info.version}...`, 4000);
  } else if (info.status === 'ready') {
    pendingUpdate = info.version;
    el('update-btn').classList.remove('hidden');
    el('update-btn').textContent = `Update to v${info.version}`;
    toast(`Update v${info.version} ready — click Update to install`, 6000);
  }
});
el('update-btn').onclick = async () => {
  if (!confirm('Install update and restart Vaultix?')) return;
  await V.installUpdate();
};
(async () => {
  try {
    const ver = await V.getVersion();
    if (ver) el('app-version').textContent = `v${ver}`;
  } catch (e) {}
})();

function showAchievementBanner(a) {
  const b = document.createElement('div');
  b.className = 'ach-banner';
  b.innerHTML = `<div class="ab-ico">${a.icon || '🏆'}</div><div><div class="ab-k">Achievement Unlocked</div><div class="ab-n">${escapeHtml(a.name)}</div></div>`;
  document.body.appendChild(b);
  setTimeout(() => b.classList.add('show'), 20);
  setTimeout(() => { b.classList.remove('show'); setTimeout(() => b.remove(), 500); }, 4500);
}

// ---------- Steam achievements ----------
async function renderSteamAchievements(g) {
  const section = el('d-steam-ach-section');
  if (!g || g.type !== 'steam') { section.style.display = 'none'; return; }
  section.style.display = '';
  const box = el('d-steam-ach');

  if (g.steamAchievements && g.steamAchievementsTotal) {
    el('d-steam-ach-count').textContent = `(${g.steamAchievementsUnlocked || 0}/${g.steamAchievementsTotal})`;
    box.innerHTML = `<p class="hint">${g.steamAchievementsUnlocked || 0} of ${g.steamAchievementsTotal} unlocked. Click Refresh to update.</p>`;
  } else {
    el('d-steam-ach-count').textContent = '';
    box.innerHTML = '<p class="hint">Set your Steam API key in Settings to see real achievements.</p>';
  }
}

async function fetchAndShowSteamAch(gameId) {
  const box = el('d-steam-ach');
  box.innerHTML = '<p class="hint">Loading…</p>';
  const res = await V.getSteamAchievements(gameId);
  if (!res.ok) { box.innerHTML = `<p class="hint">${escapeHtml(res.error)}</p>`; return; }
  const done = res.list.filter((a) => a.achieved);
  el('d-steam-ach-count').textContent = `(${done.length}/${res.list.length})`;
  const sorted = [...res.list].sort((a, b) => (b.achieved - a.achieved) || ((b.unlockTime || 0) - (a.unlockTime || 0)));
  box.innerHTML = sorted.slice(0, 40).map((a) => `
    <div class="ach-chip ${a.achieved ? 'done' : ''}">
      <span class="c-ico">${a.achieved ? '<img src="' + escapeAttr(a.icon || '') + '" width="20" height="20" style="border-radius:3px" onerror="this.textContent=\'🏆\'" />' : '🔒'}</span>
      <span class="c-name" title="${escapeAttr(a.description)}">${escapeHtml(a.displayName)}</span>
      <span class="c-bar"><span style="width:${a.achieved ? '100' : '0'}%"></span></span>
    </div>`).join('') + (res.list.length > 40 ? `<p class="hint">…and ${res.list.length - 40} more</p>` : '');
  await refresh();
}

el('d-steam-ach-refresh').onclick = () => { if (selectedId) fetchAndShowSteamAch(selectedId); };

// ---------- splash screen ----------
function dismissSplash() {
  const sp = el('splash');
  if (!sp) return;
  sp.classList.add('out');
  setTimeout(() => sp.remove(), 600);
}

switchView('home');
refresh().then(() => setTimeout(dismissSplash, 600));
