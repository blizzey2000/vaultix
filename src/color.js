// Extract a vibrant accent color from an image. Returns {accent, accent2} or null.
window.dominantColor = function dominantColor(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onerror = () => resolve(null);
    img.onload = () => {
      try {
        const w = 48, h = 48;
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h).data; // throws if tainted

        // bucket by hue, weight by saturation*value, ignore near-greyscale & very dark/bright
        const buckets = {};
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
          const max = Math.max(r, g, b), min = Math.min(r, g, b);
          const v = max, s = max === 0 ? 0 : (max - min) / max;
          if (s < 0.25 || v < 0.15 || v > 0.97) continue;
          let hue = 0;
          const d = max - min;
          if (d !== 0) {
            if (max === r) hue = ((g - b) / d) % 6;
            else if (max === g) hue = (b - r) / d + 2;
            else hue = (r - g) / d + 4;
            hue *= 60; if (hue < 0) hue += 360;
          }
          const key = Math.round(hue / 15) * 15;
          buckets[key] = (buckets[key] || 0) + s * v;
        }
        let bestHue = null, bestW = 0;
        for (const k in buckets) if (buckets[k] > bestW) { bestW = buckets[k]; bestHue = +k; }
        if (bestHue === null) return resolve(null);

        const accent = hsl(bestHue, 70, 62);
        const accent2 = hsl(bestHue, 68, 48);
        resolve({ accent, accent2 });
      } catch (e) {
        resolve(null); // tainted canvas (remote image w/o CORS)
      }
    };
    img.src = src;
  });
};

function hsl(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  const to = (x) => Math.round(255 * x).toString(16).padStart(2, '0');
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}
