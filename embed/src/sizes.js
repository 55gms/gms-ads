// Auto-size logic for ads.js. Pure: no DOM access, so it can be reused by the
// dashboard's snippet preview.

// Preferred sizes per breakpoint, best first. Wider tiers fall through to the
// narrower ones so a slot can still fill when a campaign lacks the big size.
const TIERS = [
  [970, ['970x250', '970x90', '728x90']],
  [728, ['728x90', '468x60']],
  [468, ['468x60']],
  [336, ['336x280', '300x250']],
  [320, ['320x100', '320x50']],
  [300, ['300x250']],
  [250, ['250x250']],
];

const MAX_CANDIDATES = 4;

// width: available width in CSS px. height: available height when the parent
// constrains it, otherwise 0 or undefined. Returns sizes like "728x90".
export function pickSizes(width, height) {
  const w = Math.floor(width || 0);
  const h = height > 0 ? Math.floor(height) : 0;
  const out = [];
  const add = (size) => {
    const parts = size.split('x');
    if (+parts[0] > w || (h && +parts[1] > h) || out.indexOf(size) !== -1) return;
    out.push(size);
  };
  // Tall, constrained slots suit the skyscraper formats first.
  if (h >= 600) {
    if (w >= 300 && w < 728) add('300x600');
    if (w >= 160 && w < 300) add('160x600');
  }
  for (let i = 0; i < TIERS.length && out.length < MAX_CANDIDATES; i++) {
    if (w < TIERS[i][0]) continue;
    for (let j = 0; j < TIERS[i][1].length; j++) add(TIERS[i][1][j]);
  }
  return out.slice(0, MAX_CANDIDATES);
}

export function parseSize(size) {
  const m = /^(\d{1,4})\s*[x×]\s*(\d{1,4})$/i.exec(String(size || '').trim());
  return m ? { width: +m[1], height: +m[2], key: m[1] + 'x' + m[2] } : null;
}
