#!/usr/bin/env node
/**
 * Construye dist/ para publicar Rufi en una web:
 *   dist/rufi.js                 núcleo (sin three.js), IIFE
 *   dist/rufi-3d.js              motor 3D con three.js empaquetado (módulo ES, se carga diferido)
 *   dist/rufi-expresivo.web.glb  modelo
 *   dist/rufi-poster.webp        póster (render del propio modelo; ver scripts/make-poster.cjs)
 *   dist/config/aval-ico.js      configuración de la landing del Aval ICO
 * Uso: npm run build
 */
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, statSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

mkdirSync('dist/config', { recursive: true });
await build({ entryPoints: ['src/rufi.js'], outfile: 'dist/rufi.js', bundle: true, minify: process.env.RUFI_NOMINIFY ? false : true, format: "iife", target: ['es2020'], legalComments: 'none' });
await build({ entryPoints: ['src/rufi-3d.js'], outfile: 'dist/rufi-3d.js', bundle: true, minify: true, format: 'esm', target: ['es2020'], legalComments: 'none' });
copyFileSync('models/rufi-expresivo.web.glb', 'dist/rufi-expresivo.web.glb');
copyFileSync('src/config/aval-ico.js', 'dist/config/aval-ico.js');
if (existsSync('assets/web/rufi-poster.webp')) copyFileSync('assets/web/rufi-poster.webp', 'dist/rufi-poster.webp');
for (const f of ['dist/rufi.js', 'dist/rufi-3d.js', 'dist/rufi-expresivo.web.glb', 'dist/rufi-poster.webp']) {
  if (!existsSync(f)) { console.log(`${f}: falta`); continue; }
  const b = readFileSync(f);
  console.log(`${f.padEnd(30)} ${(statSync(f).size / 1024).toFixed(1).padStart(7)} KB  (gzip ${(gzipSync(b, { level: 9 }).length / 1024).toFixed(1)} KB)`);
}
