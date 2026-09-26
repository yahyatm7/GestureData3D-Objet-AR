// Chargement paresseux du modèle MediaPipe Hand Landmarker (21 points par main)
import { toast } from './ui.js';

const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const HAND_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

let landmarker = null;
async function create(delegate) {
  const vision = await import(/* @vite-ignore */ `${MP}/vision_bundle.mjs`);
  const files = await vision.FilesetResolver.forVisionTasks(`${MP}/wasm`);
  return vision.HandLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: HAND_MODEL, delegate },
    runningMode: 'VIDEO', numHands: 2,
    minHandDetectionConfidence: 0.6, minHandPresenceConfidence: 0.6, minTrackingConfidence: 0.5,
  });
}
export function getHandLandmarker() {
  if (!landmarker) {
    toast('Chargement du modèle des mains…', '', 2000);
    landmarker = create('GPU').catch(() => create('CPU')).catch((e) => {
      landmarker = null;
      toast('Modèle des mains indisponible : vérifie la connexion internet.', 'err', 6000);
      throw e;
    });
  }
  return landmarker;
}

// Horodatage strictement croissant (exigé par le mode VIDEO)
let lastTs = 0;
export function ts() { let t = performance.now(); if (t <= lastTs) t = lastTs + 0.05; lastTs = t; return t; }

// Coordonnées « écran » : la vidéo est affichée en miroir
export const mirrorLm = (lm) => lm.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z }));
