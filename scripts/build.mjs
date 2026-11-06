#!/usr/bin/env node
/**
 * Construye dist/ con la misma estructura que /rufi/ en el servidor:
 *
 *   dist/rufi.js                         cargador central (~1 KB gzip) — lo único que incluyen las páginas
 *   dist/configs/*.json                  configuración por página + _global.json + _routes.json
 *   dist/v/<versión>/rufi-core.js        núcleo del componente (IIFE)
 *   dist/v/<versión>/rufi-3d.js          motor 3D con three.js (módulo ES, carga diferida)
 *   dist/v/<versión>/rufi-expresivo.web.glb
 *   dist/v/<versión>/rufi-poster.webp
 *
 * La versión sale de package.json (campo "rufiVersion"). Las versiones anteriores ya publicadas
 * no se tocan: cada versión vive en su carpeta y se puede volver a ella cambiando _global.json.
 * Uso: npm run build
 */
import { build } from 'esbuild';
import { writeFileSync, copyFileSync, mkdirSync, statSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { validateConfig } from '../tools/validate-config.mjs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const VERSION = pkg.rufiVersion;
if (!/^\d+\.\d+\.\d+$/.test(VERSION || '')) { console.error('package.json: falta "rufiVersion" (x.y.z)'); process.exit(1); }
const V = `dist/v/${VERSION}`;
const minify = !process.env.RUFI_NOMINIFY;

rmSync('dist', { recursive: true, force: true });
mkdirSync(V, { recursive: true }); mkdirSync('dist/configs/ejemplos', { recursive: true });

await build({ entryPoints: ['src/loader.js'], outfile: 'dist/rufi.js', bundle: false, minify, target: ['es2017'], legalComments: 'none', define: {}, banner: { js: `/* Rufi · cargador ${VERSION} · https://referencehome.es/rufi/ */` } });
const loader = readFileSync('dist/rufi.js', 'utf8');
if (!loader.includes('__RUFI_VERSION__')) { console.error('cargador: no se encuentra __RUFI_VERSION__'); process.exit(1); }
writeFileSync('dist/rufi.js', loader.replace('__RUFI_VERSION__', VERSION));

await build({ entryPoints: ['src/rufi.js'], outfile: `${V}/rufi-core.js`, bundle: true, minify, format: 'iife', target: ['es2020'], legalComments: 'none' });
await build({ entryPoints: ['src/rufi-3d.js'], outfile: `${V}/rufi-3d.js`, bundle: true, minify: true, format: 'esm', target: ['es2020'], legalComments: 'none' });
copyFileSync('models/rufi-expresivo.web.glb', `${V}/rufi-expresivo.web.glb`);
if (existsSync('assets/web/rufi-poster.webp')) copyFileSync('assets/web/rufi-poster.webp', `${V}/rufi-poster.webp`);

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
if (global.version !== VERSION) console.warn(`! configs/_global.json usa la versión ${global.version}; la construida es ${VERSION}`);

for (const f of ['dist/rufi.js', `${V}/rufi-core.js`, `${V}/rufi-3d.js`, `${V}/rufi-expresivo.web.glb`, `${V}/rufi-poster.webp`]) {
  if (!existsSync(f)) { console.log(`${f}: falta`); continue; }
  const b = readFileSync(f);
  console.log(`${f.padEnd(40)} ${(statSync(f).size / 1024).toFixed(1).padStart(7)} KB  (gzip ${(gzipSync(b, { level: 9 }).length / 1024).toFixed(1)} KB)`);
}
console.log(`configuraciones: ${readdirSync('dist/configs').filter((n) => n.endsWith('.json')).join(', ')}`);
