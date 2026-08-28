// Gamepad navigation + connect/disconnect animation. Spatial focus model.
(function () {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let active = false;
  let focusEl = null;
  let raf = null;
  const prev = {}; // button debounce
  let lastMove = 0;

  function topSurface() {
    const detail = document.getElementById('detail');
    if (detail && !detail.classList.contains('hidden')) return detail;
    const modal = [...document.querySelectorAll('.modal')].find((m) => !m.classList.contains('hidden'));
    if (modal) return modal;
    return document.querySelector('.view:not(.hidden)') || document.body;
  }

  function focusables() {
    const root = topSurface();
    return [...root.querySelectorAll('button, .card, .rail .rail-item, input, textarea, select')]
      .filter((el) => el.offsetParent !== null && !el.disabled);
  }

  function setFocus(el) {
    if (focusEl) focusEl.classList.remove('gp-focus');
    focusEl = el;
    if (el) {
      el.classList.add('gp-focus');
      el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
    }
  }

  function move(dx, dy) {
    const els = focusables();
    if (!els.length) return;
    if (!focusEl || !els.includes(focusEl)) { setFocus(els[0]); return; }
    const r = focusEl.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let best = null, bestScore = Infinity;
    for (const el of els) {
      if (el === focusEl) continue;
      const b = el.getBoundingClientRect();
      const ex = b.left + b.width / 2, ey = b.top + b.height / 2;
      const vx = ex - cx, vy = ey - cy;
      if (dx === 1 && vx < 8) continue;
      if (dx === -1 && vx > -8) continue;
      if (dy === 1 && vy < 8) continue;
      if (dy === -1 && vy > -8) continue;
      const along = Math.abs(dx ? vx : vy);
      const off = Math.abs(dx ? vy : vx);
      const score = along + off * 2.5;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) setFocus(best);
  }

  function activate() {
    if (!focusEl) return;
    if (focusEl.tagName === 'INPUT' || focusEl.tagName === 'TEXTAREA') { focusEl.focus(); return; }
    focusEl.click();
  }

  function pressed(gp, idx) {
    const b = gp.buttons[idx];
    const now = !!b && (b.pressed || b.value > 0.5);
    const was = prev[idx];
    prev[idx] = now;
    return now && !was;
  }

  function poll() {
    raf = requestAnimationFrame(poll);
    if (document.hidden) return;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = [...pads].find(Boolean);
    if (!gp) return;

    const t = performance.now();
    const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
    const dpadX = (gp.buttons[15] && gp.buttons[15].pressed ? 1 : 0) - (gp.buttons[14] && gp.buttons[14].pressed ? 1 : 0);
    const dpadY = (gp.buttons[13] && gp.buttons[13].pressed ? 1 : 0) - (gp.buttons[12] && gp.buttons[12].pressed ? 1 : 0);
    const mx = dpadX || (Math.abs(ax) > 0.6 ? Math.sign(ax) : 0);
    const my = dpadY || (Math.abs(ay) > 0.6 ? Math.sign(ay) : 0);
    if ((mx || my) && t - lastMove > 180) { move(mx, 0); if (my) move(0, my); lastMove = t; }

    if (pressed(gp, 0)) activate();                 // A
    if (pressed(gp, 1)) window.vaultixNav && window.vaultixNav.back();  // B
    if (pressed(gp, 9)) window.vaultixNav && window.vaultixNav.menu();  // Start
    if (pressed(gp, 4) || pressed(gp, 6)) window.vaultixNav && window.vaultixNav.section(-1); // LB/LT
    if (pressed(gp, 5) || pressed(gp, 7)) window.vaultixNav && window.vaultixNav.section(1);  // RB/RT
  }

  function enterBigPicture() {
    if (active) return;
    active = true;
    document.body.classList.add('bigpicture');
    document.getElementById('gp-hints').classList.remove('hidden');
    const c = document.getElementById('gp-connect');
    c.classList.remove('hidden');
    c.classList.add('show');
    setTimeout(() => { c.classList.remove('show'); setTimeout(() => c.classList.add('hidden'), 400); }, 2200);
    window.toast && window.toast('Controller connected — press A to navigate');
    setFocus(focusables()[0]);
    if (!raf) poll();
  }
  function exitBigPicture() {
    active = false;
    document.body.classList.remove('bigpicture');
    document.getElementById('gp-hints').classList.add('hidden');
    if (focusEl) focusEl.classList.remove('gp-focus');
    focusEl = null;
  }

  window.addEventListener('gamepadconnected', enterBigPicture);
  window.addEventListener('gamepaddisconnected', () => {
    const any = [...(navigator.getGamepads ? navigator.getGamepads() : [])].some(Boolean);
    if (!any) exitBigPicture();
  });

  // if a pad is already connected at load
  window.addEventListener('load', () => {
    const any = [...(navigator.getGamepads ? navigator.getGamepads() : [])].some(Boolean);
    if (any) enterBigPicture();
  });

  window.vaultixGamepad = { refocus: () => setFocus(focusables()[0]) };
})();
