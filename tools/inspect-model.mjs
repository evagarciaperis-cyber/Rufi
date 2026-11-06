#!/usr/bin/env node
/**
 * Informe técnico de un GLB (sin dependencias): esqueleto, mallas, materiales,
 * texturas, animaciones, extensiones y tamaño.
 *
 * Uso:
 *   node tools/inspect-model.mjs archivo.glb [--json]
 *
 * Complementa a tools/validate-glb.mjs: aquel comprueba el contrato de la
 * especificación; este describe lo que el archivo contiene de verdad.
 */
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseGlb, imageSize } from './validate-glb.mjs';

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/** Devuelve el informe de un GLB ya leído en memoria. */
export function inspectGlb(buf) {
  const { json, bin } = parseGlb(buf);
  const nodes = json.nodes || [];
  const parentOf = new Map();
  nodes.forEach((n, i) => (n.children || []).forEach((c) => parentOf.set(c, i)));

  const meshes = (json.meshes || []).map((m) => ({
    nombre: m.name,
    primitivas: m.primitives.map((p) => {
      const pos = json.accessors[p.attributes.POSITION];
      const tris = p.indices != null ? json.accessors[p.indices].count / 3 : pos.count / 3;
      return {
        vertices: pos.count,
        triangulos: Math.round(tris),
        atributos: Object.keys(p.attributes),
        morph_targets: (p.targets || []).length,
        material: p.material != null ? json.materials[p.material]?.name ?? p.material : null,
      };
    }),
    nombres_morph: m.extras?.targetNames || [],
  }));

  const skins = (json.skins || []).map((s) => ({
    huesos: s.joints.length,
    raiz: s.skeleton != null ? nodes[s.skeleton]?.name : null,
    jerarquia: s.joints.map((j) => ({
      nombre: nodes[j].name,
      padre: parentOf.has(j) ? nodes[parentOf.get(j)].name : null,
    })),
  }));

  const textureUse = new Map();
  for (const m of json.materials || []) {
    const note = (info, slot) => info && textureUse.set(info.index, [...(textureUse.get(info.index) || []), `${m.name}.${slot}`]);
    note(m.pbrMetallicRoughness?.baseColorTexture, 'baseColor');
    note(m.pbrMetallicRoughness?.metallicRoughnessTexture, 'metallicRoughness');
    note(m.normalTexture, 'normal');
    note(m.occlusionTexture, 'occlusion');
    note(m.emissiveTexture, 'emissive');
  }
  const images = (json.images || []).map((img, i) => {
    let bytes = null;
    let size = null;
    if (img.bufferView != null && bin) {
      const bv = json.bufferViews[img.bufferView];
      bytes = bv.byteLength;
      size = imageSize(bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength));
    }
    const usos = (json.textures || [])
      .map((t, ti) => ({ t, ti }))
      .filter(({ t }) => t.source === i || t.extensions?.EXT_texture_webp?.source === i)
      .flatMap(({ ti }) => textureUse.get(ti) || []);
    return { nombre: img.name, tipo: img.mimeType, kb: bytes != null ? Math.round(bytes / 1024) : null, ancho: size?.width ?? null, alto: size?.height ?? null, usos };
  });

  const materials = (json.materials || []).map((m) => ({
    nombre: m.name,
    color_base: m.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1, 1],
    metallic: m.pbrMetallicRoughness?.metallicFactor ?? 1,
    roughness: m.pbrMetallicRoughness?.roughnessFactor ?? 1,
    texturas: ['baseColorTexture', 'metallicRoughnessTexture'].filter((k) => m.pbrMetallicRoughness?.[k])
      .concat(['normalTexture', 'occlusionTexture', 'emissiveTexture'].filter((k) => m[k])),
    doble_cara: !!m.doubleSided,
    alpha: m.alphaMode || 'OPAQUE',
    extensiones: Object.keys(m.extensions || {}),
  }));

  const animations = (json.animations || []).map((a) => {
    let dur = 0;
    const paths = {};
    const targets = new Set();
    for (const s of a.samplers) dur = Math.max(dur, json.accessors[s.input].max?.[0] ?? 0);
    for (const c of a.channels) {
      paths[c.target.path] = (paths[c.target.path] || 0) + 1;
      targets.add(nodes[c.target.node]?.name);
    }
    return { nombre: a.name, duracion_s: Math.round(dur * 1000) / 1000, canales: paths, huesos_animados: targets.size };
  });

  const totalTris = meshes.reduce((s, m) => s + m.primitivas.reduce((t, p) => t + p.triangulos, 0), 0);
  const accessorBytes = (json.accessors || []).reduce((s, a) => s + a.count * (COMPONENTS[a.type] || 1), 0);

  return {
    tamano_kb: Math.round((buf.length / 1024) * 10) / 10,
    sha256: createHash('sha256').update(buf).digest('hex'),
    generador: json.asset?.generator ?? null,
    extensiones: json.extensionsUsed || [],
    triangulos: totalTris,
    componentes_accesores: accessorBytes,
    mallas: meshes,
    esqueletos: skins,
    materiales: materials,
    imagenes: images,
    animaciones: animations,
  };
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Uso: node tools/inspect-model.mjs archivo.glb [--json]');
    return 2;
  }
  const r = inspectGlb(readFileSync(file));
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(r, null, 2));
    return 0;
  }
  console.log(`${file} · ${r.tamano_kb} KB · ${r.triangulos} triángulos · generador: ${r.generador}`);
  console.log(`  SHA-256 ${r.sha256}`);
  console.log(`  Extensiones: ${r.extensiones.join(', ') || 'ninguna'}`);
  for (const m of r.mallas) for (const p of m.primitivas) console.log(`  Malla ${m.nombre}: ${p.vertices} vértices, ${p.triangulos} triángulos, morph targets ${p.morph_targets}, atributos ${p.atributos.join(',')}`);
  for (const s of r.esqueletos) console.log(`  Esqueleto: ${s.huesos} huesos → ${s.jerarquia.map((h) => h.nombre).join(', ')}`);
  for (const m of r.materiales) console.log(`  Material ${m.nombre}: metallic ${m.metallic}, roughness ${m.roughness}, texturas ${m.texturas.join(', ')}${m.doble_cara ? ', doble cara' : ''}`);
  for (const i of r.imagenes) console.log(`  Imagen ${i.nombre}: ${i.tipo} ${i.ancho}×${i.alto}, ${i.kb} KB → ${i.usos.join(', ')}`);
  for (const a of r.animaciones) console.log(`  Animación ${a.nombre}: ${a.duracion_s} s, ${a.huesos_animados} huesos, canales ${JSON.stringify(a.canales)}`);
  console.log(`  (${statSync(file).size} bytes)`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exitCode = main();
}
