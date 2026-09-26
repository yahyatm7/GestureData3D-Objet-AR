// Feature engineering + reconnaissance des gestes (règles + k-NN + lissage)
import { clamp, mean } from './ui.js';

export const HAND_CONN = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
export const FINGER_NAMES = ['Pouce', 'Index', 'Majeur', 'Annulaire', 'Auriculaire'];

// Ordre = index de couleur (--g0 … --g9) et touche clavier en simulation
export const GESTURES = ['OPEN', 'FIST', 'POINT', 'PEACE', 'PINCH', 'THUMB_UP', 'THUMB_DOWN', 'ROCK', 'THREE', 'CALL'];
export const GESTURE_LABEL = {
  OPEN: 'Main ouverte', FIST: 'Poing', POINT: 'Index', PEACE: 'V', PINCH: 'Pincement',
  THUMB_UP: 'Pouce levé', THUMB_DOWN: 'Pouce baissé', ROCK: 'Cornes', THREE: 'Trois doigts', CALL: 'Appel (pouce + auriculaire)',
  UNKNOWN: 'Indéterminé', NONE: 'Aucune main',
};
export const gestureIndex = (g) => GESTURES.indexOf(g);

/* ---------- Features ---------- */
export function extractFeatures(lm, aspect) {
  const P = lm.map((p) => [p.x * aspect, p.y]);            // espace isotrope
  const d = (a, b) => Math.hypot(P[a][0] - P[b][0], P[a][1] - P[b][1]);
  const palm = d(0, 9) || 1e-6;

  const ratios = [[5, 8], [9, 12], [13, 16], [17, 20]].map(([m, t]) => d(0, t) / (d(0, m) || 1e-6));
  const extVal = ratios.map((r) => clamp((r - 1.05) / 0.8, 0, 1));
  const thumbR = d(4, 5) / palm;
  const thumbExt = thumbR > 0.45;
  const tv = [P[4][0] - P[2][0], P[4][1] - P[2][1]], tl = Math.hypot(...tv) || 1e-6;
  const thumbUp = thumbExt && tv[1] / tl < -0.7;
  const thumbDown = thumbExt && tv[1] / tl > 0.7;
  const ext = [thumbExt, ...ratios.map((r) => r > 1.45)];
  const pinch = d(4, 8) / palm;
  const openness = mean(extVal);

  const v1 = [P[8][0] - P[5][0], P[8][1] - P[5][1]], v2 = [P[20][0] - P[17][0], P[20][1] - P[17][1]];
  const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / ((Math.hypot(...v1) * Math.hypot(...v2)) || 1e-6);
  const spread = Math.acos(clamp(cos, -1, 1)) * 180 / Math.PI;

  const u = [(P[9][0] - P[0][0]) / palm, (P[9][1] - P[0][1]) / palm];
  const r = [-u[1], u[0]];
  const roll = Math.atan2(u[0], -u[1]) * 180 / Math.PI;

  // 42 coordonnées normalisées (translation, échelle, rotation) + 5 descripteurs
  const vec = [];
  for (let i = 0; i < 21; i++) {
    const dx = P[i][0] - P[0][0], dy = P[i][1] - P[0][1];
    vec.push((dx * r[0] + dy * r[1]) / palm, (dx * u[0] + dy * u[1]) / palm);
  }
  vec.push(...extVal, clamp(thumbR, 0, 1.5));

  const center = { x: mean([0, 5, 9, 13, 17].map((i) => lm[i].x)), y: mean([0, 5, 9, 13, 17].map((i) => lm[i].y)) };
  return { palm, ext, extVal, thumbR, thumbUp, thumbDown, pinch, openness, spread, roll, up: u, idxRatio: ratios[0], tip: lm[8], thumbTip: lm[4], center, vec };
}
export const VEC_COLS = [...Array.from({ length: 21 }, (_, i) => [`x${i}`, `y${i}`]).flat(), 'ext_index', 'ext_middle', 'ext_ring', 'ext_pinky', 'thumb_ratio'];

