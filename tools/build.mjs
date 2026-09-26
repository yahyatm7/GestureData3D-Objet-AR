// Regroupe js/ en un seul script classique (dist/app.js) pour que la page
// fonctionne aussi quand on ouvre index.html par double-clic (file://).
// Utilisation : npm install && npm run build
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await build({
  entryPoints: [path.join(root, 'js/main.js')],
  bundle: true, format: 'iife', target: 'es2020', minify: true, sourcemap: false,
  outfile: path.join(root, 'dist/app.js'),
  alias: { three: path.join(root, 'vendor/three.module.js') },
  logLevel: 'info',
});
