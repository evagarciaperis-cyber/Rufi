#!/usr/bin/env node
/**
 * Validador de GLB de Rufi (sin dependencias).
 *
 * Comprueba que un .glb exportado cumple el contrato de spec/rufi.character.json:
 *   - formato GLB 2.0 válido
 *   - huesos de deformación con los nombres exactos
 *   - shape keys (morph targets) obligatorias en el mesh de la cabeza
 *   - clips de animación obligatorios (y aviso de los recomendados)
 *   - presupuesto web: triángulos, huesos, morph targets, tamaño, texturas
 *   - solo extensiones glTF permitidas
 *   - que no se exporte la maqueta (objetos PROXY_*) como si fuera Rufi
 *
 * Uso:
 *   node tools/validate-glb.mjs ruta/al/archivo.glb [--spec spec/rufi.character.json]
 *        [--allow-proxy] [--json]
 *
 * Código de salida: 0 sin errores (puede haber avisos), 1 con errores, 2 uso incorrecto.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_BIN = 0x004e4942; // 'BIN\0'

/** Lee la cabecera y los chunks de un GLB. Lanza Error si no es válido. */
export function parseGlb(buf) {
  if (buf.length < 20) throw new Error('Archivo demasiado pequeño para ser GLB');
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== GLB_MAGIC) throw new Error('No es un GLB (firma "glTF" ausente)');
  const version = dv.getUint32(4, true);
  if (version !== 2) throw new Error(`Versión GLB ${version}; se requiere 2`);
  const length = dv.getUint32(8, true);
  if (length !== buf.length) throw new Error(`Longitud declarada ${length} ≠ tamaño real ${buf.length}`);
  let off = 12;
  let json = null;
  let bin = null;
  while (off + 8 <= buf.length) {
    const clen = dv.getUint32(off, true);
    const ctype = dv.getUint32(off + 4, true);
    const data = buf.subarray(off + 8, off + 8 + clen);
    if (ctype === CHUNK_JSON) json = JSON.parse(new TextDecoder().decode(data));
    else if (ctype === CHUNK_BIN) bin = data;
    off += 8 + clen;
  }
  if (!json) throw new Error('GLB sin chunk JSON');
  return { json, bin };
}

/** Dimensiones de una imagen PNG, JPEG o WebP embebida. null si no se reconoce. */
export function imageSize(bytes) {
  if (!bytes || bytes.length < 24) return null;
  // PNG: firma + IHDR
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: dv.getUint32(16), height: dv.getUint32(20), type: 'png' };
  }
  // WebP: contenedor RIFF con chunk VP8 (con pérdida), VP8L (sin pérdida) o VP8X (extendido)
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50 && bytes.length >= 30) {
    const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
    if (chunk === 'VP8 ') {
      return { width: (bytes[26] | (bytes[27] << 8)) & 0x3fff, height: (bytes[28] | (bytes[29] << 8)) & 0x3fff, type: 'webp' };
    }
    if (chunk === 'VP8L') {
      const [b0, b1, b2, b3] = [bytes[21], bytes[22], bytes[23], bytes[24]];
      return { width: 1 + (((b1 & 0x3f) << 8) | b0), height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)), type: 'webp' };
    }
    if (chunk === 'VP8X') {
      return { width: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)), height: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)), type: 'webp' };
    }
  }
  // JPEG: buscar marcador SOFn
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) { i++; continue; }
      const marker = bytes[i + 1];
      const len = (bytes[i + 2] << 8) | bytes[i + 3];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8], type: 'jpeg' };
      }
      i += 2 + len;
    }
  }
  return null;
}

function countTriangles(json) {
  let tris = 0;
  for (const mesh of json.meshes || []) {
    for (const prim of mesh.primitives || []) {
      const mode = prim.mode ?? 4;
      const acc = prim.indices != null ? json.accessors?.[prim.indices] : json.accessors?.[prim.attributes?.POSITION];
      const n = acc?.count ?? 0;
      if (mode === 4) tris += Math.floor(n / 3);
      else if (mode === 5 || mode === 6) tris += Math.max(0, n - 2);
    }
  }
  return tris;
}

/**
 * Valida el GLB contra la especificación.
 * @returns {{errors: string[], warnings: string[], stats: object}}
 */
