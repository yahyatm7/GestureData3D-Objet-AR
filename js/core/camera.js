// Flux webcam unique, partagé par toutes les sections
import { toast } from './ui.js';

export const camera = {
  video: Object.assign(document.createElement('video'), { playsInline: true, muted: true }),
  stream: null,
  get active() { return !!this.stream; },
  get width() { return this.video.videoWidth || 1280; },
  get height() { return this.video.videoHeight || 720; },
  get aspect() { return this.width / this.height; },
};
camera.video.className = 'fill mirror';

export async function startCamera() {
  if (camera.stream) return true;
  if (!navigator.mediaDevices?.getUserMedia) {
    toast('Ce navigateur ne donne pas accès à la caméra. Ouvre la page via http://localhost (voir README).', 'err', 6000);
    return false;
  }
  try {
    camera.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, audio: false,
    });
    camera.video.srcObject = camera.stream;
    await camera.video.play();
    dispatchEvent(new CustomEvent('gd-camera', { detail: true }));
    return true;
  } catch (err) {
    camera.stream = null;
    const why = err.name === 'NotAllowedError' ? 'autorisation refusée' : err.name === 'NotFoundError' ? 'aucune caméra trouvée' : err.message;
    toast(`Caméra indisponible : ${why}.`, 'err', 6000);
    return false;
  }
}

export function stopCamera() {
  camera.stream?.getTracks().forEach((t) => t.stop());
  camera.stream = null;
  camera.video.srcObject = null;
  dispatchEvent(new CustomEvent('gd-camera', { detail: false }));
}

// Place la vidéo partagée dans le conteneur de la section active
export function mountVideo(container, { mirror = true, fit = 'cover' } = {}) {
  const v = camera.video;
  v.classList.toggle('mirror', mirror);
  v.style.objectFit = fit;
  v.hidden = false;
  if (v.parentElement !== container) container.prepend(v);
  if (camera.stream && v.paused) v.play().catch(() => {});
}
export const onCamera = (cb) => addEventListener('gd-camera', (e) => cb(e.detail));
