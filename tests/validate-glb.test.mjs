// Pruebas del validador con GLB sintéticos construidos en memoria.
// Ejecutar: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseGlb, validateGlb, imageSize } from '../tools/validate-glb.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(readFileSync(path.join(here, '..', 'spec', 'rufi.character.json'), 'utf8'));

/** Construye un GLB mínimo a partir de un objeto JSON glTF y un BIN opcional. */
function makeGlb(json, bin = new Uint8Array(0)) {
  const pad = (u8, byte) => {
    const n = (4 - (u8.length % 4)) % 4;
    const out = new Uint8Array(u8.length + n);
    out.set(u8);
    out.fill(byte, u8.length);
    return out;
  };
  const j = pad(new TextEncoder().encode(JSON.stringify(json)), 0x20);
  const b = pad(bin, 0);
  const total = 12 + 8 + j.length + (b.length ? 8 + b.length : 0);
  const buf = new Uint8Array(total);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, j.length, true);
  dv.setUint32(16, 0x4e4f534a, true);
  buf.set(j, 20);
  if (b.length) {
    const o = 20 + j.length;
    dv.setUint32(o, b.length, true);
    dv.setUint32(o + 4, 0x004e4942, true);
    buf.set(b, o + 8);
  }
  return Buffer.from(buf);
}

/** glTF que cumple el contrato (sin geometría real: solo nombres y recuentos). */
function compliantJson() {
  const bones = spec.rig.huesos.filter((b) => b.deform).map((b) => b.nombre);
  const nodes = bones.map((name) => ({ name }));
  nodes.push({ name: 'Rufi_Body', mesh: 0, skin: 0 });
  return {
    asset: { version: '2.0' },
    nodes,
    skins: [{ joints: bones.map((_, i) => i) }],
    meshes: [{
      name: spec.shape_keys.mesh,
      primitives: [{ attributes: { POSITION: 0 }, indices: 1 }],
      extras: { targetNames: [...spec.shape_keys.obligatorias] },
    }],
    accessors: [
      { count: 3000, type: 'VEC3', componentType: 5126 },
      { count: 3000 * 3, type: 'SCALAR', componentType: 5125 },
    ],
    animations: [...spec.clips.obligatorios, ...spec.clips.recomendados].map((c) => ({ name: c.nombre, channels: [], samplers: [] })),
  };
}

test('un GLB que cumple el contrato es válido y sin avisos', () => {
  const res = validateGlb(makeGlb(compliantJson()), spec);
  assert.deepEqual(res.errors, []);
  assert.deepEqual(res.warnings, []);
  assert.equal(res.stats.triangles, 3000);
  assert.equal(res.stats.joints, 25);
  assert.equal(res.stats.morphTargets, spec.shape_keys.obligatorias.length);
});

test('rechaza archivos que no son GLB o con longitud incorrecta', () => {
  assert.match(validateGlb(Buffer.from('hola mundo, esto no es un glb'), spec).errors[0], /No es un GLB/);
  const glb = makeGlb(compliantJson());
  new DataView(glb.buffer, glb.byteOffset).setUint32(8, glb.length + 4, true);
  assert.match(validateGlb(glb, spec).errors[0], /Longitud declarada/);
});

test('detecta huesos, shape keys y clips que faltan', () => {
  const j = compliantJson();
  j.nodes.find((n) => n.name === 'eye_L').name = 'Eye_Left';
  j.meshes[0].extras.targetNames = j.meshes[0].extras.targetNames.filter((n) => n !== 'blink_R');
  j.animations = j.animations.filter((a) => a.name !== 'greet_wave' && a.name !== 'boop');
  const { errors, warnings } = validateGlb(makeGlb(j), spec);
  assert.ok(errors.some((e) => e.includes('Faltan huesos') && e.includes('eye_L')));
  assert.ok(errors.some((e) => e.includes('Faltan shape keys') && e.includes('blink_R')));
  assert.ok(errors.some((e) => e.includes('Faltan clips obligatorios') && e.includes('greet_wave')));
  assert.ok(warnings.some((w) => w.includes('boop')));
});

test('los nombres del contrato no llevan puntos (three.js los elimina)', () => {
  const names = [...spec.rig.huesos.map((b) => b.nombre), ...spec.shape_keys.obligatorias, ...spec.clips.obligatorios.map((c) => c.nombre)];
  assert.deepEqual(names.filter((n) => n.includes('.')), []);
});