export function validateGlb(buf, spec, opts = {}) {
  const errors = [];
  const warnings = [];
  const stats = { bytes: buf.length };
  let parsed;
  try {
    parsed = parseGlb(buf);
  } catch (e) {
    return { errors: [e.message], warnings, stats };
  }
  const { json, bin } = parsed;
  const budget = spec.presupuesto_web;

  if (json.asset?.version !== '2.0') errors.push(`asset.version es "${json.asset?.version}"; se requiere "2.0"`);

  // Extensiones
  const allowed = new Set(budget.extensiones_permitidas);
  for (const ext of json.extensionsUsed || []) {
    if (!allowed.has(ext)) errors.push(`Extensión no permitida: ${ext}`);
  }

  // Maqueta
  const nodeNames = (json.nodes || []).map((n) => n.name || '');
  const proxies = nodeNames.filter((n) => n.startsWith('PROXY_'));
  if (proxies.length && !opts.allowProxy) {
    errors.push(`Contiene maqueta (${proxies.length} objetos PROXY_*). No es el modelo de Rufi; usa --allow-proxy solo para pruebas de pipeline.`);
  }

  // Huesos
  const jointNames = new Set();
  for (const skin of json.skins || []) for (const j of skin.joints || []) jointNames.add(json.nodes?.[j]?.name);
  stats.joints = jointNames.size;
  if (!json.skins?.length) errors.push('No hay skin (armature) exportado');
  const requiredBones = spec.rig.huesos.filter((b) => b.deform).map((b) => b.nombre);
  // El contrato usa '_L'/'_R'. Se comparan sin '.' ni '_' para detectar también
  // nombres alterados por herramientas intermedias (three.js elimina los puntos).
  const norm = (s) => String(s).replace(/[._]/g, '');
  const dotted = [...jointNames].filter((n) => String(n).includes('.'));
  if (dotted.length) warnings.push(`Huesos con '.' en el nombre (three.js elimina los puntos; usa _L/_R): ${dotted.join(', ')}`);
  const jointNorm = new Set([...jointNames].map(norm));
  const missingBones = requiredBones.filter((b) => !jointNorm.has(norm(b)));
  if (missingBones.length) errors.push(`Faltan huesos de deformación: ${missingBones.join(', ')}`);
  if (jointNames.size > budget.huesos_deform_max) {
    errors.push(`Demasiados huesos en el skin: ${jointNames.size} > ${budget.huesos_deform_max}`);
  }

  // Shape keys
  const sk = spec.shape_keys;
  const headMesh = (json.meshes || []).find((m) => m.name === sk.mesh)
    ?? (json.nodes || []).filter((n) => n.name === sk.mesh && n.mesh != null).map((n) => json.meshes[n.mesh])[0];
  if (!headMesh) {
    errors.push(`No se encuentra el mesh de la cabeza "${sk.mesh}"`);
  } else {
    const names = headMesh.extras?.targetNames || [];
    stats.morphTargets = names.length;
    const missing = sk.obligatorias.filter((k) => !names.includes(k));
    if (missing.length) errors.push(`Faltan shape keys en ${sk.mesh}: ${missing.join(', ')}`);
    if (names.length > budget.shape_keys_max) errors.push(`Demasiadas shape keys: ${names.length} > ${budget.shape_keys_max}`);
    const banned = names.filter((n) => sk.prohibidas_por_marca.some((b) => n.toLowerCase().includes(b)));
    if (banned.length) errors.push(`Shape keys con expresiones prohibidas por la marca: ${banned.join(', ')}`);
  }

  // Animaciones
  const animNames = new Set((json.animations || []).map((a) => a.name));
  stats.animations = [...animNames];
  const missingClips = spec.clips.obligatorios.map((c) => c.nombre).filter((n) => !animNames.has(n));
  if (missingClips.length) errors.push(`Faltan clips obligatorios: ${missingClips.join(', ')}`);
  const missingRec = spec.clips.recomendados.map((c) => c.nombre).filter((n) => !animNames.has(n));
  if (missingRec.length) warnings.push(`Faltan clips recomendados: ${missingRec.join(', ')}`);

  // Geometría
  stats.triangles = countTriangles(json);
  if (stats.triangles > budget.triangulos_max) errors.push(`Triángulos: ${stats.triangles} > máximo ${budget.triangulos_max}`);
  else if (stats.triangles > budget.triangulos_objetivo) warnings.push(`Triángulos: ${stats.triangles} > objetivo ${budget.triangulos_objetivo}`);

  // Tamaño
  const kb = buf.length / 1024;
  stats.kb = Math.round(kb * 10) / 10;
  if (kb > budget.glb_max_kb) errors.push(`Tamaño ${stats.kb} KB > máximo ${budget.glb_max_kb} KB`);
  else if (kb > budget.glb_objetivo_kb) warnings.push(`Tamaño ${stats.kb} KB > objetivo ${budget.glb_objetivo_kb} KB`);

  // Texturas
  stats.images = [];
  for (const [i, img] of (json.images || []).entries()) {
    if (img.bufferView == null || !bin) { warnings.push(`Imagen ${i} externa o sin datos: no se puede medir`); continue; }
    const bv = json.bufferViews[img.bufferView];
    const bytes = bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
    const size = imageSize(bytes);
    stats.images.push({ name: img.name || `#${i}`, mime: img.mimeType, ...(size || {}) });
    if (size && (size.width > budget.texturas_max_px || size.height > budget.texturas_max_px)) {
      warnings.push(`Textura ${img.name || i} de ${size.width}×${size.height} > ${budget.texturas_max_px}px`);
    }
  }

  return { errors, warnings, stats };
}

function main(argv) {
  const args = argv.slice(2);
  const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--spec');
  const file = positional[0];
  if (!file) {
    console.error('Uso: node tools/validate-glb.mjs archivo.glb [--spec ruta] [--allow-proxy] [--json]');
    return 2;
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const specIdx = args.indexOf('--spec');
  const specPath = specIdx >= 0 ? args[specIdx + 1] : path.join(here, '..', 'spec', 'rufi.character.json');
  const spec = JSON.parse(readFileSync(specPath, 'utf8'));
  const res = validateGlb(readFileSync(file), spec, { allowProxy: args.includes('--allow-proxy') });
  if (args.includes('--json')) {
    console.log(JSON.stringify(res, null, 2));
  } else {
    console.log(`Rufi GLB · ${file}`);
    console.log(`  ${res.stats.kb ?? '?'} KB · ${res.stats.triangles ?? '?'} triángulos · ${res.stats.joints ?? '?'} huesos · ${res.stats.morphTargets ?? '?'} shape keys · ${res.stats.animations?.length ?? '?'} clips`);
    for (const e of res.errors) console.log(`  ✗ ${e}`);
    for (const w of res.warnings) console.log(`  ! ${w}`);
    console.log(res.errors.length ? `  RESULTADO: NO VÁLIDO (${res.errors.length} errores)` : '  RESULTADO: válido');
  }
  return res.errors.length ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exitCode = main(process.argv);
}
