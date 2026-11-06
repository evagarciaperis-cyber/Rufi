#!/usr/bin/env node
/**
 * Prepara el paquete FTP de la instalación centralizada de Rufi en referencehome.es/rufi/,
 * con la página de pruebas del Aval ICO, sin tocar la landing publicada.
 *
 * Uso:
 *   curl -sS -o build/aval-ico-valencia.original.html https://referencehome.es/ICO/aval-ico-valencia.html
 *   npm run build
 *   node scripts/package-ftp.mjs build/aval-ico-valencia.original.html
 *
 * Resultado: build/ftp/ y build/rufi-instalacion-central.zip
 *   web/rufi/                 instalación central (cargador, configuraciones, versiones)
 *   web/ICO/…-rufi-test.html  copia de pruebas de la landing
 *   ejemplos/, esquema/       plantillas de configuración y esquema (no se suben al servidor)
 * La copia de pruebas solo cambia: robots → noindex, un comentario en <head> y UNA línea de Rufi
 * antes de </body>. El script comprueba que, quitando esos cambios, es idéntica al original.
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, existsSync, readdirSync, statSync, cpSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { validateConfig } from '../tools/validate-config.mjs';

const ORIGINAL = process.argv[2];
if (!ORIGINAL) { console.error('Uso: node scripts/package-ftp.mjs ruta/aval-ico-valencia.original.html'); process.exit(2); }
const VERSION = JSON.parse(readFileSync('package.json', 'utf8')).rufiVersion;
const TEST_NAME = 'aval-ico-valencia-rufi-test.html';
const OUT = 'build/ftp', WEB = `${OUT}/web`;
const sha = (b) => createHash('sha256').update(b).digest('hex');
const fail = (m) => { console.error(`✗ ${m}`); process.exit(1); };

const V = `dist/v/${VERSION}`;
for (const f of ['dist/rufi.js', `${V}/rufi-core.js`, `${V}/rufi-3d.js`, `${V}/rufi-expresivo.web.glb`, `${V}/rufi-poster.webp`, 'dist/configs/_global.json', 'dist/configs/aval-ico-valencia-test.json']) if (!existsSync(f)) fail(`falta ${f}: ejecuta npm run build`);
const global = JSON.parse(readFileSync('dist/configs/_global.json', 'utf8'));
if (global.version !== VERSION) fail(`_global.json apunta a ${global.version} y se ha construido ${VERSION}`);

// ---------------------------------------------------------------- copia de pruebas
const original = readFileSync(ORIGINAL, 'utf8');
const ROBOTS_IN = '<meta name="robots" content="index, follow">';
const ROBOTS_OUT = '<meta name="robots" content="noindex, nofollow, noarchive">';
const count = (s, sub) => s.split(sub).length - 1;
if (count(original, ROBOTS_IN) !== 1) fail(`se esperaba exactamente un ${ROBOTS_IN}`);
if (count(original, '</body>') !== 1) fail('se esperaba exactamente un </body>');
const headMatch = original.match(/<head[^>]*>/i); if (!headMatch) fail('no se encuentra <head>');
if (!original.includes('id="masc"')) console.warn('! aviso: no se encuentra #masc (mascota anterior) en la landing');

const COMMENT = `\n<!-- COPIA DE PRUEBAS DE RUFI · no indexar · no enlazar · original: https://referencehome.es/ICO/aval-ico-valencia.html · retirar: borrar este archivo -->`;
const SNIPPET = '<script src="/rufi/rufi.js" data-rufi-config="aval-ico-valencia-test" defer></script>\n';
let test = original.replace(ROBOTS_IN, ROBOTS_OUT);
test = test.replace(headMatch[0], headMatch[0] + COMMENT);
test = test.replace('</body>', SNIPPET + '</body>');
const undone = test.replace(SNIPPET + '</body>', '</body>').replace(headMatch[0] + COMMENT, headMatch[0]).replace(ROBOTS_OUT, ROBOTS_IN);
if (undone !== original) fail('la copia de pruebas tiene cambios no previstos');
if (count(test, ROBOTS_OUT) !== 1) fail('falta noindex');
console.log(`✓ copia de pruebas: idéntica al original salvo robots, comentario y 1 línea de Rufi (original ${original.length} B, sha256 ${sha(original).slice(0, 16)}…)`);

// ---------------------------------------------------------------- configuraciones (validadas contra la página)
for (const n of ['aval-ico-valencia', 'aval-ico-valencia-test']) {
  const { errors, warnings } = validateConfig(JSON.parse(readFileSync(`dist/configs/${n}.json`, 'utf8')), { html: original });
  if (errors.length) fail(`configs/${n}.json: ${errors.join(' · ')}`);
  console.log(`✓ configs/${n}.json válida y con selectores presentes en la landing${warnings.length ? ` (${warnings.length} avisos)` : ''}`);
}
const tcfg = JSON.parse(readFileSync('dist/configs/aval-ico-valencia-test.json', 'utf8'));
if (tcfg.test !== true || tcfg.page !== 'aval-ico-valencia-test') fail('la configuración de pruebas debe tener test: true y page aval-ico-valencia-test');

// ---------------------------------------------------------------- estructura FTP
rmSync(OUT, { recursive: true, force: true });
mkdirSync(`${WEB}/ICO`, { recursive: true }); mkdirSync(`${WEB}/rufi/configs`, { recursive: true }); mkdirSync(`${WEB}/rufi/v/${VERSION}`, { recursive: true });
writeFileSync(`${WEB}/ICO/${TEST_NAME}`, test);
copyFileSync('dist/rufi.js', `${WEB}/rufi/rufi.js`);
for (const n of readdirSync('dist/configs')) if (n.endsWith('.json')) copyFileSync(`dist/configs/${n}`, `${WEB}/rufi/configs/${n}`);
for (const n of readdirSync(V)) copyFileSync(`${V}/${n}`, `${WEB}/rufi/v/${VERSION}/${n}`);
copyFileSync('hosting/rufi/.htaccess', `${WEB}/rufi/.htaccess`);
copyFileSync('hosting/rufi/v/.htaccess', `${WEB}/rufi/v/.htaccess`);
for (const d of ['rufi', 'rufi/configs', 'rufi/v', `rufi/v/${VERSION}`]) copyFileSync('hosting/rufi/index.html', `${WEB}/${d}/index.html`);
cpSync('dist/configs/ejemplos', `${OUT}/ejemplos`, { recursive: true });
mkdirSync(`${OUT}/esquema`, { recursive: true });
copyFileSync('spec/rufi-config.schema.json', `${OUT}/esquema/rufi-config.schema.json`);
copyFileSync('tools/validate-config.mjs', `${OUT}/esquema/validate-config.mjs`);
copyFileSync('hosting/LEEME-INSTALACION.md', `${OUT}/LEEME-INSTALACION.md`);
copyFileSync('docs/15-instalacion-centralizada.md', `${OUT}/GUIA-REUTILIZAR-RUFI.md`);
// el validador busca el esquema en ../spec: en el paquete, junto a él
writeFileSync(`${OUT}/esquema/validate-config.mjs`, readFileSync(`${OUT}/esquema/validate-config.mjs`, 'utf8').replace("path.join(here, '..', 'spec', 'rufi-config.schema.json')", "path.join(here, 'rufi-config.schema.json')"));

// ---------------------------------------------------------------- comprobación de rutas
const fileForUrl = (u) => path.join(WEB, u.replace(/^\//, ''));
for (const u of [...test.matchAll(/<script src="(\/rufi\/[^"]+)"/g)].map((m) => m[1])) { if (!existsSync(fileForUrl(u))) fail(`ruta rota en la copia de pruebas: ${u}`); console.log(`✓ ${u} → web${u}`); }
const loader = readFileSync(`${WEB}/rufi/rufi.js`, 'utf8');
if (!loader.includes(`'${VERSION}'`) && !loader.includes(`"${VERSION}"`)) fail('el cargador no lleva la versión por defecto');
const core = readFileSync(`${WEB}/rufi/v/${VERSION}/rufi-core.js`, 'utf8');
for (const f of ['rufi-3d.js', 'rufi-expresivo.web.glb', 'rufi-poster.webp']) { if (!core.includes(f)) fail(`rufi-core.js no referencia ${f}`); if (!existsSync(`${WEB}/rufi/v/${VERSION}/${f}`)) fail(`falta /rufi/v/${VERSION}/${f}`); }
console.log(`✓ /rufi/rufi.js → /rufi/configs/aval-ico-valencia-test.json → /rufi/v/${VERSION}/{rufi-core.js, rufi-3d.js, rufi-expresivo.web.glb, rufi-poster.webp}`);

// ---------------------------------------------------------------- huellas y ZIP
const files = []; const walk = (d) => { for (const n of readdirSync(d)) { const p = path.join(d, n); if (statSync(p).isDirectory()) walk(p); else files.push(p); } };
walk(OUT);
const sums = files.filter((f) => !f.endsWith('SHA256SUMS.txt')).sort().map((f) => `${sha(readFileSync(f))}  ${path.relative(OUT, f)}`);
writeFileSync(`${OUT}/SHA256SUMS.txt`, sums.join('\n') + '\n');
const zip = path.resolve('build/rufi-instalacion-central.zip');
rmSync(zip, { force: true });
execFileSync('zip', ['-r', '-X', '-q', zip, '.'], { cwd: OUT });
console.log(`\n✓ ${path.relative(process.cwd(), zip)} (${(statSync(zip).size / 1024).toFixed(1)} KB, ${files.length} archivos)`);
for (const l of sums) console.log('  ' + l.replace(/^(\w{12})\w+/, '$1…'));
