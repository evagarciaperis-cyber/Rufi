#!/usr/bin/env node
/**
 * Construye dist/ con la misma estructura que /rufi/ en el servidor:
 *
 *   dist/rufi.js                         cargador central — lo único que incluyen las páginas
 *   dist/configs/*.json                  configuración por página + _global.json + _routes.json
 *   dist/v/<versión>/rufi-core.js        núcleo del componente (IIFE)
 *   dist/v/<versión>/rufi-3d.js          motor 3D con three.js (módulo ES, carga diferida)
 *   dist/v/<versión>/rufi-expresivo.web.glb
 *   dist/v/<versión>/rufi-poster.webp
 *
 * La versión sale de package.json (campo "rufiVersion").
 *
 * Versiones PUBLICADAS (scripts/published-versions.json): sus carpetas no se tocan nunca.
 *   - dist/v/<publicada>/ no se borra ni se reconstruye: se comprueban sus huellas SHA-256 antes y
 *     después de construir; si no coinciden, la construcción falla.
 *   - No se puede construir una versión que ya está publicada: versión nueva = carpeta nueva.
 * Fase D (1.1.0): el 3D no cambia. rufi-3d.js y el GLB de la versión nueva deben ser idénticos byte
 * a byte a los de SAME_3D_AS; se comprueba aquí y, si no, la construcción falla.
 * Uso: npm run build
 */
import { build } from 'esbuild';
import { writeFileSync, copyFileSync, mkdirSync, statSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { validateConfig } from '../tools/validate-config.mjs';
import { schemaPlugin } from './esbuild-schema.mjs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const VERSION = pkg.rufiVersion;
if (!/^\d+\.\d+\.\d+$/.test(VERSION || '')) { console.error('package.json: falta "rufiVersion" (x.y.z)'); process.exit(1); }
const V = `dist/v/${VERSION}`;
const minify = !process.env.RUFI_NOMINIFY;
const SAME_3D_AS = '1.0.0'; // 1.1.0 no cambia el 3D: mismo rufi-3d.js y mismo GLB que la 1.0.0
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
const fail = (m) => { console.error(`✗ ${m}`); process.exit(1); };

const PUBLISHED = JSON.parse(readFileSync('scripts/published-versions.json', 'utf8'));
delete PUBLISHED.$comment;
if (PUBLISHED[VERSION]) fail(`la versión ${VERSION} ya está publicada (scripts/published-versions.json): una carpeta publicada no se modifica nunca. Sube rufiVersion.`);
const checkPublished = (when) => {
  for (const [ver, files] of Object.entries(PUBLISHED)) {
    for (const [f, h] of Object.entries(files)) {
      const p = `dist/v/${ver}/${f}`;
      if (!existsSync(p)) fail(`${when}: falta ${p} (versión publicada)`);
      if (sha(p) !== h) fail(`${when}: ${p} no coincide con su huella publicada`);
    }
    const extra = readdirSync(`dist/v/${ver}`).filter((n) => !(n in files));
    if (extra.length) fail(`${when}: dist/v/${ver}/ tiene archivos no publicados: ${extra.join(', ')}`);
  }
};
checkPublished('antes de construir');

// Se borra todo dist/ salvo las carpetas de versiones publicadas.
for (const n of readdirSync('dist')) if (n !== 'v') rmSync(path.join('dist', n), { recursive: true, force: true });
for (const n of readdirSync('dist/v')) if (!PUBLISHED[n]) rmSync(path.join('dist/v', n), { recursive: true, force: true });
mkdirSync(V, { recursive: true }); mkdirSync('dist/configs/ejemplos', { recursive: true });

// Cargador: incluye decide()/decideLive() de spec/reference y la validación de tools/contract-core.mjs.
await build({ entryPoints: ['src/loader.js'], outfile: 'dist/rufi.js', bundle: true, format: 'iife', minify, target: ['es2017'], legalComments: 'none', plugins: [schemaPlugin], banner: { js: `/* Rufi · cargador ${VERSION} · https://referencehome.es/rufi/ */` } });
const loader = readFileSync('dist/rufi.js', 'utf8');
if (!loader.includes('__RUFI_VERSION__')) fail('cargador: no se encuentra __RUFI_VERSION__');
writeFileSync('dist/rufi.js', loader.replace('__RUFI_VERSION__', VERSION));

await build({ entryPoints: ['src/rufi.js'], outfile: `${V}/rufi-core.js`, bundle: true, minify, format: 'iife', target: ['es2020'], legalComments: 'none' });
await build({ entryPoints: ['src/rufi-3d.js'], outfile: `${V}/rufi-3d.js`, bundle: true, minify: true, format: 'esm', target: ['es2020'], legalComments: 'none' });
copyFileSync('models/rufi-expresivo.web.glb', `${V}/rufi-expresivo.web.glb`);
if (existsSync('assets/web/rufi-poster.webp')) copyFileSync('assets/web/rufi-poster.webp', `${V}/rufi-poster.webp`);

if (PUBLISHED[SAME_3D_AS]) {
  for (const f of ['rufi-3d.js', 'rufi-expresivo.web.glb', 'rufi-poster.webp']) {
    const h = sha(`${V}/${f}`);
    if (h !== PUBLISHED[SAME_3D_AS][f]) fail(`${V}/${f} no es idéntico al de ${SAME_3D_AS} (${h} ≠ ${PUBLISHED[SAME_3D_AS][f]}). Si el 3D cambia a propósito, actualiza SAME_3D_AS.`);
    console.log(`✓ ${V}/${f} idéntico a v/${SAME_3D_AS} · sha256 ${h}`);
  }
}

// Configuraciones: se validan antes de copiarlas (una configuración rota no llega a dist/)
let bad = 0;
const copyConfigs = (dir, out) => {
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) continue;
    if (!n.endsWith('.json')) continue;
    if (!n.startsWith('_')) {
      const { errors } = validateConfig(JSON.parse(readFileSync(p, 'utf8')));
      if (errors.length) { console.error(`✗ ${p}\n    ${errors.join('\n    ')}`); bad++; continue; }
    }
    copyFileSync(p, path.join(out, n));
  }
};
copyConfigs('configs', 'dist/configs'); copyConfigs('configs/ejemplos', 'dist/configs/ejemplos');
if (bad) process.exit(1);
const global = JSON.parse(readFileSync('configs/_global.json', 'utf8'));
if (global.version !== VERSION && !PUBLISHED[global.version]) fail(`configs/_global.json usa la versión ${global.version}, que ni está publicada ni es la construida (${VERSION})`);
if (global.version !== VERSION) console.warn(`! configs/_global.json sigue en la versión ${global.version} (publicada); la construida es ${VERSION}. Cambiarla requiere autorización.`);

checkPublished('después de construir');

for (const f of ['dist/rufi.js', `${V}/rufi-core.js`, `${V}/rufi-3d.js`, `${V}/rufi-expresivo.web.glb`, `${V}/rufi-poster.webp`]) {
  if (!existsSync(f)) { console.log(`${f}: falta`); continue; }
  const b = readFileSync(f);
  console.log(`${f.padEnd(40)} ${(statSync(f).size / 1024).toFixed(1).padStart(7)} KB  (gzip ${(gzipSync(b, { level: 9 }).length / 1024).toFixed(1)} KB)  sha256 ${sha(f).slice(0, 16)}…`);
}
console.log(`versiones publicadas intactas: ${Object.keys(PUBLISHED).join(', ')}`);
console.log(`configuraciones: ${readdirSync('dist/configs').filter((n) => n.endsWith('.json')).join(', ')}`);
