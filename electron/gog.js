const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

function scanGogGames() {
  const result = { games: [], gogDir: null, error: null };
  try {
    const regOut = require('child_process').execSync(
      'reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\GOG.com\\Games" /s 2>nul',
      { encoding: 'utf8', timeout: 10000 }
    );
    const blocks = regOut.split(/\r?\n\r?\n/).filter(Boolean);
    for (const block of blocks) {
      const get = (key) => {
        const m = block.match(new RegExp(`${key}\\s+REG_SZ\\s+(.+)`, 'i'));
        return m ? m[1].trim() : '';
      };
      const name = get('gameName');
      const gameId = get('gameID');
      const installDir = get('path') || get('INSTALLDIR');
      const exePath = get('LAUNCHCOMMAND') || get('launchCommand');
      if (!name || !gameId) continue;
      if (!result.gogDir && installDir) result.gogDir = path.dirname(installDir);
      result.games.push({
        type: 'gog',
        appid: gameId,
        name,
        installDir: installDir || '',
        exePath: exePath || '',
        imageName: exePath ? path.basename(exePath) : '',
        cover: '',
      });
    }
  } catch (e) {
    result.error = 'GOG Galaxy not found';
  }
  return result;
}

module.exports = { scanGogGames };