/* ---------- Classifieur à règles ---------- */
export function classifyRules(f) {
  if (f.pinch < 0.28 && f.idxRatio > 1.2) return { label: 'PINCH', conf: clamp(1 - f.pinch / 0.28, 0.5, 1) };
  const [t, i, m, r, p] = f.ext;
  const n4 = i + m + r + p;
  if (n4 === 0) return { label: f.thumbUp ? 'THUMB_UP' : f.thumbDown ? 'THUMB_DOWN' : 'FIST', conf: 0.9 };
  if (i && !m && !r && !p) return { label: 'POINT', conf: 0.9 };
  if (i && m && !r && !p) return { label: 'PEACE', conf: 0.9 };
  if (i && m && r && !p) return { label: 'THREE', conf: 0.85 };
  if (i && !m && !r && p) return { label: 'ROCK', conf: 0.85 };
  if (!i && !m && !r && p && t) return { label: 'CALL', conf: 0.85 };
  if (n4 === 4) return { label: 'OPEN', conf: 0.95 };
  return { label: 'UNKNOWN', conf: 0.4 };
}

/* ---------- k-NN entraînable dans le navigateur ---------- */
export class KNN {
  constructor(k = 5) { this.k = k; this.data = []; }
  add(label, vec) { this.data.push({ label, vec: vec.slice() }); }
  dist(a, b) { let s = 0; for (let i = 0; i < a.length; i++) { const t = a[i] - b[i]; s += t * t; } return Math.sqrt(s); }
  predict(vec, skip = -1) {
    if (!this.data.length) return { label: 'UNKNOWN', conf: 0 };
    const ds = [];
    this.data.forEach((s, i) => { if (i !== skip) ds.push([this.dist(vec, s.vec), s.label]); });
    ds.sort((a, b) => a[0] - b[0]);
    const votes = {}; let tot = 0;
    for (const [dd, l] of ds.slice(0, this.k)) { const w = 1 / (dd + 1e-3); votes[l] = (votes[l] || 0) + w; tot += w; }
    let best = 'UNKNOWN', bw = 0;
    for (const l in votes) if (votes[l] > bw) { bw = votes[l]; best = l; }
    return { label: best, conf: tot ? bw / tot : 0 };
  }
  counts() { const c = {}; for (const s of this.data) c[s.label] = (c[s.label] || 0) + 1; return c; }
  looAccuracy() {
    let ok = 0;
    this.data.forEach((s, i) => { if (this.predict(s.vec, i).label === s.label) ok++; });
    return this.data.length ? ok / this.data.length : 0;
  }
}

/* ---------- Lissage temporel (vote majoritaire + hystérésis) ---------- */
export class Smoother {
  constructor(size = 7, need = 4) { this.size = size; this.need = need; this.buf = []; this.stable = 'NONE'; }
  push(label) {
    this.buf.push(label); if (this.buf.length > this.size) this.buf.shift();
    const c = {}; for (const l of this.buf) c[l] = (c[l] || 0) + 1;
    let best = this.stable, bc = 0;
    for (const l in c) if (c[l] > bc) { bc = c[l]; best = l; }
    if (bc >= this.need) this.stable = best;
    return this.stable;
  }
}

