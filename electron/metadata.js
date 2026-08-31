const fs = require('fs');
const path = require('path');

let igdbToken = null;
let igdbTokenExpiry = 0;

async function getIgdbToken(clientId, clientSecret) {
  if (igdbToken && Date.now() < igdbTokenExpiry) return igdbToken;
  const r = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`,
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`Twitch auth failed: ${r.status}`);
  const d = await r.json();
  igdbToken = d.access_token;
  igdbTokenExpiry = Date.now() + (d.expires_in - 60) * 1000;
  return igdbToken;
}

async function igdbSearch(name, clientId, clientSecret) {
  if (!clientId || !clientSecret) return { ok: false, error: 'Twitch Client ID/Secret not set' };
  try {
    const token = await getIgdbToken(clientId, clientSecret);
    const body = `search "${name.replace(/"/g, '\\"')}"; fields name,cover.image_id,screenshots.image_id,first_release_date,summary,genres.name,involved_companies.company.name,involved_companies.developer; limit 5;`;
    const r = await fetch('https://api.igdb.com/v4/games', {
      method: 'POST',
      headers: { 'Client-ID': clientId, Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' },
      body,
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error(`IGDB ${r.status}`);
    const games = await r.json();
    return { ok: true, results: games.map(g => formatIgdbGame(g)) };
  } catch (e) { return { ok: false, error: e.message }; }
}

function igdbImageUrl(imageId, size) {
  return `https://images.igdb.com/igdb/image/upload/t_${size}/${imageId}.jpg`;
}

function formatIgdbGame(g) {
  const devCompany = (g.involved_companies || []).find(c => c.developer);
  return {
    igdbId: g.id,
    name: g.name,
    summary: g.summary || '',
    releaseDate: g.first_release_date ? new Date(g.first_release_date * 1000).toISOString().slice(0, 10) : null,
    genres: (g.genres || []).map(x => x.name),
    developer: devCompany ? devCompany.company.name : null,
    cover: g.cover ? igdbImageUrl(g.cover.image_id, 'cover_big') : null,
    coverHd: g.cover ? igdbImageUrl(g.cover.image_id, '1080p') : null,
    screenshots: (g.screenshots || []).map(s => ({
      thumb: igdbImageUrl(s.image_id, 'screenshot_med'),
      full: igdbImageUrl(s.image_id, 'screenshot_big'),
      hd: igdbImageUrl(s.image_id, '1080p'),
    })),
  };
}

async function sgdbSearch(name, apiKey) {
  if (!apiKey) return { ok: false, error: 'SteamGridDB API key not set' };
  try {
    const r = await fetch(`https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(name)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error(`SteamGridDB search ${r.status}`);
    const d = await r.json();
    return { ok: true, results: (d.data || []).map(g => ({ sgdbId: g.id, name: g.name })) };
  } catch (e) { return { ok: false, error: e.message }; }
}

async function sgdbAssets(sgdbId, type, apiKey) {
  if (!apiKey) return { ok: false, error: 'SteamGridDB API key not set' };
  const validTypes = ['grids', 'heroes', 'logos', 'icons'];
  if (!validTypes.includes(type)) return { ok: false, error: 'Invalid type' };
  try {
    const params = type === 'grids' ? '?dimensions=600x900' : '';
    const r = await fetch(`https://www.steamgriddb.com/api/v2/${type}/game/${sgdbId}${params}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error(`SteamGridDB ${type} ${r.status}`);
    const d = await r.json();
    return {
      ok: true,
      assets: (d.data || []).slice(0, 20).map(a => ({
        id: a.id,
        url: a.url || a.thumb,
        thumb: a.thumb || a.url,
        width: a.width,
        height: a.height,
        style: a.style,
        animated: !!a.url?.endsWith('.webm'),
      })),
    };
  } catch (e) { return { ok: false, error: e.message }; }
}

async function sgdbBySteamAppId(appid, type, apiKey) {
  if (!apiKey) return { ok: false, error: 'SteamGridDB API key not set' };
  const validTypes = ['grids', 'heroes', 'logos', 'icons'];
  if (!validTypes.includes(type)) return { ok: false, error: 'Invalid type' };
  try {
    const params = type === 'grids' ? '?dimensions=600x900' : '';
    const r = await fetch(`https://www.steamgriddb.com/api/v2/${type}/steam/${appid}${params}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error(`SteamGridDB ${type} ${r.status}`);
    const d = await r.json();
    return {
      ok: true,
      assets: (d.data || []).slice(0, 20).map(a => ({
        id: a.id,
        url: a.url || a.thumb,
        thumb: a.thumb || a.url,
        width: a.width,
        height: a.height,
        style: a.style,
      })),
    };
  } catch (e) { return { ok: false, error: e.message }; }
}

async function downloadImage(url, destDir, filename) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`Download failed: ${r.status}`);
    const contentType = r.headers.get('content-type') || '';
    let ext = '.jpg';
    if (contentType.includes('png')) ext = '.png';
    else if (contentType.includes('webp')) ext = '.webp';
    const finalName = filename + ext;
    const dest = path.join(destDir, finalName);
    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(dest, buf);
    return 'file://' + dest.replace(/\\/g, '/');
  } catch (e) { return null; }
}

async function youtubeSearch(query, apiKey) {
  if (!apiKey) return { ok: false, error: 'YouTube API key not set' };
  try {
    const q = encodeURIComponent(query + ' OST soundtrack');
    const r = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${q}&type=video&videoCategoryId=10&maxResults=8&key=${apiKey}`,
      { signal: AbortSignal.timeout(10000) },
    );
    if (!r.ok) throw new Error(`YouTube ${r.status}`);
    const d = await r.json();
    return {
      ok: true,
      videos: (d.items || []).map(v => ({
        id: v.id.videoId,
        title: v.snippet.title,
        channel: v.snippet.channelTitle,
        thumbnail: v.snippet.thumbnails.medium?.url || v.snippet.thumbnails.default?.url,
      })),
    };
  } catch (e) { return { ok: false, error: e.message }; }
}

async function fetchGameMetadata(gameName, settings, coversDir) {
  const results = { igdb: null, sgdb: null };

  if (settings.twitchClientId && settings.twitchClientSecret) {
    const igdb = await igdbSearch(gameName, settings.twitchClientId, settings.twitchClientSecret);
    if (igdb.ok && igdb.results.length > 0) {
      results.igdb = igdb.results[0];
    }
  }

  if (settings.steamGridDbKey) {
    const sgdb = await sgdbSearch(gameName, settings.steamGridDbKey);
    if (sgdb.ok && sgdb.results.length > 0) {
      results.sgdb = sgdb.results[0];
    }
  }

  return results;
}

module.exports = {
  igdbSearch,
  sgdbSearch,
  sgdbAssets,
  sgdbBySteamAppId,
  downloadImage,
  youtubeSearch,
  fetchGameMetadata,
};
