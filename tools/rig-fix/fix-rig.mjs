#!/usr/bin/env node
/**
 * Corrige los pesos del rig de Rufi (modelo A-pose de Meshy) y crea las animaciones
 * idle, wave y curious sobre su esqueleto. No toca texturas, geometría ni proporciones:
 * solo JOINTS_0/WEIGHTS_0 y las animaciones.
 *
 * Uso:
 *   node tools/rig-fix/fix-rig.mjs entrada.glb salida.glb [--keep-meshy-clips] [--report informe.json]
 *
 * Reglas de pesos (ver docs/12-rigging-fase-3.md):
 *   R1 Cabeza (por encima del pivote de Head): 100 % Head. Elimina la influencia de hombros.
 *   R2 Pañuelo (detectado por el verde de la textura): copia los pesos de la piel del cuerpo
 *      que tiene debajo, sin cabeza, cuello ni brazos; en su borde superior, un poco de cuello.
 *      Nunca sigue a Head: no se retuerce al girar la cabeza. Las puntas siguen a la barriga.
 *   R3 Franja de piel entre el pañuelo y la cabeza: se pesa por su posición relativa entre
 *      ambos sobre la superficie (junto al pañuelo = pecho; junto a la cabeza = cuello/cabeza).
 *   R4 Tronco: sin influencia de Head/Neck; la de hombros/brazos solo cerca de la axila
 *      (decae con la distancia a la articulación del brazo). La piel de los brazos
 *      (≥ 50 % de peso original en brazo/antebrazo/mano) no se toca.
 *   R5 Muslos: por debajo de la cadera o junto al eje del muslo se conserva; en la barriga
 *      (por encima de la cadera y lejos del eje) se retira gradualmente hacia la columna.
 *   R6 Suavizado laplaciano de los pesos solo en las zonas de transición del tronco.
 *   R7 Transición en la parte inferior de la cabeza: de 60 % Head en la costura a 100 % Head
 *      a 8 cm sobre la superficie, para repartir el giro de la cabeza (el resto lo absorbe la
 *      franja de piel bajo la cabeza, oculta por el vuelo de la cabeza).
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { writeFileSync } from 'node:fs';
import { computeRegions, mat4mul } from './regions.mjs';

const args = process.argv.slice(2);
const [input, output] = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--report');
const reportPath = args.includes('--report') ? args[args.indexOf('--report') + 1] : null;
const keepMeshyClips = args.includes('--keep-meshy-clips');
if (!input || !output) {
  console.error('Uso: node tools/rig-fix/fix-rig.mjs entrada.glb salida.glb [--keep-meshy-clips] [--report informe.json]');
  process.exit(2);
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const R = await computeRegions(doc);
const { n, world, jname, jpos, weld, nbr, region, prim, skin } = R;
const J = Object.fromEntries(jname.map((name, k) => [name, k]));
const jointsAttr = prim.getAttribute('JOINTS_0');
const weightsAttr = prim.getAttribute('WEIGHTS_0');
const JA = jointsAttr.getArray();
const WA = weightsAttr.getArray();

// --- utilidades -------------------------------------------------------------
const smoothstep = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
function distToSegment(p, a, b) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const t = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2)));
  return dist(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]);
}
const P = (i) => [world[i * 3], world[i * 3 + 1], world[i * 3 + 2]];
const readW = (i) => { const m = new Map(); for (let k = 0; k < 4; k++) { const w = WA[i * 4 + k]; if (w > 0) m.set(JA[i * 4 + k], (m.get(JA[i * 4 + k]) || 0) + w); } return m; };
const normalize = (m) => { let s = 0; for (const w of m.values()) s += w; if (s <= 0) return m; for (const [k, w] of m) m.set(k, w / s); return m; };
const move = (m, from, to, fraction = 1) => { const w = (m.get(from) || 0) * fraction; if (w <= 0) return; m.set(from, m.get(from) - w); m.set(to, (m.get(to) || 0) + w); };

/** Hueso de la columna más cercano en altura, para recibir el peso retirado. */
function spineFor(y) {
  const chain = ['Hips', 'Spine', 'Spine1', 'Spine2'];
  let best = chain[0];
  for (const c of chain) if (y >= jpos[c][1] - 0.03) best = c;
  return J[best];
}

