const fs = require('fs');
const path = require('path');

// Locate the Steam install dir from the registry (via env fallback).
function findSteamRoot() {
  const candidates = [
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Steam'),
    process.env['ProgramFiles'] && path.join(process.env['ProgramFiles'], 'Steam'),
    'C:\\Program Files (x86)\\Steam',
    'C:\\Steam',
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'steam.exe'))) return c;
  }
  try {
    const { execSync } = require('child_process');
    const out = execSync('reg query "HKCU\\Software\\Valve\\Steam" /v SteamPath', { encoding: 'utf8' });
    const m = out.match(/SteamPath\s+REG_SZ\s+(.+)/i);
    if (m) {
      const p = normPath(m[1].trim());
      if (fs.existsSync(p)) return p;
    }
  } catch (e) { /* ignore */ }
  return null;
}

// Steam writes paths with forward slashes and doubled backslashes; normalise to native.
function normPath(p) {
  return path.normalize(String(p).replace(/\\\\/g, '\\').replace(/\//g, '\\'));
}

function parseLibraryFolders(vdfText) {
  const paths = [];
  const re = /"path"\s+"([^"]+)"/g;
  let m;
  while ((m = re.exec(vdfText))) paths.push(normPath(m[1]));
  return paths;
}

function parseAppManifest(text) {
  const get = (k) => {
    const m = text.match(new RegExp('"' + k + '"\\s+"([^"]*)"'));
    return m ? m[1] : null;
  };
  return { appid: get('appid'), name: get('name'), installdir: get('installdir') };
}

function scanSteamGames() {
  const root = findSteamRoot();
  if (!root) return { error: 'Steam install not found', games: [] };

  // dedupe library dirs case-insensitively (Windows FS is case-insensitive)
  const libMap = new Map();
  const addLib = (p) => { const n = normPath(p); libMap.set(n.toLowerCase(), n); };
  addLib(path.join(root, 'steamapps'));

  const lfPath = path.join(root, 'steamapps', 'libraryfolders.vdf');
  if (fs.existsSync(lfPath)) {
    try {
      for (const p of parseLibraryFolders(fs.readFileSync(lfPath, 'utf8'))) {
        addLib(path.join(p, 'steamapps'));
      }
    } catch (e) { /* ignore */ }
  }

  const playtime = readSteamPlaytime(root);
  const byAppid = new Map();

  for (const lib of libMap.values()) {
    let entries = [];
    try { entries = fs.readdirSync(lib); } catch (e) { continue; }
    for (const f of entries) {
      if (!/^appmanifest_\d+\.acf$/.test(f)) continue;
      try {
        const man = parseAppManifest(fs.readFileSync(path.join(lib, f), 'utf8'));
        if (!man.appid || !man.name) continue;
        if (man.name === 'Steamworks Common Redistributables') continue;
        if (byAppid.has(man.appid)) continue; // <-- dedupe across libraries
        const iconLocal = path.join(root, 'appcache', 'librarycache', man.appid + '_library_600x900.jpg');
        byAppid.set(man.appid, {
          type: 'steam',
          appid: man.appid,
          name: man.name,
          installDir: path.join(lib, 'common', man.installdir || ''),
          cover: fs.existsSync(iconLocal) ? 'file://' + iconLocal.replace(/\\/g, '/') : '',
          headerImage: 'https://cdn.cloudflare.steamstatic.com/steam/apps/' + man.appid + '/library_600x900.jpg',
          steamPlaytimeMinutes: playtime[man.appid] ? playtime[man.appid].minutes : 0,
          lastPlayed: playtime[man.appid] ? playtime[man.appid].lastPlayed : null,
        });
      } catch (e) { /* skip */ }
    }
  }

  return { steamRoot: root, games: [...byAppid.values()] };
}

// Read real playtime from every userdata/<id>/config/localconfig.vdf
function readSteamPlaytime(root) {
  const out = {};
  const userdata = path.join(root, 'userdata');
  let ids = [];
  try { ids = fs.readdirSync(userdata); } catch (e) { return out; }

  for (const id of ids) {
    const cfg = path.join(userdata, id, 'config', 'localconfig.vdf');
    let text;
    try { text = fs.readFileSync(cfg, 'utf8'); } catch (e) { continue; }

    // find the "apps" block inside Software/Valve/Steam
    const appsIdx = text.search(/"apps"\s*\{/i);
    if (appsIdx === -1) continue;
    const region = text.slice(appsIdx, appsIdx + 400000);

    // each app: "<appid>" { ... "Playtime" "N" ... "LastPlayed" "unix" ... }
    const re = /"(\d+)"\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g;
    let m;
    while ((m = re.exec(region))) {
      const appid = m[1];
      const body = m[2];
      const pt = body.match(/"Playtime"\s+"(\d+)"/i);
      const lp = body.match(/"LastPlayed"\s+"(\d+)"/i);
      if (!pt && !lp) continue;
      const minutes = pt ? parseInt(pt[1], 10) : 0;
      const lastPlayed = lp ? parseInt(lp[1], 10) * 1000 : null;
      const prev = out[appid];
      if (!prev || minutes > prev.minutes || (lastPlayed || 0) > (prev.lastPlayed || 0)) {
        out[appid] = {
          minutes: Math.max(minutes, prev ? prev.minutes : 0),
          lastPlayed: Math.max(lastPlayed || 0, prev ? prev.lastPlayed || 0 : 0) || null,
        };
      }
    }
  }
  return out;
}

module.exports = { scanSteamGames, findSteamRoot, readSteamPlaytime };
