/**
 * Regiones anatómicas de Rufi a partir de la malla y la textura (sin usar los pesos):
 * pañuelo (color verde de la textura), cabeza (por encima del pivote de Head),
 * barriga (frente del tronco) y piernas. Compartido por fix-rig.mjs y los informes.
 */
import sharp from 'sharp';

export function mat4mulVec(m, x, y, z) {
  return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
}

export function mat4mul(a, b) {
  const r = new Array(16).fill(0);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) r[j * 4 + i] += a[k * 4 + i] * b[j * 4 + k];
  return r;
}

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6; else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, max ? d / max : 0, max];
}

/** Devuelve datos de la malla y las regiones. */
export async function computeRegions(doc) {
  const root = doc.getRoot();
  const meshNode = root.listNodes().find((n) => n.getMesh() && n.getSkin());
  const skin = meshNode.getSkin();
  const prim = meshNode.getMesh().listPrimitives()[0];
  const pos = prim.getAttribute('POSITION').getArray();
  const uv = prim.getAttribute('TEXCOORD_0').getArray();
  const n = pos.length / 3;
  // En glTF una malla con skin ignora la transformación de su nodo: la posición real en
  // reposo es jointWorld · inverseBind · posición (igual para todas las articulaciones si
  // la pose de reposo es la de unión, comprobado en este modelo).
  const joints = skin.listJoints();
  const ibm = skin.getInverseBindMatrices().getArray();
  const W = mat4mul(joints[0].getWorldMatrix(), Array.from(ibm.slice(0, 16)));
  const world = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) world.set(mat4mulVec(W, pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]), i * 3);
  const jname = joints.map((j) => j.getName().replace('mixamorig:', ''));
  const jpos = Object.fromEntries(joints.map((j, k) => [jname[k], j.getWorldMatrix().slice(12, 15)]));

  // Textura base → color en el UV de cada vértice
  const tex = prim.getMaterial().getBaseColorTexture().getImage();
  const { data, info } = await sharp(Buffer.from(tex)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const green = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const u = ((uv[i * 2] % 1) + 1) % 1, v = ((uv[i * 2 + 1] % 1) + 1) % 1;
    const x = Math.min(info.width - 1, Math.floor(u * info.width)), y = Math.min(info.height - 1, Math.floor(v * info.height));
    const o = (y * info.width + x) * 3;
    const [h, s, val] = rgbToHsv(data[o], data[o + 1], data[o + 2]);
    green[i] = h >= 40 && h <= 110 && s > 0.15 && val < 0.9 ? 1 : 0;
  }

  // Adyacencia por índices + vértices coincidentes en posición (costuras UV)
  const idx = prim.getIndices().getArray();
  const key = (i) => `${Math.round(world[i * 3] * 1e5)},${Math.round(world[i * 3 + 1] * 1e5)},${Math.round(world[i * 3 + 2] * 1e5)}`;
  const weld = new Int32Array(n); const seen = new Map();
  for (let i = 0; i < n; i++) { const k = key(i); if (!seen.has(k)) seen.set(k, i); weld[i] = seen.get(k); }
  const nbrSets = Array.from({ length: n }, () => new Set());
  for (let t = 0; t < idx.length; t += 3) {
    const a = weld[idx[t]], b = weld[idx[t + 1]], c = weld[idx[t + 2]];
    nbrSets[a].add(b); nbrSets[a].add(c); nbrSets[b].add(a); nbrSets[b].add(c); nbrSets[c].add(a); nbrSets[c].add(b);
  }
  const nbr = nbrSets.map((s) => [...s]);

  // Pañuelo: verde en la textura, en la franja del cuello, limpiado por vecinos (2 pasadas de mayoría)
  const yNeckLow = jpos.Spine1[1], yNeckHigh = jpos.Head[1] + 0.06;
  let scarf = new Uint8Array(n);
  for (let i = 0; i < n; i++) scarf[i] = green[weld[i]] || green[i] ? (world[i * 3 + 1] > yNeckLow && world[i * 3 + 1] < yNeckHigh ? 1 : 0) : 0;
  for (let pass = 0; pass < 2; pass++) {
    const next = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const r = weld[i]; const ns = nbr[r]; if (!ns.length) { next[i] = scarf[i]; continue; }
      let c = 0; for (const j of ns) c += scarf[j]; next[i] = c * 2 > ns.length ? 1 : (c * 4 < ns.length ? 0 : scarf[r]);
    }
    for (let i = 0; i < n; i++) next[i] = next[weld[i]];
    scarf = next;
  }

  const headY = jpos.Head[1];
  const region = new Uint8Array(n); // 0 cuerpo, 1 cabeza, 2 pañuelo, 3 barriga, 4 pierna, 5 brazo
  const armX = Math.abs(jpos.LeftArm[0] - jpos.RightArm[0]) / 2;
  for (let i = 0; i < n; i++) {
    const x = world[i * 3], y = world[i * 3 + 1], z = world[i * 3 + 2];
    if (scarf[i]) region[i] = 2;
    else if (y > headY) region[i] = 1;
    else if (Math.abs(x - jpos.Hips[0]) > armX * 0.92 && y > jpos.LeftHand[1] - 0.12 && y < headY) region[i] = 5;
    else if (y < jpos.LeftUpLeg[1] - 0.02) region[i] = 4;
    else region[i] = 3;
  }
  return { meshNode, skin, prim, n, world, jname, jpos, weld, nbr, region, idx };
}
