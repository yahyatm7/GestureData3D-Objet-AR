// GestureData3D · Objet AR : un cube circuit imprimé (ou l'objet importé, affiché tel quel) ancré sur la main
import * as THREE from 'three';
import { GLTFLoader } from '../../vendor/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from '../../vendor/jsm/loaders/OBJLoader.js';
import { STLLoader } from '../../vendor/jsm/loaders/STLLoader.js';
import { $, clamp, toast, download, dropzone, readFileAs, loadImage, fmtTime, fitCanvas } from '../core/ui.js';
import { camera, startCamera, mountVideo, onCamera } from '../core/camera.js';
import { getHandLandmarker, ts, mirrorLm } from '../core/vision.js';
import { extractFeatures, classifyRules, Smoother, GESTURE_LABEL, drawHand } from '../core/gestures.js';
import { pcbCanvas, PCB_NAMES } from '../core/pcb.js';
import { OneEuro, OneEuro3 } from '../core/filters.js';

const SHAPES = { cube: 'Cube', sphere: 'Sphère', icosa: 'Icosaèdre', torus: 'Tore', prism: 'Prisme', knot: 'Nœud', model: 'Modèle importé' };
const ANCHORS = { above: 'Au-dessus de la paume', palm: 'Dans la paume', index: 'Au bout de l’index' };
const COMMANDS = [
  ['Main ouverte', 'l’objet se pose sur la main et suit son orientation'],
  ['Poing', 'figer l’objet sur place (rouvrir la main pour le reprendre)'],
  ['Pincement', 'faire tourner l’objet en déplaçant la main'],
  ['V', 'texture suivante (cube)'],
  ['Index', 'forme suivante'],
  ['Pouce levé (maintenu)', 'prendre une photo'],
  ['Deux mains', 'l’objet se place entre les mains, l’écart règle la taille'],
];

let el, raf = 0, active = false;
let renderer, scene, cam3, holder, mesh, edges, modelObj = null;
const H_VIEW = 2 * 10 * Math.tan(THREE.MathUtils.degToRad(20));
const S = {
  shape: 'cube', texture: 'green', seed: 1, size: 1.3, edges: true, autoSpin: false, follow: true, anchor: 'above', showHands: true,
  landmarker: null, lastVideoTime: -1, hands: [], world: [], frozen: false, spin: 0, spinVel: 0,
  prevCenter: null, g: 'NONE', since: 0, fired: false, visible: 0,
};
const smoother = new Smoother(5, 3);
const fPos = new OneEuro3(1.0, 0.8), fScale = new OneEuro(0.8, 0.5), fUp = new OneEuro3(1.2, 0.4), fSide = new OneEuro3(1.2, 0.4);
const recState = { rec: null, chunks: [], t0: 0, comp: null, ctx: null };

function textures() {
  return [0, 1, 2, 3, 4, 5].map((i) => { const t = new THREE.CanvasTexture(pcbCanvas(S.texture, S.seed * 10 + i, 512)); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; });
}
function disposeMesh() {
  if (mesh) {
    holder.remove(mesh);
    // les objets importés précédents et les cubes générés sont libérés ; l'objet importé actif est conservé
    if (mesh !== modelObj) mesh.traverse((m) => { m.geometry?.dispose(); (Array.isArray(m.material) ? m.material : m.material ? [m.material] : []).forEach((x) => { x.map?.dispose(); x.dispose(); }); });
  }
  if (edges) { holder.remove(edges); edges.geometry.dispose(); edges = null; }
}
function syncControls() {
  if (!el) return;
  const isModel = S.shape === 'model';
  const tex = $('#cb-tex', el), edg = $('#cb-edges', el);
  if (tex) tex.disabled = isModel;
  if (edg) edg.disabled = isModel;
}
function buildMesh() {
  disposeMesh();
  if (S.shape === 'model' && modelObj) {
    // l'objet importé est affiché tel quel : ses propres matériaux, sans texture du cube
    mesh = modelObj; holder.add(mesh);
    syncControls();
    return;
  }
  const tex = textures();
  let geo;
  switch (S.shape) {
    case 'sphere': geo = new THREE.SphereGeometry(0.62, 48, 32); break;
    case 'icosa': geo = new THREE.IcosahedronGeometry(0.66, 0); break;
    case 'torus': geo = new THREE.TorusGeometry(0.5, 0.2, 24, 64); break;
    case 'prism': geo = new THREE.CylinderGeometry(0.6, 0.6, 1, 6); break;
    case 'knot': geo = new THREE.TorusKnotGeometry(0.42, 0.14, 200, 20); break;
    default: geo = new THREE.BoxGeometry(1, 1, 1);
  }
  const mat = (t) => new THREE.MeshStandardMaterial({ map: t, roughness: 0.42, metalness: 0.25 });
  mesh = new THREE.Mesh(geo, S.shape === 'cube' ? tex.map(mat) : mat(tex[0]));
  syncControls();
  if (S.shape !== 'cube') { tex[0].wrapS = tex[0].wrapT = THREE.RepeatWrapping; tex[0].repeat.set(2, 1); }
  holder.add(mesh);
  if (S.edges && ['cube', 'prism', 'icosa'].includes(S.shape)) {
    edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: '#e9f7c9', transparent: true, opacity: 0.85 }));
    holder.add(edges);
  }
}

