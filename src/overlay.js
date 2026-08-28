const { ipcRenderer } = require('electron');

const card = document.getElementById('card');
const queue = [];
let busy = false;

function next() {
  if (busy || !queue.length) return;
  busy = true;
  const a = queue.shift();
  document.getElementById('ov-icon').textContent = a.icon || '🏆';
  document.getElementById('ov-title').textContent = a.name || 'Achievement';
  document.getElementById('ov-desc').textContent = a.desc || '';
  setTimeout(() => card.classList.add('show'), 30);
  setTimeout(() => {
    card.classList.remove('show');
    setTimeout(() => { busy = false; next(); }, 650);
  }, 4200);
}

ipcRenderer.on('achievement', (e, a) => { queue.push(a); next(); });
