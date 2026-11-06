#!/usr/bin/env node
/**
 * Añade a Rufi expresiones faciales con geometría real y un corrector de axila:
 *
 *  - blink: PÁRPADOS NUEVOS (geometría de piel) y una línea de pestañas que bajan sobre cada
 *    ojo. Con peso 0 están plegados y ocultos en el contorno superior del ojo: el ojo abierto
 *    queda exactamente como en el original (los ojos de Rufi están pintados en la textura).
 *  - smile: deformación de la malla de la cara (comisuras arriba y hacia fuera, mejillas).
 *  - wave_corrector (opcional, --corrector): forma correctiva de la axila calculada con "delta
 *    mush" en la pose máxima del saludo y llevada a reposo por skinning inverso. Desactivada por
 *    defecto: en las pruebas no mejoró el pliegue de forma demostrable (ver docs/13).
 *
 * También añade los pesos de expresión a las animaciones idle, wave y curious, y los clips
 * blink y smile.
 *
 * Uso: node tools/face-rig/add-face.mjs entrada.glb salida.glb [--report informe.json]
 * La entrada debe ser el modelo ya simplificado y SIN comprimir (sin Meshopt), para que los
 * párpados se ajusten a la geometría final. Después: optimize-model.mjs --ratio 1 --skip-textures.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { computeRegions, mat4mul } from '../rig-fix/regions.mjs';

const args = process.argv.slice(2);
const [input, output] = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--report');
const reportPath = args.includes('--report') ? args[args.indexOf('--report') + 1] : null;
const useCorrector = args.includes('--corrector'); // experimental: no mejoró de forma demostrable (docs/13)
if (!input || !output) { console.error('Uso: node tools/face-rig/add-face.mjs entrada.glb salida.glb [--report informe.json]'); process.exit(2); }

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const root = doc.getRoot();
const R = await computeRegions(doc);
const { n, world, jname, jpos, weld, nbr, region, prim, skin } = R;
const J = Object.fromEntries(jname.map((nm, k) => [nm, k]));
const buffer = root.listBuffers()[0];
const report = { entrada: input, salida: output };

// ---------------------------------------------------------------- utilidades
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a) || 1; return mul(a, 1 / l); };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const smoothstep = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const P = (i) => [world[i * 3], world[i * 3 + 1], world[i * 3 + 2]];
const NOR = prim.getAttribute('NORMAL').getArray();
const Nv = (i) => [NOR[i * 3], NOR[i * 3 + 1], NOR[i * 3 + 2]];
const UV = prim.getAttribute('TEXCOORD_0').getArray();
const IDX = prim.getIndices().getArray();
const reps = []; for (let i = 0; i < n; i++) if (weld[i] === i) reps.push(i);

// La malla con skin ignora la transformación del nodo: posiciones del atributo = mundo · W⁻¹
// (W = jointWorld·IBM, la identidad en este modelo; se aplica por generalidad).
const ibm = skin.getInverseBindMatrices().getArray();
const joints = skin.listJoints();
const W0 = mat4mul(joints[0].getWorldMatrix(), Array.from(ibm.slice(0, 16)));
const isIdentity = W0.every((v, k) => Math.abs(v - (k % 5 === 0 ? 1 : 0)) < 1e-5);
if (!isIdentity) throw new Error('La pose de reposo no coincide con la de unión: este script asume jointWorld·IBM = identidad');

// ------------------------------------------------------------- textura: color en cada vértice
const tex = prim.getMaterial().getBaseColorTexture().getImage();
const { data: TEX, info: TI } = await sharp(Buffer.from(tex)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
function texel(u, v) {
  u = ((u % 1) + 1) % 1; v = ((v % 1) + 1) % 1;
  const x = Math.min(TI.width - 1, Math.floor(u * TI.width)), y = Math.min(TI.height - 1, Math.floor(v * TI.height));
  const o = (y * TI.width + x) * 3; return [TEX[o], TEX[o + 1], TEX[o + 2]];
}
function hsv([r, g, b]) {
  r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0;
  if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
  return [h, mx ? d / mx : 0, mx];
}
const color = new Array(n);
for (let i = 0; i < n; i++) color[i] = hsv(texel(UV[i * 2], UV[i * 2 + 1]));

// ------------------------------------------------------------- ojos: apertura y contorno
const headY = jpos.Head[1];
const front = (i) => region[i] === 1 && world[i * 3 + 2] > 0.12 && world[i * 3 + 1] > headY + 0.12;
const isSclera = ([h, s, v]) => s < 0.2 && v > 0.7;
const isIris = ([h, s, v]) => h >= 5 && h <= 50 && s > 0.3 && v > 0.1 && v < 0.7;
const isDark = ([h, s, v]) => v < 0.22;
const skinLike = ([h, s, v]) => h >= 10 && h <= 40 && s > 0.12 && s < 0.45 && v > 0.7;

function components(set) {
  const seen = new Set(), comps = [];
  for (const s of set) {
    if (seen.has(s)) continue; const comp = [s]; seen.add(s);
    for (let k = 0; k < comp.length; k++) for (const j of nbr[comp[k]]) if (set.has(j) && !seen.has(j)) { seen.add(j); comp.push(j); }
    comps.push(comp);
  }
  return comps.sort((a, b) => b.length - a.length);
}

const eyes = [];
for (const side of [1, -1]) { // +X = ojo izquierdo del personaje
  const seeds = new Set(reps.filter((i) => front(i) && side * (world[i * 3] - jpos.Head[0]) > 0.02 && (isSclera(color[i]) || isIris(color[i]))));
  let open = new Set(components(seeds)[0] || []);
  // pupila y brillos: vértices oscuros o blancos rodeados por la apertura
  for (let pass = 0; pass < 6; pass++) {
    const add2 = [];
    for (const i of open) for (const j of nbr[i]) if (!open.has(j) && front(j)) {
      const ns = nbr[j]; let c = 0; for (const k of ns) if (open.has(k)) c++;
      if (c / ns.length >= 0.6) add2.push(j);
    }
    if (!add2.length) break; for (const j of add2) open.add(j);
  }
  // pestaña/contorno: oscuros hasta 3 anillos alrededor de la apertura
  const liner = new Set(); let ring = new Set(open);
  for (let r = 0; r < 3; r++) {
    const next = new Set();
    for (const i of ring) for (const j of nbr[i]) if (!open.has(j) && !liner.has(j) && front(j) && isDark(color[j])) { liner.add(j); next.add(j); }
    ring = next;
  }
  const pts = [...open].map(P);
  const c = mul(pts.reduce((a, p) => add(a, p), [0, 0, 0]), 1 / pts.length);
  const nAvg = norm([...open].map(Nv).reduce((a, v) => add(a, v), [0, 0, 0]));
  const right = norm(cross([0, 1, 0], nAvg)); const up = norm(cross(nAvg, right));
  const local = (p) => { const d = sub(p, c); return [dot(d, right), dot(d, up), dot(d, nAvg)]; };
  eyes.push({ side, open, liner, c, n: nAvg, right, up, local });
}
report.ojos = eyes.map((e) => ({ lado: e.side > 0 ? 'izquierdo' : 'derecho', vertices_apertura: e.open.size, vertices_contorno: e.liner.size, centro: e.c.map((v) => +v.toFixed(4)) }));

/** Contorno superior/inferior de la apertura por franjas horizontales (suavizado). */
function contours(e) {
  const NB = 28; const loc = [...e.open].map((i) => e.local(P(i)));
  const s0 = Math.min(...loc.map((l) => l[0])), s1 = Math.max(...loc.map((l) => l[0]));
  const top = new Array(NB).fill(-Infinity), bot = new Array(NB).fill(Infinity), topZ = new Array(NB).fill(0);
  const bin = (s) => Math.max(0, Math.min(NB - 1, Math.floor(((s - s0) / (s1 - s0 + 1e-9)) * NB)));
  for (const l of loc) { const b = bin(l[0]); if (l[1] > top[b]) { top[b] = l[1]; topZ[b] = l[2]; } bot[b] = Math.min(bot[b], l[1]); }
  // rellenar huecos y suavizar
  for (const arr of [top, bot, topZ]) {
    for (let b = 0; b < NB; b++) if (!isFinite(arr[b])) { let k = 1; while (!isFinite(arr[b]) && k < NB) { const a = arr[b - k], c2 = arr[b + k]; if (isFinite(a)) arr[b] = a; else if (isFinite(c2)) arr[b] = c2; k++; } }
    const cp = arr.slice(); for (let b = 0; b < NB; b++) arr[b] = (cp[Math.max(0, b - 1)] + 2 * cp[b] + cp[Math.min(NB - 1, b + 1)]) / 4;
  }
  const at = (arr, s) => { const f = ((s - s0) / (s1 - s0 + 1e-9)) * NB - 0.5; const b = Math.max(0, Math.min(NB - 1, Math.floor(f))), b2 = Math.min(NB - 1, b + 1), t = Math.max(0, Math.min(1, f - b)); return arr[b] * (1 - t) + arr[b2] * t; };
  return { top: (s) => at(top, s), bot: (s) => at(bot, s), topZ: (s) => at(topZ, s) };
}

