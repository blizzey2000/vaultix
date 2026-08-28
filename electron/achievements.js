// Vaultix meta-achievements. Pure functions: given the store data, return the
// full list with progress, and detect which ones just unlocked.

const GLOBAL = [
  { id: 'open-5',      icon: '🚪', name: 'Regular',         desc: 'Open Vaultix 5 times',              goal: 5,   metric: (d) => d.appStats.opens },
  { id: 'open-15',     icon: '🔑', name: 'Creature of Habit', desc: 'Open Vaultix 15 times',            goal: 15,  metric: (d) => d.appStats.opens },
  { id: 'open-50',     icon: '🏛️', name: 'Vault Keeper',     desc: 'Open Vaultix 50 times',             goal: 50,  metric: (d) => d.appStats.opens },
  { id: 'library-10',  icon: '📚', name: 'Collector',        desc: 'Add 10 games to your vault',        goal: 10,  metric: (d) => d.games.length },
  { id: 'library-25',  icon: '🗃️', name: 'Hoarder',          desc: 'Add 25 games to your vault',        goal: 25,  metric: (d) => d.games.length },
  { id: 'fav-5',       icon: '⭐', name: 'Playing Favorites', desc: 'Favorite 5 games',                 goal: 5,   metric: (d) => d.games.filter((g) => g.favorite).length },
  { id: 'variety-5',   icon: '🎲', name: 'Variety Player',   desc: 'Play 5 different games',            goal: 5,   metric: (d) => new Set(d.sessions.map((s) => s.gameId)).size },
  { id: 'playtime-10', icon: '⏱️', name: 'Getting Into It',  desc: 'Track 10 hours of playtime',        goal: 600, metric: (d) => totalTracked(d) },
  { id: 'playtime-50', icon: '🔥', name: 'Committed',        desc: 'Track 50 hours of playtime',        goal: 3000, metric: (d) => totalTracked(d) },
  { id: 'playtime-100',icon: '💯', name: 'No Life',          desc: 'Track 100 hours of playtime',       goal: 6000, metric: (d) => totalTracked(d) },
  { id: 'night-owl',   icon: '🦉', name: 'Night Owl',        desc: 'Launch a game between 2 and 5 AM',  goal: 1,   metric: (d) => d.appStats.nightOwl ? 1 : 0 },
  { id: 'ai-1',        icon: '🤖', name: 'Ghostwriter',      desc: 'Generate an AI description',        goal: 1,   metric: (d) => d.appStats.aiDescribes },
  { id: 'marathon',    icon: '🏃', name: 'Marathon',         desc: 'Play for 3 hours in one session',   goal: 180, metric: (d) => Math.max(0, ...d.sessions.map((s) => s.minutes)) },
];

function totalTracked(d) {
  return d.games.reduce((a, g) => a + (g.playtimeMinutes || 0) + (g.steamPlaytimeMinutes || 0), 0);
}
const combined = (g) => (g.playtimeMinutes || 0) + (g.steamPlaytimeMinutes || 0);

// per-game achievement tiers
const PLAY_TIERS = [
  { suffix: 'play-1h', hours: 1, label: '1 hour' },
  { suffix: 'play-5h', hours: 5, label: '5 hours' },
  { suffix: 'play-10h', hours: 10, label: '10 hours' },
  { suffix: 'play-25h', hours: 25, label: '25 hours' },
];

function perGame(d) {
  const list = [];
  for (const g of d.games) {
    for (const t of PLAY_TIERS) {
      list.push({
        id: `${g.id}:${t.suffix}`,
        gameId: g.id,
        icon: '🎮',
        name: `${g.name}: ${t.label}`,
        desc: `Play ${g.name} for ${t.label}`,
        goal: t.hours * 60,
        metric: () => combined(g),
      });
    }
    list.push({
      id: `${g.id}:launch-10`,
      gameId: g.id,
      icon: '🚀',
      name: `${g.name}: Regular`,
      desc: `Launch ${g.name} 10 times`,
      goal: 10,
      metric: () => g.launchCount || 0,
    });
  }
  return list;
}

function catalog(d) { return [...GLOBAL, ...perGame(d)]; }

// Returns { list: [...withProgress], unlocked: [...justUnlocked] }
function evaluate(store) {
  const d = store.raw();
  const state = store.achievements;
  const list = [];
  const justUnlocked = [];

  for (const a of catalog(d)) {
    const cur = Math.min(a.goal, Math.round(a.metric(d)));
    const rec = state[a.id] || { unlocked: null, progress: 0, seen: false };
    rec.progress = cur;
    if (!rec.unlocked && cur >= a.goal) {
      rec.unlocked = Date.now();
      rec.seen = false;
      justUnlocked.push({ id: a.id, icon: a.icon, name: a.name, desc: a.desc });
    }
    state[a.id] = rec;
    list.push({
      id: a.id, icon: a.icon, name: a.name, desc: a.desc, goal: a.goal,
      gameId: a.gameId || null,
      progress: rec.progress, unlocked: rec.unlocked,
    });
  }

  store.achievements = state;
  return { list, unlocked: justUnlocked };
}

module.exports = { evaluate, catalog };