/* ---------- import de modèles 3D ---------- */
function normalizeModel(obj) {
  const box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const k = 1.1 / (Math.max(size.x, size.y, size.z) || 1);
  const wrap = new THREE.Group(); obj.position.sub(c); wrap.add(obj); wrap.scale.setScalar(k);
  obj.traverse((m) => { if (m.isMesh && !m.material) m.material = new THREE.MeshStandardMaterial({ color: '#cccccc' }); });
  return wrap;
}
async function importFile(file) {
  const name = file.name.toLowerCase();
  try {
    if (/\.(png|jpe?g|webp|gif)$/.test(name)) {
      const img = await loadImage(await readFileAs(file));
      const t = new THREE.Texture(img); t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true;
      // l'image est affichée telle quelle (couleurs et transparence d'origine, sans éclairage)
      const a = img.width / img.height, w = a >= 1 ? 1.3 : 1.3 * a, h = a >= 1 ? 1.3 / a : 1.3;
      modelObj = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide, transparent: true, alphaTest: 0.02 }));
    } else {
      const buf = await readFileAs(file, 'arrayBuffer');
      let obj;
      if (/\.(glb|gltf)$/.test(name)) obj = (await new GLTFLoader().parseAsync(buf, '')).scene;
      else if (name.endsWith('.obj')) obj = new OBJLoader().parse(new TextDecoder().decode(buf));
      else if (name.endsWith('.stl')) { const g = new STLLoader().parse(buf); g.computeVertexNormals(); obj = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: '#c9c9c4', roughness: 0.5, metalness: 0.2 })); }
      else throw new Error('format non pris en charge');
      modelObj = normalizeModel(obj);
    }
    S.shape = 'model';
    const opt = $('#cb-shape option[value=model]', el); opt.disabled = false; $('#cb-shape', el).value = 'model';
    buildMesh(); toast(`« ${file.name} » remplace le cube, affiché tel quel`);
  } catch (e) { console.error(e); toast(`Import impossible : ${e.message}. Formats : .glb, .gltf (fichier unique), .obj, .stl ou une image.`, 'err', 6000); }
}

/* ---------- scène ---------- */
function setupThree(canvas) {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  scene = new THREE.Scene();
  cam3 = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 100);
  cam3.position.set(0, 0, 10);
  scene.add(new THREE.HemisphereLight('#ffffff', '#555555', 1.6));
  const key = new THREE.DirectionalLight('#ffffff', 2.2); key.position.set(3, 5, 6); scene.add(key);
  const rim = new THREE.DirectionalLight('#cfe8ff', 0.8); rim.position.set(-5, -2, 3); scene.add(rim);
  holder = new THREE.Group(); scene.add(holder);
  holder.scale.setScalar(2);
  buildMesh();
}
function resize() {
  const box = $('#cb-stage', el); if (!box || !renderer) return;
  box.style.aspectRatio = camera.active ? `${camera.width} / ${camera.height}` : '16 / 9';
  const w = box.clientWidth, h = box.clientHeight;
  renderer.setSize(w, h, false);
  cam3.aspect = w / Math.max(1, h); cam3.updateProjectionMatrix();
}
const toWorld = (x, y) => new THREE.Vector3((x - 0.5) * H_VIEW * cam3.aspect, -(y - 0.5) * H_VIEW, 0);

function handBasis(wl, t) {
  const v = (i) => new THREE.Vector3(-wl[i].x, -wl[i].y, -wl[i].z);
  const upRaw = v(9).sub(v(0)).normalize(), sideRaw = v(17).sub(v(5)).normalize();
  const u = fUp.filter(upRaw, t), s = fSide.filter(sideRaw, t);
  const up = new THREE.Vector3(u.x, u.y, u.z).normalize();
  const side = new THREE.Vector3(s.x, s.y, s.z);
  const fwd = new THREE.Vector3().crossVectors(side, up).normalize();
  const s2 = new THREE.Vector3().crossVectors(up, fwd).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(s2, up, fwd));
}

