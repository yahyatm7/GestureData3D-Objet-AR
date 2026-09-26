// Texture procédurale de circuit imprimé (PCB), générée sur canvas
const PALETTES = {
  green: { board: '#1f6b34', board2: '#2a8a45', trace: '#b9e27a', pad: '#e8c766', chip: '#16181a', silk: '#f2f2f2' },
  blue: { board: '#1b3f8f', board2: '#2352b3', trace: '#8fb8ff', pad: '#f0c75a', chip: '#111418', silk: '#ffffff' },
  black: { board: '#141517', board2: '#1f2124', trace: '#c9a45a', pad: '#e7c56b', chip: '#050505', silk: '#e6e6e6' },
  purple: { board: '#3e2466', board2: '#533184', trace: '#f0b45a', pad: '#f4d06f', chip: '#101010', silk: '#ffffff' },
};
export const PCB_NAMES = { green: 'PCB vert', blue: 'PCB bleu', black: 'PCB noir et or', purple: 'PCB violet' };

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

export function pcbCanvas(kind = 'green', seed = 1, size = 512) {
  const P = PALETTES[kind] || PALETTES.green;
  const r = rng(seed * 7919 + 17);
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, P.board); g.addColorStop(1, P.board2);
  x.fillStyle = g; x.fillRect(0, 0, size, size);

  // pistes (marches aléatoires à 45°)
  const step = size / 32;
  x.lineCap = 'round'; x.lineJoin = 'round';
  for (let n = 0; n < 70; n++) {
    let px = Math.floor(r() * 32) * step, py = Math.floor(r() * 32) * step;
    let dir = Math.floor(r() * 8);
    x.strokeStyle = P.trace; x.globalAlpha = 0.55 + r() * 0.45;
    x.lineWidth = 1 + Math.floor(r() * 3);
    x.beginPath(); x.moveTo(px, py);
    const len = 4 + Math.floor(r() * 14);
    for (let k = 0; k < len; k++) {
      if (r() < 0.3) dir = (dir + (r() < 0.5 ? 1 : 7)) % 8;
      const a = dir * Math.PI / 4;
      px += Math.round(Math.cos(a)) * step; py += Math.round(Math.sin(a)) * step;
      x.lineTo(px, py);
    }
    x.stroke();
    x.globalAlpha = 1; x.fillStyle = P.pad;
    x.beginPath(); x.arc(px, py, x.lineWidth + 2, 0, Math.PI * 2); x.fill();
  }
  // vias
  for (let n = 0; n < 90; n++) {
    const px = r() * size, py = r() * size, rr = 2 + r() * 3;
    x.fillStyle = P.pad; x.beginPath(); x.arc(px, py, rr, 0, Math.PI * 2); x.fill();
    x.fillStyle = P.board; x.beginPath(); x.arc(px, py, rr * 0.45, 0, Math.PI * 2); x.fill();
  }
  // composants (puces avec broches)
  for (let n = 0; n < 7; n++) {
    const w = size * (0.1 + r() * 0.18), h = size * (0.08 + r() * 0.14);
    const px = r() * (size - w), py = r() * (size - h);
    x.fillStyle = P.pad;
    const pins = Math.max(4, Math.floor(w / 9));
    for (let k = 0; k < pins; k++) {
      const pxk = px + (k + 0.5) * (w / pins) - 2;
      x.fillRect(pxk, py - 5, 4, 5); x.fillRect(pxk, py + h, 4, 5);
    }
    x.fillStyle = P.chip; x.fillRect(px, py, w, h);
    x.fillStyle = 'rgba(255,255,255,.08)'; x.fillRect(px + 3, py + 3, w - 6, 3);
    x.fillStyle = P.silk; x.font = `${Math.max(9, Math.round(size / 42))}px monospace`;
    x.fillText(`U${1 + Math.floor(r() * 40)}`, px + 5, py + h - 6);
  }
  // petites résistances / condensateurs
  for (let n = 0; n < 30; n++) {
    const px = r() * size, py = r() * size, vert = r() < 0.5;
    x.fillStyle = P.pad;
    if (vert) { x.fillRect(px, py, 6, 4); x.fillRect(px, py + 10, 6, 4); } else { x.fillRect(px, py, 4, 6); x.fillRect(px + 10, py, 4, 6); }
    x.fillStyle = '#2b2b2b'; if (vert) x.fillRect(px, py + 4, 6, 6); else x.fillRect(px + 4, py, 6, 6);
  }
  // grille BGA
  const bx = r() * size * 0.6, by = r() * size * 0.6;
  x.fillStyle = P.pad;
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { x.beginPath(); x.arc(bx + i * 9, by + j * 9, 2.4, 0, Math.PI * 2); x.fill(); }
  // bordure
  x.strokeStyle = P.pad; x.lineWidth = 4; x.strokeRect(2, 2, size - 4, size - 4);
  return c;
}
