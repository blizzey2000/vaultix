// AI game-description lookup via a LOCAL Ollama model (default qwen2.5:3b).
// No API key, no network beyond localhost. Falls back to a stub if Ollama is down.

async function describeGame({ name, ollamaUrl, ollamaModel }) {
  if (!name || !name.trim()) return { ok: false, error: 'no name' };
  const base = (ollamaUrl || 'http://localhost:11434').replace(/\/+$/, '');
  const model = ollamaModel || 'qwen2.5:3b';

  const prompt =
    `You are a video game encyclopedia. For the PC game titled "${name}", ` +
    `reply with ONLY minified JSON, no markdown, in this exact shape:\n` +
    `{"description":"2-3 sentence spoiler-free overview","genre":"primary genre",` +
    `"year":"release year or empty string","developer":"studio or empty string","uncertain":false}\n` +
    `Set "uncertain" to true if you are not confident this game exists. Do not add any text outside the JSON.`;

  let res;
  try {
    res = await fetch(base + '/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        format: 'json',
        options: { temperature: 0.2 },
      }),
    });
  } catch (e) {
    return {
      ok: true,
      stub: true,
      description:
        `${name} — could not reach Ollama at ${base}. Start Ollama (\`ollama serve\`) and ` +
        `pull the model (\`ollama pull ${model}\`), or edit this text yourself.`,
      genre: '', year: '',
    };
  }

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    if (res.status === 404) {
      return { ok: false, error: `Model "${model}" not found. Run: ollama pull ${model}` };
    }
    return { ok: false, error: `Ollama ${res.status}: ${t.slice(0, 200)}` };
  }

  const data = await res.json();
  const raw = (data.response || '').trim();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) { try { parsed = JSON.parse(m[0]); } catch (_) {} }
  }
  if (!parsed) return { ok: true, description: raw, genre: '', year: '' };

  return {
    ok: true,
    model,
    description: parsed.description || '',
    genre: parsed.genre || '',
    year: parsed.year || '',
    developer: parsed.developer || '',
    uncertain: !!parsed.uncertain,
  };
}

async function listModels(ollamaUrl) {
  const base = (ollamaUrl || 'http://localhost:11434').replace(/\/+$/, '');
  try {
    const r = await fetch(base + '/api/tags');
    if (!r.ok) return { ok: false };
    const d = await r.json();
    return { ok: true, models: (d.models || []).map((m) => m.name) };
  } catch (e) {
    return { ok: false };
  }
}

async function findSavePaths({ name, ollamaUrl, ollamaModel }) {
  if (!name || !name.trim()) return { ok: false, error: 'no name' };
  const base = (ollamaUrl || 'http://localhost:11434').replace(/\/+$/, '');
  const model = ollamaModel || 'qwen2.5:3b';

  const prompt =
    `You are a PC gaming expert. For the Windows PC game "${name}", tell me where it stores its save files. ` +
    `Reply with ONLY minified JSON, no markdown, in this exact shape:\n` +
    `{"paths":["C:\\\\Users\\\\%USERNAME%\\\\...","..."],"notes":"brief note about save structure"}\n` +
    `Use %USERNAME%, %APPDATA%, %LOCALAPPDATA%, %USERPROFILE%, %PROGRAMDATA% environment variables where appropriate. ` +
    `Include all known save locations (Steam cloud local cache, registry saves, AppData, Documents, game folder). ` +
    `If unsure, set paths to an empty array. Do not add any text outside the JSON.`;

  let res;
  try {
    res = await fetch(base + '/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false, format: 'json', options: { temperature: 0.2 } }),
    });
  } catch (e) {
    return { ok: false, error: `Cannot reach Ollama at ${base}` };
  }
  if (!res.ok) return { ok: false, error: `Ollama ${res.status}` };

  const data = await res.json();
  const raw = (data.response || '').trim();
  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) { try { parsed = JSON.parse(m[0]); } catch (_) {} }
  }
  if (!parsed || !Array.isArray(parsed.paths)) return { ok: false, error: 'AI returned invalid format' };
  return { ok: true, paths: parsed.paths, notes: parsed.notes || '' };
}

module.exports = { describeGame, listModels, findSavePaths };