function onGesture(g) {
  if (g === 'PEACE') { if (S.shape === 'model') return; const keys = Object.keys(PCB_NAMES); S.texture = keys[(keys.indexOf(S.texture) + 1) % keys.length]; $('#cb-tex', el).value = S.texture; buildMesh(); }
  if (g === 'POINT') { const keys = Object.keys(SHAPES).filter((k) => k !== 'model' || modelObj); S.shape = keys[(keys.indexOf(S.shape) + 1) % keys.length]; $('#cb-shape', el).value = S.shape; buildMesh(); }
  if (g === 'FIST') S.frozen = true;
  if (g === 'OPEN') S.frozen = false;
}

function update(now, dt) {
  const t = now / 1000;
  const v = camera.video;
  if (S.landmarker && camera.active && v.readyState >= 2 && v.currentTime !== S.lastVideoTime) {
    S.lastVideoTime = v.currentTime;
    const res = S.landmarker.detectForVideo(v, ts());
    S.hands = (res.landmarks || []).map(mirrorLm); S.world = res.worldLandmarks || [];
  }
  const hands = camera.active ? S.hands : [];
  let g = 'NONE';
  if (hands.length) {
    const f = extractFeatures(hands[0], camera.aspect);
    g = smoother.push(classifyRules(f).label);
    if (g !== S.g) { S.g = g; S.since = now; S.fired = false; onGesture(g); }
    if (g === 'THUMB_UP' && !S.fired && now - S.since > 700) { S.fired = true; snapshot(); }
    let px, py, scale;
    if (hands.length === 2) {
      const a = extractFeatures(hands[1], camera.aspect);
      px = (f.center.x + a.center.x) / 2; py = (f.center.y + a.center.y) / 2;
      scale = clamp(Math.hypot((f.center.x - a.center.x) * camera.aspect, f.center.y - a.center.y) * H_VIEW * 0.6, 0.4, 6);
      S.frozen = false;
    } else {
      const lm = hands[0];
      if (S.anchor === 'index') { px = lm[8].x; py = lm[8].y; }
      else {
        const k = S.anchor === 'palm' ? 0 : 0.75;
        px = f.center.x + (f.up[0] * f.palm * k) / camera.aspect; py = f.center.y + f.up[1] * f.palm * k;
      }
      scale = clamp(f.palm * H_VIEW * S.size, 0.25, 5);
      if (g === 'PINCH' && S.prevCenter) S.spinVel += (f.center.x - S.prevCenter.x) * 20;
    }
    if (!S.frozen) {
      const p = fPos.filter({ x: px, y: py, z: 0 }, t);
      holder.position.copy(toWorld(p.x, p.y));
      holder.scale.setScalar(fScale.filter(scale, t));
      if (S.follow && hands.length === 1 && S.world[0]) holder.userData.base = handBasis(S.world[0], t);
    }
    S.prevCenter = { x: f.center.x, y: f.center.y };
    S.visible = Math.min(1, S.visible + dt * 4);
  } else {
    smoother.push('NONE'); S.g = 'NONE'; S.prevCenter = null;
    if (!camera.active) { holder.position.set(0, 0, 0); holder.scale.setScalar(2.2); holder.userData.base = null; S.visible = 1; }
    else if (!S.frozen) S.visible = Math.max(0.25, S.visible - dt * 1.5);
  }
  if (S.autoSpin || !camera.active) S.spin += dt * 0.8;
  S.spin += S.spinVel * dt; S.spinVel *= Math.pow(0.1, dt);
  const base = holder.userData.base || new THREE.Quaternion().setFromEuler(new THREE.Euler(0.45, 0, 0.1));
  holder.quaternion.copy(base).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), S.spin));
  holder.traverse((m) => { if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => { if (x.userData.t0 === undefined) x.userData.t0 = x.transparent; x.transparent = x.userData.t0 || S.visible < 1; x.opacity = S.visible; }); });
  renderer.render(scene, cam3);
  // mains
  const { x, w, h } = fitCanvas($('#cb-hands', el));
  x.clearRect(0, 0, w, h);
  if (S.showHands) hands.forEach((lm, i) => { x.globalAlpha = 0.85; drawHand(x, lm, w, h, i ? '#9fe0ff' : '#b8ff6a'); x.globalAlpha = 1; });
  return { g, n: hands.length };
}

