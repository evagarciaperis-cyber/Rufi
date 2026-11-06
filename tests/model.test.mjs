// Pruebas del modelo 3D real (fase 2). Ejecutar: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { inspectGlb } from '../tools/inspect-model.mjs';
import { validateGlb, imageSize } from '../tools/validate-glb.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const spec = JSON.parse(readFileSync(path.join(root, 'spec', 'rufi.character.json'), 'utf8'));
const web = path.join(root, 'models', 'rufi.web.glb');
const original = path.join(root, 'models', 'original', 'rufianimado.glb');
const ORIGINAL_SHA = 'df02630d9afe795f0e295739394c1da76bb9fc4d834f170f90372f7385996b20';
const CLIPS = ['Idle_11', 'Idle_15', 'Walking', 'Running'];

test('el modelo web existe y cumple el presupuesto de la especificación', () => {
  const buf = readFileSync(web);
  const r = inspectGlb(buf);
  assert.ok(buf.length / 1024 <= spec.presupuesto_web.glb_objetivo_kb, `${buf.length / 1024} KB`);
  assert.ok(r.triangulos <= spec.presupuesto_web.triangulos_max, `${r.triangulos} triángulos`);
  for (const img of r.imagenes) {
    assert.equal(img.tipo, 'image/webp');
    assert.ok(img.ancho <= spec.presupuesto_web.texturas_max_px && img.alto <= spec.presupuesto_web.texturas_max_px);
  }
  const { errors } = validateGlb(buf, spec);
  assert.ok(!errors.some((e) => e.startsWith('Extensión no permitida') || e.startsWith('Triángulos') || e.startsWith('Tamaño')), errors.join('\n'));
});

test('el modelo web conserva el esqueleto y las 4 animaciones', () => {
  const r = inspectGlb(readFileSync(web));
  assert.equal(r.esqueletos.length, 1);
  assert.equal(r.esqueletos[0].huesos, 24);
  assert.deepEqual(r.animaciones.map((a) => a.nombre).sort(), [...CLIPS].sort());
  const dur = Object.fromEntries(r.animaciones.map((a) => [a.nombre, a.duracion_s]));
  assert.deepEqual(dur, { Running: 0.633, Walking: 1.033, Idle_11: 1.867, Idle_15: 7 });
  const mesh = r.mallas[0].primitivas[0];
  assert.ok(mesh.atributos.includes('JOINTS_0') && mesh.atributos.includes('WEIGHTS_0'));
  assert.ok(mesh.atributos.includes('TANGENT'), 'las tangentes deben conservarse (sin ellas aparecen rayas)');
});

test('la correspondencia Mixamo → contrato nombra huesos que existen en el modelo', () => {
  const map = JSON.parse(readFileSync(path.join(root, 'spec', 'rig-mapping-mixamo.json'), 'utf8'));
  const bones = new Set(inspectGlb(readFileSync(web)).esqueletos[0].jerarquia.map((h) => h.nombre));
  const contract = spec.rig.huesos.map((b) => b.nombre);
  assert.deepEqual(Object.keys(map.huesos).sort(), [...contract].sort());
  for (const [name, m] of Object.entries(map.huesos)) {
    if (m.mixamo) assert.ok(bones.has(m.mixamo), `${name} → ${m.mixamo} no existe`);
  }
});

test('imageSize lee WebP con pérdida (VP8)', () => {
  const b = new Uint8Array(30);
  b.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);
  b[26] = 0x00; b[27] = 0x04; b[28] = 0x00; b[29] = 0x02; // 1024 × 512
  assert.deepEqual(imageSize(b), { width: 1024, height: 512, type: 'webp' });
});

// El original está en Git LFS: si se clonó sin descargarlo, es un puntero de texto.
const isLfsPointer = existsSync(original) && readFileSync(original).subarray(0, 40).toString().startsWith('version https://git-lfs');
test('el original está intacto (si está descargado de Git LFS)', { skip: (!existsSync(original) || isLfsPointer) && 'original no descargado (git lfs pull)' }, () => {
  const buf = readFileSync(original);
  assert.equal(createHash('sha256').update(buf).digest('hex'), ORIGINAL_SHA);
  const r = inspectGlb(buf);
  assert.equal(r.triangulos, 270410);
  assert.deepEqual(r.animaciones.map((a) => a.nombre).sort(), [...CLIPS].sort());
});

// Fase 3: modelo A-pose con pesos corregidos y animaciones propias
const animado = path.join(root, 'models', 'rufi-animado.web.glb');
test('rufi-animado.web.glb: presupuesto web y animaciones idle, wave y curious', () => {
  const buf = readFileSync(animado);
  const r = inspectGlb(buf);
  assert.ok(buf.length / 1024 <= spec.presupuesto_web.glb_objetivo_kb, `${buf.length / 1024} KB`);
  assert.ok(r.triangulos <= spec.presupuesto_web.triangulos_max);
  assert.deepEqual(r.animaciones.map((a) => a.nombre).sort(), ['curious', 'idle', 'wave']);
  const dur = Object.fromEntries(r.animaciones.map((a) => [a.nombre, a.duracion_s]));
  assert.deepEqual(dur, { idle: 4, wave: 3.2, curious: 2.6 });
  assert.equal(r.esqueletos[0].huesos, 24);
  assert.ok(!r.animaciones.some((a) => /Walking|Running/.test(a.nombre)), 'no debe incluir Walking/Running');
  for (const img of r.imagenes) assert.ok(img.ancho <= 1024 && img.alto <= 1024);
});