const ARM = new Set(['LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand'].map((k) => J[k]));
const HEADISH = new Set(['Head', 'HeadTop_End', 'headfront', 'Neck'].map((k) => J[k]));
const LEG_L = new Set(['LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase'].map((k) => J[k]));
const LEG_R = new Set(['RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase'].map((k) => J[k]));

const headY = jpos.Head[1], neckY = jpos.Neck[1], chestY = jpos.Spine2[1], hipY = jpos.LeftUpLeg[1];
const weights = new Array(n);
const locked = new Uint8Array(n);
const changed = new Uint8Array(n);
const stats = { R1: 0, R2: 0, R3: 0, R4: 0, R5: 0 };

for (let i = 0; i < n; i++) {
  if (weld[i] !== i) continue; // los duplicados de costura copian el resultado del representante
  const p = P(i);
  const before = readW(i);
  let m = new Map(before);
  const reg = region[i];

  if (reg === 1) { // R1 cabeza
    m = new Map([[J.Head, 1]]);
    locked[i] = 1; stats.R1++;
  } else if (reg === 2) { // R2 pañuelo
    const t = smoothstep(neckY, headY + 0.01, p[1]); // 0 abajo → 1 en el borde superior
    m = new Map([[J.Spine2, 1 - 0.3 * t], [J.Neck, 0.3 * t]]);
    locked[i] = 1; stats.R2++;
  } else {
    {
      // R4 tronco: sin cabeza/cuello
      for (const k of HEADISH) move(m, k, spineFor(p[1]));
      // Brazos: se respeta la segmentación original de la extremidad (≥ 50 % de peso en
      // brazo/antebrazo/mano = piel del brazo, no se toca). En el tronco, la influencia de
      // hombro y brazo solo se conserva cerca de la axila.
      for (const side of ['Left', 'Right']) {
        let limb = 0; for (const k of ['Arm', 'ForeArm', 'Hand']) limb += before.get(J[`${side}${k}`]) || 0;
        if (limb >= 0.5) continue;
        // El hombro va del centro del pecho al brazo: su piel (parte alta del hombro) se
        // conserva cerca de ese segmento; brazo/antebrazo/mano solo cerca de la axila.
        const keepSh = 1 - smoothstep(0.06, 0.15, distToSegment(p, jpos[`${side}Shoulder`], jpos[`${side}Arm`]));
        const keepArm = 1 - smoothstep(0.07, 0.16, dist(p, jpos[`${side}Arm`]));
        for (const k of ['Shoulder', 'Arm', 'ForeArm', 'Hand']) {
          const b = J[`${side}${k}`]; const keep = k === 'Shoulder' ? keepSh : keepArm;
          if ((m.get(b) || 0) > 0 && keep < 1) { move(m, b, spineFor(p[1]), 1 - keep); stats.R4++; }
        }
      }
      // R5 muslos: por debajo de la cadera o junto al eje del muslo se conserva; en la
      // barriga (por encima de la cadera y lejos del eje) se retira de forma gradual.
      for (const [side, set] of [['Left', LEG_L], ['Right', LEG_R]]) {
        const dAxis = distToSegment(p, jpos[`${side}UpLeg`], jpos[`${side}Leg`]);
        const keep = Math.max(1 - smoothstep(hipY - 0.02, hipY + 0.06, p[1]), 1 - smoothstep(0.07, 0.13, dAxis));
        for (const b of set) if ((m.get(b) || 0) > 0 && keep < 1) { move(m, b, spineFor(Math.max(p[1], jpos.Hips[1])), 1 - keep); stats.R5++; }
      }
    }
  }
  weights[i] = normalize(m);
  changed[i] = [...weights[i]].some(([k, w]) => Math.abs((before.get(k) || 0) - w) > 1e-3) || before.size !== weights[i].size ? 1 : 0;
}

const reps = []; for (let i = 0; i < n; i++) if (weld[i] === i) reps.push(i);

