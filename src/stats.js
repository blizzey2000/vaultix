// Dependency-free playtime visualisations (inline SVG).
(function () {
  const DAY = 86400000;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const dayKey = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
  const fmt = (min) => (min < 60 ? `${Math.round(min)}m` : `${(min / 60).toFixed(1)}h`);

  function totalsHtml(games, sessions) {
    const now = Date.now();
    const wk = sessions.filter((s) => now - s.start < 7 * DAY).reduce((a, s) => a + s.minutes, 0);
    const mo = sessions.filter((s) => now - s.start < 30 * DAY).reduce((a, s) => a + s.minutes, 0);
    const all = games.reduce((a, g) => a + (g.playtimeMinutes || 0) + (g.steamPlaytimeMinutes || 0), 0);
    // streak: consecutive days (ending today or yesterday) with a session
    const days = new Set(sessions.map((s) => dayKey(s.start)));
    let streak = 0;
    for (let i = 0; i < 400; i++) {
      const k = dayKey(now - i * DAY);
      if (days.has(k)) streak++;
      else if (i > 0) break;
    }
    const totalSessions = sessions.length;
    const avgMin = totalSessions ? Math.round(sessions.reduce((a, s) => a + s.minutes, 0) / totalSessions) : 0;
    const longestSession = sessions.length ? Math.max(...sessions.map((s) => s.minutes)) : 0;
    const gamesPlayed = new Set(sessions.map((s) => s.gameId)).size;
    const card = (k, v) => `<div class="stat-card"><span class="k">${k}</span><span class="v">${v}</span></div>`;
    return card('This week', fmt(wk)) + card('This month', fmt(mo)) +
           card('All time', fmt(all)) + card('Day streak', streak) +
           card('Avg session', fmt(avgMin)) + card('Longest session', fmt(longestSession)) +
           card('Total sessions', totalSessions) + card('Games played', gamesPlayed);
  }

  function heatmapSvg(sessions) {
    const weeks = 26;
    const now = new Date();
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const start = new Date(end.getTime() - (weeks * 7 - 1 - end.getDay()) * DAY);
    const byDay = {};
    for (const s of sessions) byDay[dayKey(s.start)] = (byDay[dayKey(s.start)] || 0) + s.minutes;
    const max = Math.max(30, ...Object.values(byDay));
    const cell = 13, gap = 3;
    let rects = '';
    for (let w = 0; w < weeks; w++) {
      for (let d = 0; d < 7; d++) {
        const date = new Date(start.getTime() + (w * 7 + d) * DAY);
        if (date > end) continue;
        const m = byDay[`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`] || 0;
        const lvl = m === 0 ? 0 : Math.min(4, Math.ceil((m / max) * 4));
        const op = [0.06, 0.28, 0.5, 0.74, 1][lvl];
        rects += `<rect x="${w * (cell + gap)}" y="${d * (cell + gap)}" width="${cell}" height="${cell}" rx="3" fill="var(--accent)" fill-opacity="${op}"><title>${date.toDateString()} — ${fmt(m)}</title></rect>`;
      }
    }
    const wpx = weeks * (cell + gap);
    return `<svg viewBox="0 0 ${wpx} ${7 * (cell + gap)}" width="100%" style="max-width:${wpx}px">${rects}</svg>`;
  }

  function topSvg(games, onBarClickAttr) {
    const ranked = games
      .map((g) => ({ g, m: (g.playtimeMinutes || 0) + (g.steamPlaytimeMinutes || 0) }))
      .filter((x) => x.m > 0)
      .sort((a, b) => b.m - a.m)
      .slice(0, 10);
    if (!ranked.length) return '<p class="hint">No playtime recorded yet.</p>';
    const max = ranked[0].m;
    return '<div class="bars">' + ranked.map(({ g, m }) => `
      <div class="bar-row" data-id="${esc(g.id)}">
        <span class="bar-name">${esc(g.name)}</span>
        <span class="bar-track"><span class="bar-fill" style="width:${(m / max) * 100}%"></span></span>
        <span class="bar-val">${fmt(m)}</span>
      </div>`).join('') + '</div>';
  }

  function sparkline(gameId, sessions) {
    const now = Date.now();
    const buckets = new Array(30).fill(0);
    for (const s of sessions) {
      if (s.gameId !== gameId) continue;
      const age = Math.floor((now - s.start) / DAY);
      if (age >= 0 && age < 30) buckets[29 - age] += s.minutes;
    }
    const max = Math.max(1, ...buckets);
    if (!buckets.some(Boolean)) return '<p class="hint">No tracked sessions in the last 30 days.</p>';
    const w = 300, h = 40;
    const pts = buckets.map((v, i) => `${(i / 29) * w},${h - (v / max) * h}`).join(' ');
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" style="max-width:${w}px" preserveAspectRatio="none">
      <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2" />
    </svg>`;
  }

  function sessionsList(gameId, sessions) {
    const rows = sessions.filter((s) => s.gameId === gameId).sort((a, b) => b.start - a.start).slice(0, 8);
    if (!rows.length) return '';
    return rows.map((s) => {
      const d = new Date(s.start);
      return `<div class="session-row"><span>${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span><span>${fmt(s.minutes)}</span></div>`;
    }).join('');
  }

  function weeklyBarSvg(sessions) {
    const now = Date.now();
    const weeks = 12;
    const buckets = new Array(weeks).fill(0);
    for (const s of sessions) {
      const weeksAgo = Math.floor((now - s.start) / (7 * DAY));
      if (weeksAgo >= 0 && weeksAgo < weeks) buckets[weeks - 1 - weeksAgo] += s.minutes;
    }
    const max = Math.max(60, ...buckets);
    const w = 500, h = 120, barW = w / weeks - 6;
    let bars = '';
    for (let i = 0; i < weeks; i++) {
      const bh = (buckets[i] / max) * (h - 20);
      const x = i * (barW + 6) + 3;
      const y = h - bh - 16;
      bars += `<rect x="${x}" y="${y}" width="${barW}" height="${bh}" rx="3" fill="var(--accent)" fill-opacity="${buckets[i] ? 0.7 : 0.15}"><title>Week ${weeks - i}: ${fmt(buckets[i])}</title></rect>`;
      const label = i === weeks - 1 ? 'now' : (i === weeks - 2 ? '-1w' : '');
      if (label) bars += `<text x="${x + barW / 2}" y="${h - 2}" fill="var(--muted)" font-size="9" text-anchor="middle">${label}</text>`;
    }
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" style="max-width:${w}px" preserveAspectRatio="none">${bars}</svg>`;
  }

  function hourlyBarSvg(sessions) {
    const hours = new Array(24).fill(0);
    for (const s of sessions) {
      const h = new Date(s.start).getHours();
      hours[h] += s.minutes;
    }
    const max = Math.max(60, ...hours);
    if (!hours.some(Boolean)) return '<p class="hint">No session data yet.</p>';
    const w = 500, h = 120, barW = w / 24 - 3;
    let bars = '';
    for (let i = 0; i < 24; i++) {
      const bh = (hours[i] / max) * (h - 22);
      const x = i * (barW + 3) + 1;
      const y = h - bh - 18;
      bars += `<rect x="${x}" y="${y}" width="${barW}" height="${bh}" rx="2" fill="var(--accent)" fill-opacity="${hours[i] ? 0.7 : 0.1}"><title>${i}:00 — ${fmt(hours[i])}</title></rect>`;
      if (i % 4 === 0) bars += `<text x="${x + barW / 2}" y="${h - 3}" fill="var(--muted)" font-size="8" text-anchor="middle">${i}</text>`;
    }
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" style="max-width:${w}px" preserveAspectRatio="none">${bars}</svg>`;
  }

  window.Stats = {
    render(games, sessions) {
      document.getElementById('stats-totals').innerHTML = totalsHtml(games, sessions);
      document.getElementById('stats-heatmap').innerHTML = heatmapSvg(sessions);
      const weekly = document.getElementById('stats-weekly');
      if (weekly) weekly.innerHTML = weeklyBarSvg(sessions);
      const hourly = document.getElementById('stats-hourly');
      if (hourly) hourly.innerHTML = hourlyBarSvg(sessions);
      const top = document.getElementById('stats-top');
      top.innerHTML = topSvg(games);
      top.querySelectorAll('.bar-row').forEach((r) => {
        r.onclick = () => window.gotoGame && window.gotoGame(r.dataset.id);
      });
    },
    sparkline,
    sessionsList,
  };
})();