// ------------------------------------------------------------- párpados (malla paramétrica)
// Por cada ojo se construye una rejilla de C×R vértices en el sistema local del ojo (s horizontal,
// t vertical, z profundidad). Cerrada: cubre la apertura desde el borde superior de la pestaña
// hasta el contorno inferior, apoyada en la superficie (z interpolada de los vértices cercanos)
// y adelantada LID_OFFSET. Abierta: cada columna se pliega en UN solo punto del contorno
// superior, hundido HIDE: sus triángulos tienen área cero y no dibujan ningún píxel.
const LID_OFFSET = 0.0025, LASH_OFFSET = 0.0035, HIDE = -0.002, LASH_W = 0.012; // metros
const COLS = 24, ROWS = 10;
const ATTRS = ['POSITION', 'NORMAL', 'TANGENT', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0'];
const srcAttr = Object.fromEntries(ATTRS.map((a2) => [a2, prim.getAttribute(a2)]));
const TAN = srcAttr.TANGENT.getArray();
const newPrims = [];

function buildPrimitive(name, verts, tris, uv) {
  // verts: [{ open, closed, normal, tangent }]
  const m = verts.length;
  const pos = new Float32Array(m * 3), nor = new Float32Array(m * 3), tan = new Float32Array(m * 4), tc = new Float32Array(m * 2);
  const jn = new (srcAttr.JOINTS_0.getArray().constructor)(m * 4), wt = new Float32Array(m * 4), blink = new Float32Array(m * 3);
  verts.forEach((v, k) => {
    pos.set(v.open, k * 3); nor.set(v.normal, k * 3); tan.set(v.tangent, k * 4); tc.set(uv, k * 2);
    jn[k * 4] = J.Head; wt[k * 4] = 1; // los ojos son 100 % Head (regla R1)
    blink.set(sub(v.closed, v.open), k * 3);
  });
  const acc = (suffix, type, arr) => doc.createAccessor(`${name}_${suffix}`).setType(type).setArray(arr).setBuffer(buffer);
  const p2 = doc.createPrimitive().setMaterial(prim.getMaterial()).setIndices(acc('idx', 'SCALAR', new Uint32Array(tris)))
    .setAttribute('POSITION', acc('pos', 'VEC3', pos)).setAttribute('NORMAL', acc('nor', 'VEC3', nor)).setAttribute('TANGENT', acc('tan', 'VEC4', tan))
    .setAttribute('TEXCOORD_0', acc('uv', 'VEC2', tc)).setAttribute('JOINTS_0', acc('j', 'VEC4', jn)).setAttribute('WEIGHTS_0', acc('w', 'VEC4', wt));
  return { prim: p2, blink, count: m };
}
function gridTris(cols, rows) {
  const t = []; const id = (j, i) => i * (cols + 1) + j;
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) t.push(id(j, i), id(j, i + 1), id(j + 1, i), id(j + 1, i), id(j, i + 1), id(j + 1, i + 1));
  return t;
}