/** Distancia sobre la superficie (Dijkstra) desde semillas, solo por vértices permitidos. */
function geodesic(seeds, allowed, maxD) {
  const d = new Float32Array(n).fill(Infinity); const heap = [];
  const push = (v, i) => { let lo = 0, hi = heap.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (heap[mid][0] < v) lo = mid + 1; else hi = mid; } heap.splice(lo, 0, [v, i]); };
  for (const [i, v] of seeds) if (v < d[i]) { d[i] = v; push(v, i); }
  while (heap.length) {
    const [v, i] = heap.shift(); if (v > d[i] || v > maxD) continue;
    for (const j of nbr[i]) { if (!allowed(j)) continue; const nv = v + dist(P(i), P(j)); if (nv < d[j]) { d[j] = nv; push(nv, j); } }
  }
  return d;
}

// R2b El pañuelo copia los pesos de la piel del cuerpo que tiene debajo (vecino más cercano
// del cuerpo, búsqueda por rejilla), sin cabeza ni cuello: así las puntas del nudo, que
// cuelgan sobre la barriga, se mueven con ella, y el pañuelo nunca sigue a la cabeza.
{
  const isBody = (i) => region[i] !== 1 && region[i] !== 2;
  const cell = 0.02, grid = new Map(), keyOf = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (const i of reps) if (isBody(i)) { const p = P(i); const k = keyOf(...p); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); }
  let copied = 0;
  for (const i of reps) {
    if (region[i] !== 2) continue;
    const p = P(i); let best = -1, bd = Infinity;
    for (let r = 1; r <= 3 && best < 0; r++) {
      const [cx, cy, cz] = p.map((v) => Math.floor(v / cell));
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
        for (const j of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) || []) { const d = dist(p, P(j)); if (d < bd) { bd = d; best = j; } }
      }
    }
    if (best < 0) continue;
    const m = new Map(weights[best]);
    for (const k of HEADISH) move(m, k, J.Spine2);
    for (const k of ARM) move(m, k, J.Spine2);
    // el borde superior del pañuelo conserva un poco de cuello, como antes
    const t = smoothstep(neckY, headY + 0.01, p[1]);
    if (t > 0) { for (const [b, w] of m) m.set(b, w * (1 - 0.3 * t)); m.set(J.Neck, (m.get(J.Neck) || 0) + 0.3 * t); }
    weights[i] = normalize(m); copied++;
  }
  stats.R2b_panuelo_sobre_cuerpo = copied;
}

// R3 franja del cuello: piel del cuerpo entre el borde superior del pañuelo y la cabeza.
// Se pesa por su posición relativa entre ambos (sobre la superficie), no por la altura:
// junto al pañuelo sigue al pecho como el pañuelo; junto a la cabeza, al cuello/cabeza.
const H0 = 0.6; // peso de Head en la costura cabeza–cuerpo
{
  const isBody = (i) => region[i] !== 1 && region[i] !== 2;
  const scarfSeeds = [], headSeeds = [];
  for (const i of reps) if (isBody(i)) for (const j of nbr[i]) {
    if (region[j] === 2) scarfSeeds.push([i, dist(P(i), P(j)) / 2]);
    if (region[j] === 1) headSeeds.push([i, dist(P(i), P(j)) / 2]);
  }
  const dS = geodesic(scarfSeeds, isBody, 0.08), dHd = geodesic(headSeeds, isBody, 0.08);
  let strip = 0;
  for (const i of reps) {
    if (!isBody(i) || !isFinite(dS[i]) || !isFinite(dHd[i]) || P(i)[1] < chestY) continue;
    const t = dS[i] / (dS[i] + dHd[i]); // 0 junto al pañuelo, 1 junto a la cabeza
    const fromScarf = new Map([[J.Spine2, 0.85], [J.Neck, 0.15]]);
    const toHead = new Map([[J.Head, H0], [J.Neck, 1 - H0]]);
    const m = new Map(); for (const [b, w] of fromScarf) m.set(b, w * (1 - t)); for (const [b, w] of toHead) m.set(b, (m.get(b) || 0) + w * t);
    weights[i] = normalize(m); locked[i] = 1; strip++;
  }
  stats.R3 = strip;
}

