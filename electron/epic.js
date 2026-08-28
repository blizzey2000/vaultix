const fs = require('fs');
const path = require('path');

// Epic Games Launcher writes one JSON manifest per installed game.
function manifestDirs() {
  const dirs = [];
  if (process.env.ProgramData) {
    dirs.push(path.join(process.env.ProgramData, 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests'));
  }
  dirs.push('C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests');
  return [...new Set(dirs)];
}

function scanEpicGames() {
  let dir = null;
  for (const d of manifestDirs()) {
    if (fs.existsSync(d)) { dir = d; break; }
  }
  if (!dir) return { error: 'Epic Games Launcher not found', games: [] };

  const byId = new Map();
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.item')); } catch (e) {
    return { error: 'Cannot read Epic manifests', games: [] };
  }

  for (const f of files) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (!m.DisplayName || !m.AppName) continue;
      if (m.bIsIncompleteInstall) continue;
      // skip DLC / plugins that aren't standalone games
      if (m.AppCategories && !m.AppCategories.includes('games')) continue;
      const installLoc = m.InstallLocation || m.ManifestLocation || '';
      if (installLoc && !fs.existsSync(installLoc)) continue;

      const launchName = m.MainGameAppName || m.AppName;
      const exeRel = m.LaunchExecutable || '';
      const exeFull = exeRel ? path.join(installLoc, exeRel) : '';
      if (byId.has(launchName)) continue;

      byId.set(launchName, {
        type: 'epic',
        appid: launchName, // reuse the appid slot for the launch id
        epicAppName: launchName,
        name: m.DisplayName,
        installDir: installLoc,
        exePath: exeFull,
        imageName: exeRel ? path.basename(exeRel) : '',
        launchUrl: `com.epicgames.launcher://apps/${encodeURIComponent(launchName)}?action=launch&silent=true`,
        cover: '',
        headerImage: '',
      });
    } catch (e) { /* skip bad manifest */ }
  }

  return { epicDir: dir, games: [...byId.values()] };
}

module.exports = { scanEpicGames };