/* ---------- capture ---------- */
function composite() {
  const W = camera.active ? camera.width : 1280, H = camera.active ? camera.height : 720;
  if (!recState.comp) { recState.comp = document.createElement('canvas'); recState.ctx = recState.comp.getContext('2d'); }
  const c = recState.comp, x = recState.ctx;
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  if (camera.active) { x.save(); x.translate(W, 0); x.scale(-1, 1); x.drawImage(camera.video, 0, 0, W, H); x.restore(); } else { x.fillStyle = '#1a1a1a'; x.fillRect(0, 0, W, H); }
  x.drawImage(renderer.domElement, 0, 0, W, H);
  return c;
}
function snapshot() { composite().toBlob((b) => { download(b, `objet-ar-${Date.now()}.png`); toast('Photo enregistrée'); }, 'image/png'); }
function toggleRecord() {
  const btn = $('#cb-rec', el);
  if (recState.rec) { recState.rec.stop(); return; }
  composite();
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find((m) => window.MediaRecorder?.isTypeSupported?.(m));
  if (!mime) { toast('L’enregistrement vidéo n’est pas pris en charge par ce navigateur.', 'err'); return; }
  const rec = new MediaRecorder(recState.comp.captureStream(30), { mimeType: mime, videoBitsPerSecond: 6e6 });
  recState.chunks = [];
  rec.ondataavailable = (e) => e.data.size && recState.chunks.push(e.data);
  rec.onstop = () => { download(new Blob(recState.chunks, { type: mime }), `objet-ar-${Date.now()}.${mime.includes('mp4') ? 'mp4' : 'webm'}`); recState.rec = null; btn.textContent = 'Enregistrer une vidéo'; $('#cb-badge', el).hidden = true; };
  rec.start(250); recState.rec = rec; recState.t0 = performance.now();
  btn.textContent = 'Arrêter l’enregistrement'; $('#cb-badge', el).hidden = false;
}

let lastT = performance.now(), fpsAcc = 0, fpsN = 0, tick = 0;
function loop(now) {
  raf = requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now; fpsAcc += dt; fpsN++;
  const { g, n } = update(now, dt);
  if (recState.rec) { composite(); $('#cb-time', el).textContent = fmtTime((now - recState.t0) / 1000); }
  if (++tick % 8 === 0) {
    $('#cb-g', el).textContent = GESTURE_LABEL[g] || g;
    $('#cb-n', el).textContent = String(n);
    $('#cb-state', el).textContent = S.frozen ? 'figé' : n === 2 ? 'entre les mains' : n ? 'sur la main' : 'en attente';
  }
  if (fpsAcc > 0.5) { $('#cb-fps', el).textContent = `${Math.round(fpsN / fpsAcc)} i/s`; fpsAcc = 0; fpsN = 0; }
}

async function enableCamera() {
  if (!camera.active && !(await startCamera())) return;
  try { S.landmarker = await getHandLandmarker(); } catch { return; }
  mountVideo($('#cb-stage', el), { fit: 'contain' });
  $('#cb-ph', el).hidden = true;
  [fPos, fUp, fSide].forEach((f) => f.reset()); fScale.reset();
  resize();
}