// R7 transición cabeza–cuerpo por distancia sobre la superficie (Dijkstra) desde la costura
// entre la cabeza y la piel del cuerpo (el pañuelo no participa: se queda en el pecho).
// En la costura: 60 % Head + 40 % Neck; 8 cm hacia dentro de la cabeza → 100 % Head; hacia el cuerpo →
// pesos propios. Sin esto, al girar la cabeza se rasga la unión.
const DH = 0.08, DB = 0.03; // la torsión se reparte por la parte inferior de la cabeza
let seamHead = 0, seamScarf = 0;
const dSigned = new Float32Array(n).fill(Infinity);
{
  const heap = []; // cola de prioridad simple (array ordenado por inserción binaria)
  const push = (d, i) => { let lo = 0, hi = heap.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (heap[mid][0] < d) lo = mid + 1; else hi = mid; } heap.splice(lo, 0, [d, i]); };
  const isHead = (i) => region[i] === 1, isBody = (i) => region[i] !== 1 && region[i] !== 2;
  for (const i of reps) {
    for (const j of nbr[i]) {
      if (isHead(i) && isBody(j)) { const d = dist(P(i), P(j)) / 2; if (d < dSigned[i]) { dSigned[i] = d; push(d, i); } seamHead++; }
      if (isBody(i) && isHead(j)) { const d = dist(P(i), P(j)) / 2; if (d < dSigned[i]) { dSigned[i] = d; push(d, i); } }
      if (isHead(i) && region[j] === 2) seamScarf++;
    }
  }
  while (heap.length) {
    const [d, i] = heap.shift(); if (d > dSigned[i]) continue; if (d > Math.max(DH, DB)) break;
    for (const j of nbr[i]) {
      if (isHead(i) !== isHead(j) || region[j] === 2) continue; // se propaga por su propio lado
      const nd = d + dist(P(i), P(j)); if (nd < dSigned[j]) { dSigned[j] = nd; push(nd, j); }
    }
  }
}
let seamTouched = 0;
for (const i of reps) {
  const d = dSigned[i]; if (!isFinite(d)) continue;
  if (region[i] === 1 && d < DH) { const h = H0 + (1 - H0) * smoothstep(0, DH, d); weights[i] = new Map([[J.Head, h], [J.Neck, 1 - h]]); seamTouched++; }
  else if (region[i] !== 1 && region[i] !== 2 && !locked[i] && d < DB) {
    const k = 1 - smoothstep(0, DB, d); const m = new Map(); for (const [b, w] of weights[i]) m.set(b, w * (1 - k));
    m.set(J.Head, (m.get(J.Head) || 0) + H0 * k); m.set(J.Neck, (m.get(J.Neck) || 0) + (1 - H0) * k); weights[i] = normalize(m); seamTouched++;
  }
}
stats.R7_costura_cabeza_cuerpo = seamHead; stats.R7_costura_cabeza_panuelo = seamScarf; stats.R7_vertices = seamTouched;

// R6 suavizado laplaciano en zonas de transición del tronco (no en cabeza ni pañuelo)
const zone = new Uint8Array(n);
for (const i of reps) if (changed[i] && !locked[i]) { zone[i] = 1; for (const j of nbr[i]) if (!locked[j]) zone[j] = 1; }
for (let ring = 0; ring < 2; ring++) { const add = []; for (const i of reps) if (zone[i]) for (const j of nbr[i]) if (!zone[j] && !locked[j]) add.push(j); for (const j of add) zone[j] = 1; }
for (let iter = 0; iter < 4; iter++) {
  const next = new Map();
  for (const i of reps) {
    if (!zone[i]) continue;
    const acc = new Map(); for (const [k, w] of weights[i]) acc.set(k, w * 0.5);
    const ns = nbr[i]; const f = 0.5 / ns.length;
    for (const j of ns) for (const [k, w] of weights[weld[j]]) acc.set(k, (acc.get(k) || 0) + w * f);
    next.set(i, acc);
  }
  for (const [i, acc] of next) weights[i] = normalize(acc);
}