for (const e of eyes) {
  const C = contours(e);
  // muestras de superficie: apertura + contorno + 2 anillos de piel alrededor
  const sampleSet = new Set([...e.open, ...e.liner]);
  for (let r = 0; r < 2; r++) for (const i of [...sampleSet]) for (const j of nbr[i]) if (front(j)) sampleSet.add(j);
  const samples = [...sampleSet].map((i) => ({ l: e.local(P(i)), nv: Nv(i), tg: [TAN[i * 4], TAN[i * 4 + 1], TAN[i * 4 + 2], TAN[i * 4 + 3]] }));
  function surf(s, t) { // z, normal y tangente interpoladas (IDW, 6 vecinos en el plano s,t)
    // Envolvente superior: el ojo es abombado; con la media el párpado quedaba por detrás
    // del iris en algunos puntos. Se toma la z máxima de los vecinos en un radio de 14 mm.
    const sorted = samples.map((q) => [Math.hypot(q.l[0] - s, q.l[1] - t), q]).sort((x, y) => x[0] - y[0]);
    const best = sorted.slice(0, 6);
    let wsum = 0, nv = [0, 0, 0], tg = [0, 0, 0];
    for (const [d, q] of best) { const w = 1 / (d * d + 1e-8); wsum += w; nv = add(nv, mul(q.nv, w)); tg = add(tg, mul(q.tg.slice(0, 3), w)); }
    let z = -Infinity; for (const [d, q] of sorted) { if (d > 0.014 && z > -Infinity) break; z = Math.max(z, q.l[2]); }
    return { z, normal: norm(nv), tangent: [...norm(tg), best[0][1].tg[3]] };
  }
  const loc = [...e.open].map((i) => e.local(P(i)));
  const s0 = Math.min(...loc.map((l) => l[0])) - 0.0015, s1 = Math.max(...loc.map((l) => l[0])) + 0.0015;
  const upperLiner = [...e.liner].map((i) => e.local(P(i))).filter((l) => l[1] > 0);
  const linerTopRaw = (s) => { let t = C.top(s); for (const l of upperLiner) if (Math.abs(l[0] - s) < 0.005) t = Math.max(t, l[1]); return t + 0.0008; };
  // borde superior suavizado (media móvil sobre las columnas): sin dientes en el párpado
  const topCols = Array.from({ length: COLS + 1 }, (_, j) => linerTopRaw(s0 + ((s1 - s0) * j) / COLS));
  for (let pass = 0; pass < 3; pass++) { const cp = topCols.slice(); for (let j = 0; j <= COLS; j++) topCols[j] = (cp[Math.max(0, j - 1)] + 2 * cp[j] + cp[Math.min(COLS, j + 1)]) / 4; }
  const linerTop = (s) => { const f = ((s - s0) / (s1 - s0)) * COLS; const j = Math.max(0, Math.min(COLS - 1, Math.floor(f))); const t = Math.max(0, Math.min(1, f - j)); return topCols[j] * (1 - t) + topCols[j + 1] * t; };
  const toWorld = (s, t, z) => add(add(add(e.c, mul(e.right, s)), mul(e.up, t)), mul(e.n, z));
  // Profundidad del párpado cerrado: envolvente suavizada (3 pasadas) y nunca por debajo de
  // la envolvente + 2,5 mm, para que ningún punto del ojo asome y la superficie no ondule.
  const grid = [];
  for (let i = 0; i <= ROWS; i++) for (let j = 0; j <= COLS; j++) {
    const s = s0 + ((s1 - s0) * j) / COLS;
    const tTop = linerTop(s), tBot = C.bot(s) - 0.0008;
    const t = tTop + ((tBot - tTop) * i) / ROWS;
    grid.push({ s, t, tTop, sc: surf(s, t), st: surf(s, tTop) });
  }
  let zs = grid.map((g) => g.sc.z);
  const gid = (j, i) => i * (COLS + 1) + j;
  for (let pass = 0; pass < 3; pass++) {
    const nz = zs.slice();
    for (let i = 0; i <= ROWS; i++) for (let j = 0; j <= COLS; j++) {
      let acc = 0, c2 = 0; for (const [dj, di] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) { const jj = j + dj, ii = i + di; if (jj < 0 || ii < 0 || jj > COLS || ii > ROWS) continue; acc += zs[gid(jj, ii)]; c2++; }
      nz[gid(j, i)] = acc / c2;
    }
    zs = nz;
  }
  const closedPos = grid.map((g, k) => toWorld(g.s, g.t, Math.max(zs[k], g.sc.z + 0.0025) + LID_OFFSET));
  // normales propias de la rejilla cerrada (superficie lisa: sombreado sin rayas)
  const gridNormal = (j, i) => {
    const P0 = closedPos[gid(Math.max(0, j - 1), i)], P1 = closedPos[gid(Math.min(COLS, j + 1), i)];
    const Q0 = closedPos[gid(j, Math.max(0, i - 1))], Q1 = closedPos[gid(j, Math.min(ROWS, i + 1))];
    let nn = norm(cross(sub(P1, P0), sub(Q0, Q1))); if (dot(nn, e.n) < 0) nn = mul(nn, -1); return nn;
  };
  const lidVerts = grid.map((g, k) => ({
    closed: closedPos[k], open: toWorld(g.s, g.tTop, g.st.z + HIDE), normal: gridNormal(k % (COLS + 1), Math.floor(k / (COLS + 1))), tangent: g.sc.tangent,
  }));
  const lashVerts = [];
  for (let i = 0; i <= 1; i++) for (let j = 0; j <= COLS; j++) {
    const s = s0 + ((s1 - s0) * j) / COLS;
    const tTop = linerTop(s), tBot = C.bot(s) - 0.0008;
    const t = tBot + (i === 0 ? LASH_W : 0);
    const sc = surf(s, t), st = surf(s, tTop);
    const zLid = Math.max(zs[gid(j, ROWS)], surf(s, tBot).z + 0.0025) + LID_OFFSET;
    lashVerts.push({ closed: toWorld(s, t, Math.max(sc.z + 0.0025 + LASH_OFFSET, zLid + (LASH_OFFSET - LID_OFFSET))), open: toWorld(s, tTop, st.z + HIDE), normal: sc.normal, tangent: sc.tangent });
  }
  // color de piel (vértice de piel justo encima del ojo) y de pestaña (el más oscuro del contorno)
  const topCenter = toWorld(0, linerTop(0) + 0.012, surf(0, linerTop(0)).z);
  let skinV = -1, bd = Infinity;
  for (const i of reps) if (front(i) && !e.open.has(i) && !e.liner.has(i) && skinLike(color[i])) { const d = dist(P(i), topCenter); if (d < bd) { bd = d; skinV = i; } }
  let lashV = -1, dv = Infinity; for (const i of e.liner) if (color[i][2] < dv) { dv = color[i][2]; lashV = i; }
  const side = e.side > 0 ? 'L' : 'R';
  const lid = buildPrimitive(`lid_${side}`, lidVerts, gridTris(COLS, ROWS), [UV[skinV * 2], UV[skinV * 2 + 1]]);
  const lash = buildPrimitive(`lash_${side}`, lashVerts, gridTris(COLS, 1), [UV[lashV * 2], UV[lashV * 2 + 1]]);
  newPrims.push(lid, lash);
  e.report = { rejilla_parpado: `${COLS}×${ROWS}`, ancho_ojo_mm: +((s1 - s0) * 1000).toFixed(1), alto_ojo_centro_mm: +((linerTop(0) - C.bot(0)) * 1000).toFixed(1), uv_piel: [UV[skinV * 2], UV[skinV * 2 + 1]], uv_pestana: [UV[lashV * 2], UV[lashV * 2 + 1]] };
}
report.parpados = eyes.map((e) => e.report);