function init(root) {
  el = root;
  root.innerHTML = `
  <div class="sec-head">
    <div><p class="eyebrow">Computer Vision × détection des gestes × 3D</p><h1>GestureData3D <span class="em">· Objet AR</span></h1>
      <p class="tagline">Une application interactive basée sur la Computer Vision, la détection des gestes et la 3D.</p>
      <p>Montre ta main à la caméra : le cube s’y pose et suit son orientation. Importe ton propre objet 3D ou une image, il remplace le cube et s’affiche tel quel.</p></div>
    <div class="row"><button class="btn" id="cb-import">Importer un objet</button><button class="btn primary" id="cb-cam">Activer la caméra</button></div>
  </div>
  <div class="brief"><p>La webcam est analysée par MediaPipe (21 points 3D par main). Le repère de la main donne la position, la taille et l’orientation de l’objet ; un filtre One Euro supprime les tremblements. Les gestes sont reconnus à partir de variables calculées sur les doigts.</p>
    <ul><li>Détection de la main : MediaPipe Hands</li><li>Rendu 3D : Three.js / WebGL</li><li>Import : .glb · .gltf · .obj · .stl · image</li></ul></div>
  <div class="sec-grid">
    <div class="stack">
      <div class="view">
        <div class="media-box" id="cb-stage">
          <canvas id="cb-3d"></canvas>
          <canvas id="cb-hands" style="pointer-events:none"></canvas>
          <div class="badge" id="cb-badge" hidden><span class="dot rec"></span>REC <span id="cb-time">00:00</span></div>
          <div class="placeholder" id="cb-ph" style="background:transparent;align-content:end;padding-bottom:18px;pointer-events:none">
            <span class="note" style="color:#ddd">Aperçu sans caméra. Active la caméra pour poser l’objet sur ta main.</span>
          </div>
        </div>
      </div>
      <div class="panel">
        <h3>Commandes gestuelles <span class="aside">mains : <b id="cb-n">0</b> · geste : <b id="cb-g">—</b> · objet : <b id="cb-state">—</b> · <span id="cb-fps">—</span></span></h3>
        <ul class="list">${COMMANDS.map(([a, b]) => `<li><b style="min-width:170px">${a}</b><span class="note">${b}</span></li>`).join('')}</ul>
      </div>
    </div>
    <aside class="side">
      <div class="panel">
        <h3>Objet</h3>
        <label class="field-row"><span>Forme</span><select id="cb-shape">${Object.entries(SHAPES).map(([k, v]) => `<option value="${k}"${k === 'model' ? ' disabled' : ''}>${v}</option>`).join('')}</select></label>
        <label class="field-row"><span>Texture</span><select id="cb-tex">${Object.entries(PCB_NAMES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        <div class="dropzone" id="cb-drop"><b>Déposer un modèle 3D ou une image</b><span class="note">.glb · .gltf · .obj · .stl · .png · .jpg — remplace le cube, affiché tel quel</span></div>
        <p class="note">Pour revenir au cube, choisis « Cube » dans la liste des formes.</p>
      </div>
      <div class="panel">
        <h3>Suivi de la main</h3>
        <label class="field-row"><span>Ancrage</span><select id="cb-anchor">${Object.entries(ANCHORS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        <label class="field-row"><span>Taille</span><output id="cb-sizeo">1,3×</output></label>
        <input type="range" id="cb-size" min="0.5" max="3" step="0.1" value="1.3" aria-label="Taille">
        <label class="check"><input type="checkbox" id="cb-follow" checked> Suivre l’orientation de la main</label>
        <label class="check"><input type="checkbox" id="cb-spin"> Rotation automatique</label>
        <label class="check"><input type="checkbox" id="cb-edges" checked> Arêtes lumineuses</label>
        <label class="check"><input type="checkbox" id="cb-hands-on" checked> Afficher mes mains</label>
        <button class="btn sm" id="cb-seed">Nouveau motif de circuit</button>
      </div>
      <div class="panel">
        <h3>Capture</h3>
        <div class="row"><button class="btn sm" id="cb-photo">Photo PNG</button><button class="btn sm" id="cb-rec">Enregistrer une vidéo</button></div>
      </div>
    </aside>
  </div>`;
  setupThree($('#cb-3d', root));
  new ResizeObserver(resize).observe($('#cb-stage', root));
  $('#cb-cam', root).addEventListener('click', enableCamera);
  $('#cb-shape', root).addEventListener('change', (e) => { S.shape = e.target.value; buildMesh(); });
  $('#cb-tex', root).addEventListener('change', (e) => { S.texture = e.target.value; buildMesh(); });
  $('#cb-anchor', root).addEventListener('change', (e) => { S.anchor = e.target.value; fPos.reset(); });
  $('#cb-size', root).addEventListener('input', (e) => { S.size = +e.target.value; $('#cb-sizeo', root).textContent = `${S.size.toFixed(1).replace('.', ',')}×`; });
  $('#cb-edges', root).addEventListener('change', (e) => { S.edges = e.target.checked; buildMesh(); });
  $('#cb-spin', root).addEventListener('change', (e) => (S.autoSpin = e.target.checked));
  $('#cb-follow', root).addEventListener('change', (e) => { S.follow = e.target.checked; if (!S.follow) holder.userData.base = null; });
  $('#cb-hands-on', root).addEventListener('change', (e) => (S.showHands = e.target.checked));
  $('#cb-seed', root).addEventListener('click', () => { S.seed++; if (S.shape !== 'model') buildMesh(); });
  $('#cb-photo', root).addEventListener('click', snapshot);
  $('#cb-rec', root).addEventListener('click', toggleRecord);
  const inp = dropzone($('#cb-drop', root), '.glb,.gltf,.obj,.stl,image/*', importFile);
  $('#cb-import', root).addEventListener('click', () => inp.click());
  onCamera((on) => { $('#cb-ph', root).hidden = on; if (on && active) enableCamera(); resize(); });
}

export default {
  init,
  async enter() {
    active = true;
    if (camera.active) await enableCamera();
    resize(); cancelAnimationFrame(raf); lastT = performance.now(); raf = requestAnimationFrame(loop);
  },
  leave() { active = false; cancelAnimationFrame(raf); if (recState.rec) recState.rec.stop(); },
};
