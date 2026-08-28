const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { findSteamRoot } = require('./steam');

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { timeout: 8000 }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on('error', reject).on('timeout', function () { this.destroy(); reject(new Error('timeout')); });
  });
}

function detectSteamId() {
  const root = findSteamRoot();
  if (!root) return null;
  const loginFile = path.join(root, 'config', 'loginusers.vdf');
  let text;
  try { text = fs.readFileSync(loginFile, 'utf8'); } catch (e) { return null; }
  const re = /"(\d{17})"\s*\{([^}]*)\}/g;
  let m, best = null, bestTs = 0;
  while ((m = re.exec(text))) {
    const body = m[2];
    const recent = body.match(/"MostRecent"\s+"1"/i);
    const ts = body.match(/"Timestamp"\s+"(\d+)"/i);
    const timestamp = ts ? parseInt(ts[1], 10) : 0;
    if (recent) return m[1];
    if (timestamp > bestTs) { bestTs = timestamp; best = m[1]; }
  }
  return best;
}

async function fetchAchievementSchema(appid, apiKey) {
  const url = `https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?appid=${appid}&key=${apiKey}`;
  const data = await httpGet(url);
  const stats = data && data.game && data.game.availableGameStats;
  if (!stats || !stats.achievements) return [];
  return stats.achievements.map((a) => ({
    apiName: a.name,
    displayName: a.displayName || a.name,
    description: a.description || '',
    icon: a.icon || '',
    iconGray: a.icongray || '',
  }));
}

async function fetchPlayerAchievements(appid, apiKey, steamId) {
  const url = `https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?appid=${appid}&key=${apiKey}&steamid=${steamId}`;
  const data = await httpGet(url);
  const stats = data && data.playerstats;
  if (!stats || !stats.success || !stats.achievements) return null;
  return stats.achievements.map((a) => ({
    apiName: a.apiname,
    achieved: a.achieved === 1,
    unlockTime: a.unlocktime ? a.unlocktime * 1000 : null,
  }));
}

async function getGameAchievements(appid, apiKey, steamId) {
  try {
    const [schema, player] = await Promise.all([
      fetchAchievementSchema(appid, apiKey),
      fetchPlayerAchievements(appid, apiKey, steamId),
    ]);
    if (!player) return { ok: false, error: 'no data' };
    const schemaMap = new Map(schema.map((a) => [a.apiName, a]));
    const list = player.map((p) => {
      const s = schemaMap.get(p.apiName) || {};
      return {
        apiName: p.apiName,
        displayName: s.displayName || p.apiName,
        description: s.description || '',
        icon: p.achieved ? s.icon : s.iconGray,
        achieved: p.achieved,
        unlockTime: p.unlockTime,
      };
    });
    return { ok: true, list, gameName: '' };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

module.exports = { detectSteamId, getGameAchievements, fetchPlayerAchievements, fetchAchievementSchema };