// ------------------------------------------------------------- sonrisa (malla de la cara)
const isMouth = ([h, s, v]) => (h <= 20 || h >= 340) && s > 0.35 && v > 0.35;
const mouthSeeds = new Set(reps.filter((i) => front(i) && world[i * 3 + 1] < Math.min(...eyes.map((e) => e.c[1])) - 0.02 && isMouth(color[i])));
const mouth = components(mouthSeeds)[0] || [];
const mPts = mouth.map(P);
const mc = mul(mPts.reduce((a, p) => add(a, p), [0, 0, 0]), 1 / mPts.length);
const mN = norm(mouth.map(Nv).reduce((a, v) => add(a, v), [0, 0, 0]));
const mR = norm(cross([0, 1, 0], mN)), mU = norm(cross(mN, mR));
const mLocal = (p) => { const d = sub(p, mc); return [dot(d, mR), dot(d, mU), dot(d, mN)]; };
const hw = Math.max(...mPts.map((p) => Math.abs(mLocal(p)[0])));
const smile = new Float32Array(n * 3);
let smileVerts = 0;
for (let i = 0; i < n; i++) {
  if (region[i] !== 1) continue;
  const l = mLocal(P(i)); const r = Math.hypot(l[0] / (hw * 1.9), l[1] / (hw * 1.3));
  if (r >= 1 || l[2] < -hw) continue;
  const f = 1 - smoothstep(0.35, 1, r);
  const sx = Math.max(-1.3, Math.min(1.3, l[0] / hw));
  const lift = 0.16 * hw * sx * sx * f;           // comisuras hacia arriba, centro quieto
  const widen = 0.06 * hw * sx * f;               // un poco más ancha
  const cheek = 0.05 * hw * f * smoothstep(0.2, 0.9, Math.abs(sx)) * (l[1] > 0 ? 1 : 0.4); // mejillas arriba
  const d = add(mul(mU, lift + cheek), mul(mR, widen));
  smile.set(d, i * 3); smileVerts++;
}
report.sonrisa = { vertices_boca: mouth.length, semiancho_boca_m: +hw.toFixed(4), vertices_deformados: smileVerts };