// Escritura: 4 influencias como máximo, normalizadas; duplicados de costura = representante
let multi = 0;
for (let i = 0; i < n; i++) {
  const m = weights[weld[i]];
  const top = [...m].filter(([, w]) => w > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const s = top.reduce((a, [, w]) => a + w, 0) || 1;
  for (let k = 0; k < 4; k++) { JA[i * 4 + k] = top[k] ? top[k][0] : 0; WA[i * 4 + k] = top[k] ? top[k][1] / s : 0; }
  if (top.length > 1) multi++;
}
jointsAttr.setArray(JA);
weightsAttr.setArray(WA);

// --- animaciones --------------------------------------------------------------
const root = doc.getRoot();
if (!keepMeshyClips) for (const a of root.listAnimations()) a.dispose();
const buffer = root.listBuffers()[0];
const nodeOf = Object.fromEntries(skin.listJoints().map((j) => [j.getName().replace('mixamorig:', ''), j]));

const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qinv = (q) => [-q[0], -q[1], -q[2], q[3]];
const qaxis = (axis, deg) => { const h = (deg * Math.PI) / 360, s = Math.sin(h); return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(h)]; };
function quatFromMatrix(m) {
  const sx = Math.hypot(m[0], m[1], m[2]), sy = Math.hypot(m[4], m[5], m[6]), sz = Math.hypot(m[8], m[9], m[10]);
  const r = [m[0] / sx, m[1] / sx, m[2] / sx, m[4] / sy, m[5] / sy, m[6] / sy, m[8] / sz, m[9] / sz, m[10] / sz];
  const tr = r[0] + r[4] + r[8]; let q;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; q = [(r[5] - r[7]) / s, (r[6] - r[2]) / s, (r[1] - r[3]) / s, 0.25 * s]; }
  else if (r[0] > r[4] && r[0] > r[8]) { const s = Math.sqrt(1 + r[0] - r[4] - r[8]) * 2; q = [0.25 * s, (r[3] + r[1]) / s, (r[6] + r[2]) / s, (r[5] - r[7]) / s]; }
  else if (r[4] > r[8]) { const s = Math.sqrt(1 + r[4] - r[0] - r[8]) * 2; q = [(r[3] + r[1]) / s, 0.25 * s, (r[7] + r[5]) / s, (r[6] - r[2]) / s]; }
  else { const s = Math.sqrt(1 + r[8] - r[0] - r[4]) * 2; q = [(r[6] + r[2]) / s, (r[7] + r[5]) / s, 0.25 * s, (r[1] - r[3]) / s]; }
  const l = Math.hypot(...q); return q.map((v) => v / l);
}
const AX = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };
const parentOf = new Map(); for (const nd of root.listNodes()) for (const c of nd.listChildren()) parentOf.set(c, nd);

/** Rotación local de un hueso tras girarlo (desde reposo) alrededor de ejes DEL MUNDO. */
function localRotation(bone, turns) {
  const node = nodeOf[bone]; const parent = parentOf.get(node);
  const qp = quatFromMatrix(parent.getWorldMatrix());
  let q = node.getRotation();
  for (const [axis, deg] of turns) { if (!deg) continue; const qw = qaxis(AX[axis], deg); q = qmul(qmul(qmul(qinv(qp), qw), qp), q); }
  return q;
}

const FPS = 30;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2); // easeInOutCubic
/** Interpola por tramos [t, valor] con suavizado. */
function curve(keys) {
  return (t) => {
    if (t <= keys[0][0]) return keys[0][1];
    for (let k = 1; k < keys.length; k++) {
      if (t <= keys[k][0]) { const [t0, v0] = keys[k - 1], [t1, v1] = keys[k]; return v0 + (v1 - v0) * ease((t - t0) / (t1 - t0)); }
    }
    return keys[keys.length - 1][1];
  };
}

function addClip(name, duration, tracks) {
  const anim = doc.createAnimation(name);
  const steps = Math.round(duration * FPS);
  const times = new Float32Array(steps + 1).map((_, k) => (k / steps) * duration);
  const input = doc.createAccessor(`${name}_t`).setType('SCALAR').setArray(times).setBuffer(buffer);
  for (const tr of tracks) {
    const node = nodeOf[tr.bone];
    let out; let path;
    if (tr.rot) { path = 'rotation'; out = new Float32Array((steps + 1) * 4); times.forEach((t, k) => out.set(localRotation(tr.bone, tr.rot(t)), k * 4)); }
    else { path = 'scale'; out = new Float32Array((steps + 1) * 3); times.forEach((t, k) => out.set(tr.scale(t), k * 3)); }
    const output = doc.createAccessor(`${name}_${tr.bone}_${path}`).setType(path === 'rotation' ? 'VEC4' : 'VEC3').setArray(out).setBuffer(buffer);
    const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
    anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(sampler));
  }
  return anim;
}