/* ---------- Main synthétique (mode simulation, sans caméra) ---------- */
const SIM_FINGERS = [
  { mcp: [-0.32, -1.00], fan: -0.16, len: [0.42, 0.26, 0.22] },
  { mcp: [-0.06, -1.06], fan: -0.03, len: [0.46, 0.30, 0.24] },
  { mcp: [0.17, -0.99], fan: 0.09, len: [0.42, 0.27, 0.22] },
  { mcp: [0.37, -0.86], fan: 0.22, len: [0.33, 0.20, 0.18] },
];
const SIM_THUMB = {
  out: [[-0.30, -0.22], [-0.58, -0.50], [-0.82, -0.66], [-1.00, -0.80]],
  in: [[-0.30, -0.22], [-0.45, -0.50], [-0.35, -0.72], [-0.20, -0.80]],
  up: [[-0.30, -0.25], [-0.50, -0.85], [-0.55, -1.30], [-0.55, -1.70]],
  down: [[-0.30, -0.20], [-0.45, 0.05], [-0.50, 0.35], [-0.52, 0.65]],
  pinch: [[-0.30, -0.22], [-0.55, -0.50], [-0.66, -0.85], [-0.64, -1.22]],
};
const SIM_POSES = {
  OPEN: { thumb: 'out', ext: [1, 1, 1, 1] },
  FIST: { thumb: 'in', ext: [0, 0, 0, 0] },
  POINT: { thumb: 'in', ext: [1, 0, 0, 0] },
  PEACE: { thumb: 'in', ext: [1, 1, 0, 0] },
  PINCH: { thumb: 'pinch', ext: [1, 1, 1, 1], pinchIndex: true },
  THUMB_UP: { thumb: 'up', ext: [0, 0, 0, 0] },
  THUMB_DOWN: { thumb: 'down', ext: [0, 0, 0, 0] },
  ROCK: { thumb: 'in', ext: [1, 0, 0, 1] },
  THREE: { thumb: 'in', ext: [1, 1, 1, 0] },
  CALL: { thumb: 'out', ext: [0, 0, 0, 1] },
};
export function synthHand({ x, y, scale, gesture, t = 0 }, aspect) {
  const pose = SIM_POSES[gesture] || SIM_POSES.OPEN;
  const s = scale, breathe = Math.sin(t * 1.7) * 0.015;
  const wx = x + 0.06 * s / aspect, wy = y + 0.95 * s;
  const pts = new Array(21);
  const put = (i, u, v, z = 0) => { pts[i] = { x: wx + (u + breathe * v) * s / aspect, y: wy + v * s, z }; };
  put(0, 0, 0);
  SIM_THUMB[pose.thumb].forEach(([u, v], k) => put(1 + k, u, v, -0.02 * k));
  SIM_FINGERS.forEach((f, fi) => {
    const base = 5 + fi * 4;
    if (fi === 0 && pose.pinchIndex) {
      [[-0.32, -1.0], [-0.44, -1.38], [-0.58, -1.42], [-0.64, -1.27]].forEach(([u, v], k) => put(base + k, u, v, -0.03 * k));
      return;
    }
    const ang = -Math.PI / 2 + f.fan, dir = [Math.cos(ang), Math.sin(ang)];
    let [u, v] = f.mcp;
    put(base, u, v);
    const curl = !pose.ext[fi];
    const k = curl ? [0.55, -0.45, -0.4] : [1, 1, 1];
    for (let j = 0; j < 3; j++) {
      u += dir[0] * f.len[j] * k[j]; v += dir[1] * f.len[j] * k[j];
      put(base + 1 + j, u, v, curl ? -0.04 * (j + 1) : -0.01 * j);
    }
  });
  return pts;
}

// Dessin du squelette de la main sur un canvas 2D (coordonnées normalisées)
export function drawHand(x, lm, w, h, color, { ox = 0, oy = 0 } = {}) {
  x.strokeStyle = color; x.lineWidth = 2;
  for (const [a, b] of HAND_CONN) { x.beginPath(); x.moveTo(ox + lm[a].x * w, oy + lm[a].y * h); x.lineTo(ox + lm[b].x * w, oy + lm[b].y * h); x.stroke(); }
  lm.forEach((p, i) => {
    x.fillStyle = [4, 8, 12, 16, 20].includes(i) ? '#ffffff' : color;
    x.beginPath(); x.arc(ox + p.x * w, oy + p.y * h, i === 0 ? 4.5 : 3, 0, Math.PI * 2); x.fill();
    if ([4, 8, 12, 16, 20].includes(i)) { x.strokeStyle = color; x.lineWidth = 1.5; x.stroke(); x.lineWidth = 2; }
  });
}