// ------------------------------------------------------------- corrector de axila (wave)
// Pose máxima del saludo leída de la propia animación 'wave' (instante con el antebrazo centrado).
const waveAnim = root.listAnimations().find((a) => a.getName() === 'wave');
const T_PEAK = 1.15;
const CORR_ITERS = Number(process.env.CORR_ITERS || 4), CORR_R = Number(process.env.CORR_R || 0.13);
function sampleAt(sampler, t) {
  const tin = sampler.getInput().getArray(), out = sampler.getOutput().getArray(), es = sampler.getOutput().getElementSize();
  let k = tin.findIndex((x) => x >= t); if (k <= 0) k = 1; const t0 = tin[k - 1], t1 = tin[k], f = (t - t0) / (t1 - t0 || 1);
  const a = out.slice((k - 1) * es, k * es), b = out.slice(k * es, (k + 1) * es);
  const r = Array.from(a, (v, e) => v + (b[e] - v) * f); if (es === 4) { const l = Math.hypot(...r); return r.map((v) => v / l); } return r;
}
const saved = new Map();
for (const ch of waveAnim.listChannels()) {
  const node = ch.getTargetNode(); if (ch.getTargetPath() !== 'rotation') continue;
  saved.set(node, node.getRotation()); node.setRotation(sampleAt(ch.getSampler(), T_PEAK));
}
const Ms = joints.map((j, k) => mat4mul(j.getWorldMatrix(), Array.from(ibm.slice(k * 16, k * 16 + 16))));
for (const [node, q] of saved) node.setRotation(q);
const JA = prim.getAttribute('JOINTS_0').getArray(), WA = prim.getAttribute('WEIGHTS_0').getArray();
function skinMat(i) { const m = new Array(16).fill(0); for (let k = 0; k < 4; k++) { const w = WA[i * 4 + k]; if (!w) continue; const M = Ms[JA[i * 4 + k]]; for (let e = 0; e < 16; e++) m[e] += w * M[e]; } return m; }
const apply = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
const applyLin = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2], m[1] * p[0] + m[5] * p[1] + m[9] * p[2], m[2] * p[0] + m[6] * p[1] + m[10] * p[2]];
function inv3(m) { // inversa de la parte lineal 3x3 (columnas)
  const a = m[0], b = m[4], c = m[8], d = m[1], e2 = m[5], f = m[9], g = m[2], h = m[6], k = m[10];
  const A = e2 * k - f * h, B = -(d * k - f * g), C2 = d * h - e2 * g; const det = a * A + b * B + c * C2;
  const r = [A, B, C2, -(b * k - c * h), a * k - c * g, -(a * h - b * g), b * f - c * e2, -(a * f - c * d), a * e2 - b * d].map((v) => v / det);
  return [r[0], r[1], r[2], 0, r[3], r[4], r[5], 0, r[6], r[7], r[8], 0, 0, 0, 0, 1];
}
const zoneC = []; const inC = new Uint8Array(n);
for (const i of reps) if (region[i] !== 1 && region[i] !== 2 && dist(P(i), jpos.LeftArm) < CORR_R) { zoneC.push(i); inC[i] = 1; }
const boundaryC = new Uint8Array(n); for (const i of zoneC) for (const j of nbr[i]) if (!inC[j]) boundaryC[i] = 1;
const posed = new Map(), restP = new Map();
for (const i of zoneC) { restP.set(i, P(i)); posed.set(i, apply(skinMat(i), P(i))); }
function smoothSet(vals, iters) {
  let cur = new Map(vals);
  for (let it = 0; it < iters; it++) {
    const next = new Map();
    for (const i of zoneC) {
      if (boundaryC[i]) { next.set(i, cur.get(i)); continue; }
      let acc = [0, 0, 0], c = 0; for (const j of nbr[i]) if (inC[j]) { acc = add(acc, cur.get(j)); c++; }
      next.set(i, c ? add(mul(cur.get(i), 0.5), mul(acc, 0.5 / c)) : cur.get(i));
    }
    cur = next;
  }
  return cur;
}
const restS = smoothSet(restP, CORR_ITERS), posedS = smoothSet(posed, CORR_ITERS);
const corrector = new Float32Array(n * 3);
let corrMax = 0;
for (const i of zoneC) {
  const M = skinMat(i);
  const delta = sub(restP.get(i), restS.get(i));
  const corrected = add(posedS.get(i), applyLin(M, delta));
  const b = [M[12], M[13], M[14]];
  const pNew = applyLin(inv3(M), sub(corrected, b));
  const fall = 1 - smoothstep(CORR_R * 0.65, CORR_R, dist(P(i), jpos.LeftArm));
  const d = mul(sub(pNew, P(i)), fall);
  corrector.set(d, i * 3); corrMax = Math.max(corrMax, Math.hypot(...d));
}
report.corrector_axila = { vertices_zona: zoneC.length, desplazamiento_max_mm: +(corrMax * 1000).toFixed(2), instante_pose_s: T_PEAK };

