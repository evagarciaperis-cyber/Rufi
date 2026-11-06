// Peso total de cada hueso por región: node tools/rig-fix/weights-by-region.mjs modelo.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { computeRegions } from './regions.mjs';
const R = await computeRegions(await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(process.argv[2]));
const J = R.prim.getAttribute('JOINTS_0').getArray(), W = R.prim.getAttribute('WEIGHTS_0').getArray();
const names = ['cuerpo', 'cabeza', 'pañuelo', 'tronco', 'piernas', 'brazos'];
const acc = {};
for (let i = 0; i < R.n; i++) for (let k = 0; k < 4; k++) { const w = W[i * 4 + k]; if (w > 0) { const r = names[R.region[i]]; acc[r] ??= {}; const b = R.jname[J[i * 4 + k]]; acc[r][b] = (acc[r][b] || 0) + w; } }
for (const [r, m] of Object.entries(acc)) { const tot = Object.values(m).reduce((a, b) => a + b, 0); console.log(r.padEnd(8), Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 7).map(([b, w]) => `${b} ${(100 * w / tot).toFixed(1)}%`).join(', ')); }
