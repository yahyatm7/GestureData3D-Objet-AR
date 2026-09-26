// GestureData3D · Objet AR : thème, caméra et montage de l'application
import { $, $$, toast } from './core/ui.js';
import { camera, startCamera, stopCamera, onCamera } from './core/camera.js';
import app from './sections/cube.js';

/* ---------- thème ---------- */
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('gd-theme', t); } catch {}
  $$('[data-theme-set]').forEach((b) => b.classList.toggle('on', b.dataset.themeSet === t));
  dispatchEvent(new CustomEvent('gd-theme', { detail: t }));
}
$$('[data-theme-set]').forEach((b) => b.addEventListener('click', () => setTheme(b.dataset.themeSet)));
setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

/* ---------- caméra ---------- */
const camBtn = $('#cam-toggle');
onCamera((on) => {
  $('#cam-dot').classList.toggle('on', on);
  $('#cam-txt').textContent = on ? `Caméra active · ${camera.width}×${camera.height}` : 'Caméra inactive';
  camBtn.textContent = on ? 'Couper la caméra' : 'Activer la caméra';
  try { localStorage.setItem('gd-cam', on ? '1' : '0'); } catch {}
});
camBtn.addEventListener('click', async () => { if (camera.active) stopCamera(); else await startCamera(); });

/* ---------- application ---------- */
(async () => {
  const el = $('#app');
  try {
    await app.init(el);
    let pref = false; try { pref = localStorage.getItem('gd-cam') === '1'; } catch {}
    if (pref) await startCamera();
    await app.enter();
  } catch (e) { console.error(e); toast(`Erreur au démarrage : ${e.message}`, 'err', 8000); }
})();