test('tolera nombres saneados y avisa de huesos con punto', () => {
  const j = compliantJson();
  for (const n of j.nodes) n.name = n.name.replace(/_(L|R)$/, '.$1');
  const res = validateGlb(makeGlb(j), spec);
  assert.deepEqual(res.errors, []);
  assert.ok(res.warnings.some((w) => w.includes("Huesos con '.'")));
  for (const n of j.nodes) n.name = n.name.replace('.', '');
  assert.deepEqual(validateGlb(makeGlb(j), spec).errors, []);
});

test('bloquea la maqueta PROXY salvo con allowProxy', () => {
  const j = compliantJson();
  j.nodes.push({ name: 'PROXY_Head' });
  assert.ok(validateGlb(makeGlb(j), spec).errors.some((e) => e.includes('maqueta')));
  assert.deepEqual(validateGlb(makeGlb(j), spec, { allowProxy: true }).errors, []);
});

test('aplica el presupuesto de triángulos, huesos y extensiones', () => {
  const j = compliantJson();
  j.accessors[1].count = (spec.presupuesto_web.triangulos_objetivo + 1) * 3;
  let res = validateGlb(makeGlb(j), spec);
  assert.deepEqual(res.errors, []);
  assert.ok(res.warnings.some((w) => w.startsWith('Triángulos')));
  j.accessors[1].count = (spec.presupuesto_web.triangulos_max + 1) * 3;
  j.extensionsUsed = ['KHR_materials_transmission'];
  for (let i = 0; i < 20; i++) { j.nodes.push({ name: `extra_${i}` }); j.skins[0].joints.push(j.nodes.length - 1); }
  res = validateGlb(makeGlb(j), spec);
  assert.ok(res.errors.some((e) => e.startsWith('Triángulos')));
  assert.ok(res.errors.some((e) => e.includes('KHR_materials_transmission')));
  assert.ok(res.errors.some((e) => e.includes('Demasiados huesos')));
});

test('rechaza shape keys con expresiones prohibidas por la marca', () => {
  const j = compliantJson();
  j.meshes[0].extras.targetNames.push('cara_enfado');
  assert.ok(validateGlb(makeGlb(j), spec).errors.some((e) => e.includes('prohibidas')));
});

test('mide texturas PNG embebidas y avisa si superan el máximo', () => {
  const png = new Uint8Array(33);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const dv = new DataView(png.buffer);
  dv.setUint32(16, 2048);
  dv.setUint32(20, 1024);
  assert.deepEqual(imageSize(png), { width: 2048, height: 1024, type: 'png' });
  const j = compliantJson();
  j.images = [{ name: 'T_Rufi_Base', mimeType: 'image/png', bufferView: 0 }];
  j.bufferViews = [{ buffer: 0, byteOffset: 0, byteLength: png.length }];
  j.buffers = [{ byteLength: 36 }];
  const res = validateGlb(makeGlb(j, png), spec);
  assert.ok(res.warnings.some((w) => w.includes('2048×1024')));
});

test('parseGlb devuelve JSON y BIN', () => {
  const { json, bin } = parseGlb(makeGlb({ asset: { version: '2.0' } }, new Uint8Array([1, 2, 3, 4])));
  assert.equal(json.asset.version, '2.0');
  assert.deepEqual([...bin], [1, 2, 3, 4]);
});

// Si existe el GLB de la maqueta exportado con Blender (build/), se valida de verdad.
const proxyGlb = path.join(here, '..', 'build', 'rufi_proxy.glb');
test('GLB real de la maqueta exportado por Blender (si existe)', { skip: !existsSync(proxyGlb) && 'build/rufi_proxy.glb no generado (npm run pipeline:proxy)' }, () => {
  const buf = readFileSync(proxyGlb);
  assert.ok(validateGlb(buf, spec).errors.some((e) => e.includes('maqueta')));
  const res = validateGlb(buf, spec, { allowProxy: true });
  assert.deepEqual(res.errors, []);
  assert.equal(res.stats.joints, 25);
  assert.equal(res.stats.animations.length, spec.clips.obligatorios.length);
});
