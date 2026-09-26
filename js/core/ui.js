// Petits utilitaires partagés par toutes les sections
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
export const lerp = (a, b, t) => a + (b - a) * t;

export function html(strings, ...vals) {
  return strings.reduce((s, str, i) => s + str + (i < vals.length ? vals[i] : ''), '');
}

export function toast(msg, kind = '', ms = 3200) {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

export function download(data, filename) {
  const a = document.createElement('a');
  const url = typeof data === 'string' ? data : URL.createObjectURL(data);
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  if (typeof data !== 'string') setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const scripts = {};
export function loadScript(src) {
  if (!scripts[src]) {
    scripts[src] = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => { delete scripts[src]; rej(new Error(`Impossible de charger ${src}`)); };
      document.head.appendChild(s);
    });
  }
  return scripts[src];
}

export const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
export const isDark = () => document.documentElement.dataset.theme === 'dark';
export function onTheme(cb) { addEventListener('gd-theme', cb); }
export const dataColors = () => Array.from({ length: 10 }, (_, i) => cssVar(`--g${i}`));

// Canvas net en haute densité ; retourne le contexte et la taille CSS
export function fitCanvas(c, cssH) {
  const r = c.getBoundingClientRect(), dpr = devicePixelRatio || 1;
  const h = cssH ?? r.height;
  const w = Math.max(1, Math.round(r.width * dpr)), hh = Math.max(1, Math.round(h * dpr));
  if (c.width !== w || c.height !== hh) { c.width = w; c.height = hh; }
  if (cssH) c.style.height = `${cssH}px`;
  const x = c.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { x, w: r.width, h };
}

export function readFileAs(file, how = 'dataURL') {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result); r.onerror = rej;
    if (how === 'arrayBuffer') r.readAsArrayBuffer(file); else if (how === 'text') r.readAsText(file); else r.readAsDataURL(file);
  });
}
export function loadImage(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}

// Zone de dépôt + input fichier caché
export function dropzone(el, accept, onFile) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = accept; input.hidden = true;
  el.appendChild(input);
  el.addEventListener('click', (e) => { if (e.target !== input) input.click(); });
  input.addEventListener('change', () => { if (input.files[0]) onFile(input.files[0]); input.value = ''; });
  el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('over'); });
  el.addEventListener('dragleave', () => el.classList.remove('over'));
  el.addEventListener('drop', (e) => { e.preventDefault(); el.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) onFile(f); });
  return input;
}

export function segmented(root, onChange) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    root.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    onChange(b.dataset.v, b);
  });
}
export const fmtTime = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