// Copiar a duplicados de costura (todas las arrays por vértice)
for (let i = 0; i < n; i++) if (weld[i] !== i) for (const arr of [smile, corrector]) for (let e = 0; e < 3; e++) arr[i * 3 + e] = arr[weld[i] * 3 + e];

// ------------------------------------------------------------- morph targets en la malla
const TARGETS = useCorrector ? ['blink', 'smile', 'wave_corrector'] : ['blink', 'smile'];
const target = (name, arr) => doc.createPrimitiveTarget(name).setAttribute('POSITION', doc.createAccessor(`${name}_${Math.random().toString(36).slice(2, 7)}`).setType('VEC3').setArray(arr).setBuffer(buffer));
prim.addTarget(target('blink', new Float32Array(n * 3))).addTarget(target('smile', smile));
if (useCorrector) prim.addTarget(target('wave_corrector', corrector));
const mesh = root.listMeshes()[0];
for (const np of newPrims) {
  np.prim.addTarget(target('blink', np.blink)).addTarget(target('smile', new Float32Array(np.count * 3)));
  if (useCorrector) np.prim.addTarget(target('wave_corrector', new Float32Array(np.count * 3)));
  mesh.addPrimitive(np.prim);
}
mesh.setWeights(TARGETS.map(() => 0)).setExtras({ ...mesh.getExtras(), targetNames: TARGETS });

