# Vaultix

Custom game launcher for `.exe`, Steam, and Epic games. Electron app, builds to a single portable `Vaultix.exe`.

## Features

### Library
- **Add .exe games** — browse to any executable, set name + launch args + custom cover.
- **Scan libraries** — one button scans **Steam** (`libraryfolders.vdf` + `appmanifest_*.acf`, multi-drive safe, deduped by AppID) and **Epic** (`…\Epic\EpicGamesLauncher\Data\Manifests\*.item`). Combined pick-list, already-added games filtered out.
- **Favorites** — star any game; starred games lead the home row.
- **Per-game background** — "Set background" on the detail page; that image replaces the Steam hero art *and* themes the whole app while the game is open.

### Achievements
- Vaultix tracks its own meta-achievements — global ("Open Vaultix 15 times", "Track 50 hours", "Night Owl", "Variety Player"…) and per-game auto-generated ("Play <game> for 1/5/10/25 hours", "Launch <game> 10 times"). Steam-imported playtime counts.
- **Achievements tab** — progress bars, unlock dates, in-progress first. Per-game list also shown on the detail page.
- **In-game overlay** — when an achievement unlocks, a PlayStation-style pop-up slides in from the top over your game (transparent, click-through, always-on-top window). Works with borderless/windowed-fullscreen games. Toggle + "Preview overlay" in Settings.

### Home (Big Picture style)
- Featured hero banner for the most-recently-played game, "Jump back in" carousel, full grid below.
- **Stats view** — activity heatmap (last 26 weeks), most-played bar chart, this-week / this-month / all-time / day-streak totals. Per-game 30-day sparkline + session list on the detail page.

### Playtime
- Every session is recorded (`sessions[]` in the store). `.exe`/Epic games are process-watched; Steam games use a process name you set or manual "Stop tracking".
- **Import real Steam playtime** — reads `userdata\<id>\config\localconfig.vdf`, so Steam totals show up immediately. "Sync Steam playtime" button in the Stats view. Detail page shows the split (`30.1 hrs on Steam + 1.1 hrs tracked here`).

### AI describe (local)
- Per-game "✨ AI describe" runs a local **Ollama** model (default `qwen2.5:3b`), 100% offline. Returns description + genre + year + developer. Editable placeholder if Ollama is down.

### Polish
- **Live "Now Playing" dock** with a running timer; Vaultix minimizes to tray on launch and pops back with a "+X min" summary on exit.
- **Dynamic accent** — the detail page recolors to the game's cover art (toggle in Settings).
- **Gamepad navigation** — plug in a controller: the UI enters big-picture mode with a button-hint bar; D-pad/stick moves a focus ring, A launches, B backs out, LB/RB switch sections, Start opens Settings.
- **Global hotkey** `Ctrl+Shift+V` toggles the window (rebindable). **Start with Windows** (hidden in tray) — on by default.
- **Library backup** — Export / Import the whole library + settings + sessions as JSON (Settings).
- Custom background + accent color; smooth animations throughout (respects `prefers-reduced-motion`).

## Run from source
```
npm install
npm start
```

## Build the portable exe
```
npm run dist
```
Output: `dist/Vaultix.exe` (~69 MB, self-contained).

## Data
- **Always** `%APPDATA%\Vaultix\vaultix.json` (covers in `%APPDATA%\Vaultix\covers`), for both dev and portable builds — so **replacing `Vaultix.exe` never touches your data**.
- Older portable builds kept data in `VaultixData\` next to the exe; that's migrated automatically the first time the new build runs.
- Writes are atomic (temp file + rename) so a crash mid-save can't corrupt the store.
- Schema v3; v1/v2 files migrate automatically on load. `vaultix.backup-*.json` is written before a library import.

## AI setup (Ollama)
1. Install Ollama from https://ollama.com
2. `ollama pull qwen2.5:3b`
3. `ollama serve` running (usually auto-starts). Vaultix talks to `http://localhost:11434` — no API key, no internet.

## Project layout
- `electron/` — `main.js` (window, overlay window, tray, hotkey, IPC, playtime watchers), `store.js` (atomic JSON store + migration), `steam.js` (scan + playtime parser), `epic.js` (manifest scan), `ai.js` (Ollama), `achievements.js` (catalog + evaluator).
- `src/` — `index.html`, `styles.css`, `renderer.js` (app), `color.js` (accent extraction), `stats.js` (charts), `gamepad.js` (controller nav), `overlay.html`/`overlay.js` (in-game pop-up). Plain ordered `<script>` tags, no bundler.
- `src/renderer.js` has a browser-preview mock so the UI opens outside Electron; inert in the real app.

## Notes
- No app icon set yet — drop `build/icon.ico` and re-add `"icon": "build/icon.ico"` under `build.win` in `package.json`. (The tray icon is generated at runtime.)
- Epic's manifest `LaunchExecutable` is sometimes a bootstrapper, not the game process — adjust the process name in the detail page if playtime tracking doesn't catch it.