// Signos verificados en el banco de pruebas: personaje mirando a +Z, su izquierda = +X.
// Brazo izquierdo: +Z del mundo = subir. Cabeza: +Z = inclinar hacia su izquierda; +Y = girar hacia su izquierda.

// idle — respiración suave (4 s en bucle). El pecho (Spine2) se expande un 1,5 % y sus
// hijos (cuello y hombros) reciben la escala inversa, para que cabeza y brazos no crezcan.
const breath = (t) => 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / 4);
const s = (t) => 1 + 0.015 * breath(t);
addClip('idle', 4, [
  { bone: 'Spine2', scale: (t) => [1 + 0.01 * breath(t), s(t), 1 + 0.012 * breath(t)] },
  ...['Neck', 'LeftShoulder', 'RightShoulder'].map((b) => ({ bone: b, scale: (t) => [1 / (1 + 0.01 * breath(t)), 1 / s(t), 1 / (1 + 0.012 * breath(t))] })),
  { bone: 'Head', rot: (t) => [['X', -1.2 * breath(t)], ['Z', 0.8 * Math.sin((2 * Math.PI * t) / 4)]] },
  { bone: 'LeftArm', rot: (t) => [['Z', 1.5 * breath(t)]] },
  { bone: 'RightArm', rot: (t) => [['Z', -1.5 * breath(t)]] },
]);

// wave — saludo con el brazo izquierdo (el de la imagen oficial), 3,2 s.
const armUp = curve([[0, 0], [0.55, 52], [2.55, 52], [3.2, 0]]);
const foreUp = curve([[0, 0], [0.6, 32], [2.5, 32], [3.2, 0]]);
const waveAmp = curve([[0, 0], [0.6, 0], [0.75, 1], [2.3, 1], [2.5, 0], [3.2, 0]]);
const wobble = (t) => Math.sin(((t - 0.6) * 2 * Math.PI) / 0.55);
addClip('wave', 3.2, [
  // Solo el brazo: el hombro y el pecho no se animan (son la zona más delicada del rig).
  { bone: 'LeftArm', rot: (t) => [['Z', armUp(t)]] },
  { bone: 'LeftForeArm', rot: (t) => [['Z', foreUp(t) + 14 * waveAmp(t) * wobble(t)]] },
  { bone: 'LeftHand', rot: (t) => [['Z', 10 * waveAmp(t) * wobble(t - 0.06)]] },
  { bone: 'Head', rot: (t) => [['Z', 5 * (armUp(t) / 52)], ['Y', 4 * (armUp(t) / 52)]] },
]);

// curious — inclinación moderada de cabeza, 2,6 s.
const tilt = curve([[0, 0], [0.55, 1], [1.9, 1], [2.6, 0]]);
const nod = (t) => (t > 0.55 && t < 1.9 ? Math.sin(((t - 0.55) / 1.35) * Math.PI) : 0);
addClip('curious', 2.6, [
  // Solo la cabeza: cuello y pecho quietos para que el pañuelo no se mueva.
  { bone: 'Head', rot: (t) => [['Z', 10 * tilt(t)], ['Y', 6 * tilt(t)], ['X', -3 * tilt(t) - 1.5 * nod(t)]] },
]);

await io.write(output, doc);
const report = {
  entrada: input, salida: output,
  vertices: n, regiones: Object.fromEntries(['cuerpo', 'cabeza', 'pañuelo', 'barriga', 'pierna', 'brazo'].map((r, k) => [r, region.reduce((a, v) => a + (v === k ? 1 : 0), 0)])),
  reglas_aplicadas: stats, vertices_modificados: changed.reduce((a, v) => a + v, 0), vertices_suavizados: zone.reduce((a, v) => a + v, 0),
  vertices_con_varias_influencias: multi,
  animaciones: root.listAnimations().map((a) => a.getName()),
};
if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