// ------------------------------------------------------------- pesos de expresión en las animaciones
const meshNode = R.meshNode;
const FPS = 30;
const blinkCurve = (t, t0) => { const d = t - t0; if (d < 0 || d > 0.26) return 0; if (d < 0.08) return d / 0.08; if (d < 0.12) return 1; return 1 - (d - 0.12) / 0.14; };
function addWeights(anim, duration, fn) {
  const steps = Math.round(duration * FPS);
  const times = new Float32Array(steps + 1).map((_, k) => (k / steps) * duration);
  const out = new Float32Array((steps + 1) * TARGETS.length);
  times.forEach((t, k) => out.set(fn(t).slice(0, TARGETS.length), k * TARGETS.length));
  const s2 = doc.createAnimationSampler().setInput(doc.createAccessor(`${anim.getName()}_wt`).setType('SCALAR').setArray(times).setBuffer(buffer))
    .setOutput(doc.createAccessor(`${anim.getName()}_w`).setType('SCALAR').setArray(out).setBuffer(buffer)).setInterpolation('LINEAR');
  anim.addSampler(s2).addChannel(doc.createAnimationChannel().setTargetNode(meshNode).setTargetPath('weights').setSampler(s2));
}
const byName = Object.fromEntries(root.listAnimations().map((a) => [a.getName(), a]));
const ease = (t) => t * t * (3 - 2 * t);
const ramp = (t, a, b) => ease(Math.min(1, Math.max(0, (t - a) / (b - a))));
// Con el brazo arriba, el corrector sigue a la subida del brazo (misma curva que wave en fix-rig.mjs)
const armUp = (t) => (t < 0.55 ? ramp(t, 0, 0.55) : t < 2.55 ? 1 : 1 - ramp(t, 2.55, 3.2));
addWeights(byName.idle, 4, (t) => [Math.max(blinkCurve(t, 1.3), blinkCurve(t, 3.35)), 0, 0]);
addWeights(byName.wave, 3.2, (t) => { const s = t < 0.45 ? ramp(t, 0.05, 0.45) : t < 2.6 ? 1 : 1 - ramp(t, 2.6, 3.15); return [Math.max(0.18 * s, blinkCurve(t, 1.9)), s, armUp(t)]; });
addWeights(byName.curious, 2.6, (t) => [blinkCurve(t, 0.62), 0.25 * ramp(t, 0.5, 0.9) * (1 - ramp(t, 1.9, 2.5)), 0]);
// Clips de expresión sueltos
addWeights(doc.createAnimation('blink'), 0.3, (t) => [blinkCurve(t, 0.02), 0, 0]);
addWeights(doc.createAnimation('smile'), 1.6, (t) => { const s = t < 0.35 ? ramp(t, 0, 0.35) : t < 1.2 ? 1 : 1 - ramp(t, 1.2, 1.6); return [0.18 * s, s, 0]; });

await io.write(output, doc);
report.morph_targets = TARGETS;
report.animaciones = root.listAnimations().map((a) => a.getName());
if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
