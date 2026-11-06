#!/usr/bin/env node
/**
 * Optimiza el GLB de Rufi para la web sin tocar el esqueleto ni las animaciones.
 *
 * Uso:
 *   node tools/optimize-model.mjs entrada.glb salida.glb [--ratio 0.1] [--error 0.001]
 *        [--tex 1024] [--normal-tex 1024] [--mr-tex 512] [--quality 82] [--no-meshopt]
 *
 * Pasos (en este orden):
 *   1. dedup + prune: elimina datos repetidos o sin uso.
 *   2. (Opcional, --drop-tangents) quita el atributo TANGENT. Por defecto se CONSERVA:
 *      el mapa de normales se horneó con esas tangentes y, sin ellas, three.js usa otras
 *      calculadas en pantalla que producen rayas oscuras (comprobado con Rufi).
 *   3. weld + simplificación con atributos (meshoptimizer simplifyWithAttributes):
 *      reduce triángulos teniendo en cuenta posición, NORMALES y UV, para que el mapa
 *      de normales siga encajando (la simplificación solo por posición deja rayas
 *      oscuras en ojos y bajo el pañuelo: comprobado). Pesos e índices de huesos se
 *      conservan en los vértices que quedan. --ratio = fracción de triángulos a conservar;
 *      --error = desviación máxima permitida (relativa al tamaño del modelo).
 *      --position-only usa el simplify estándar de glTF-Transform (solo posición).
 *   4. resample: elimina claves de animación redundantes (sin cambiar el movimiento).
 *   5. Texturas a WebP redimensionadas por tipo: color, normales y metal/rugosidad.
 *   6. quantize + EXT_meshopt_compression: compresión de geometría y animación.
 *
 * --quantize-position N: bits de cuantización de posiciones (14 por defecto; 16 conserva mejor la cara).
 * --skip-textures deja las texturas como están (para un segundo paso sin recomprimirlas).
 *
 * Nunca modifica el archivo de entrada.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, resample, quantize, meshopt, textureCompress, compactPrimitive } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import { statSync } from 'node:fs';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const [input, output] = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !all[i - 1]?.startsWith('--'));
if (!input || !output) {
  console.error('Uso: node tools/optimize-model.mjs entrada.glb salida.glb [--ratio 0.1] [--error 0.001] [--tex 1024]');
  process.exit(2);
}
const opts = {
  ratio: Number(arg('ratio', '0.1')),
  error: Number(arg('error', '0.001')),
  tex: Number(arg('tex', '1024')),
  normalTex: Number(arg('normal-tex', arg('tex', '1024'))),
  mrTex: Number(arg('mr-tex', '512')),
  quality: Number(arg('quality', '82')),
  meshopt: !process.argv.includes('--no-meshopt'),
  dropTangents: process.argv.includes('--drop-tangents'),
  skipTextures: process.argv.includes('--skip-textures'),
  quantizePosition: Number(arg('quantize-position', '14')),
  positionOnly: process.argv.includes('--position-only'),
  normalWeight: Number(arg('normal-weight', '1')),
  uvWeight: Number(arg('uv-weight', '1')),
};

await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;
await MeshoptDecoder.ready;

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const doc = await io.read(input);
const root = doc.getRoot();

const count = () => {
  let tris = 0;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      tris += (idx ? idx.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
    }
  }
  return Math.round(tris);
};
const before = { tris: count(), bytes: statSync(input).size };

await doc.transform(dedup(), prune());

if (opts.dropTangents) {
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (prim.getAttribute('TANGENT')) prim.setAttribute('TANGENT', null);
    }
  }
}

/** Simplificación por atributos: posición + normal + UV. */
function simplifyWithAttributes(prim) {
  const pos = prim.getAttribute('POSITION');
  const nor = prim.getAttribute('NORMAL');
  const uv = prim.getAttribute('TEXCOORD_0');
  const idx = prim.getIndices();
  if (!idx || !nor) return;
  const n = pos.getCount();
  const positions = new Float32Array(pos.getArray());
  const stride = 3 + (uv ? 2 : 0);
  const attrs = new Float32Array(n * stride);
  const v3 = [0, 0, 0];
  const v2 = [0, 0];
  for (let i = 0; i < n; i++) {
    nor.getElement(i, v3);
    attrs.set(v3, i * stride);
    if (uv) { uv.getElement(i, v2); attrs.set(v2, i * stride + 3); }
  }
  const weights = [opts.normalWeight, opts.normalWeight, opts.normalWeight];
  if (uv) weights.push(opts.uvWeight, opts.uvWeight);
  const src = new Uint32Array(idx.getArray());
  const target = Math.floor((src.length / 3) * opts.ratio) * 3;
  const [dst] = MeshoptSimplifier.simplifyWithAttributes(src, positions, 3, attrs, stride, weights, null, target, opts.error, []);
  idx.setArray(new Uint32Array(dst));
  compactPrimitive(prim);
}

if (opts.ratio < 1) {
  await doc.transform(weld());
  if (opts.positionOnly) {
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: opts.ratio, error: opts.error }));
  } else {
    for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) simplifyWithAttributes(prim);
  }
}
await doc.transform(resample(), prune());

// Texturas por tipo: el mapa de normales necesita más calidad que el color.
if (!opts.skipTextures) await doc.transform(
  textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^baseColor/, resize: [opts.tex, opts.tex], quality: opts.quality }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^normal/, resize: [opts.normalTex, opts.normalTex], quality: Math.min(95, opts.quality + 8) }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^metallicRoughness/, resize: [opts.mrTex, opts.mrTex], quality: opts.quality }),
);

if (opts.meshopt) {
  await doc.transform(quantize({ quantizePosition: opts.quantizePosition }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
}

await io.write(output, doc);
const after = { tris: count(), bytes: statSync(output).size };
const kb = (b) => `${(b / 1024).toFixed(1)} KB`;
console.log(JSON.stringify({
  entrada: { archivo: input, triangulos: before.tris, tamano: kb(before.bytes) },
  salida: { archivo: output, triangulos: after.tris, tamano: kb(after.bytes) },
  reduccion_tamano: `${(100 * (1 - after.bytes / before.bytes)).toFixed(1)} %`,
  opciones: opts,
}, null, 2));
