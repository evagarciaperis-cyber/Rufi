#!/usr/bin/env node
/**
 * Prepara el paquete FTP para probar a Rufi en referencehome.es sin tocar la landing publicada.
 *
 * Uso:
 *   curl -sS -o build/aval-ico-valencia.original.html https://referencehome.es/ICO/aval-ico-valencia.html
 *   npm run build
 *   node scripts/package-ftp.mjs build/aval-ico-valencia.original.html
 *
 * Resultado: build/ftp/ (estructura) y build/rufi-prueba-ftp.zip
 * La copia de pruebas solo cambia: robots → noindex, un comentario identificativo en <head> y
 * las dos líneas de Rufi antes de </body>. El script comprueba que, quitando esos cambios, el
 * resultado es idéntico al original, byte a byte.
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ORIGINAL = process.argv[2];
if (!ORIGINAL) { console.error('Uso: node scripts/package-ftp.mjs ruta/aval-ico-valencia.original.html'); process.exit(2); }
const TEST_NAME = 'aval-ico-valencia-rufi-test.html';
const OUT = 'build/ftp', WEB = `${OUT}/web`;
const sha = (b) => createHash('sha256').update(b).digest('hex');
const fail = (m) => { console.error(`✗ ${m}`); process.exit(1); };

for (const f of ['dist/rufi.js', 'dist/rufi-3d.js', 'dist/rufi-expresivo.web.glb', 'dist/rufi-poster.webp']) if (!existsSync(f)) fail(`falta ${f}: ejecuta npm run build`);

// ---------------------------------------------------------------- copia de pruebas
const original = readFileSync(ORIGINAL, 'utf8');
const ROBOTS_IN = '<meta name="robots" content="index, follow">';
const ROBOTS_OUT = '<meta name="robots" content="noindex, nofollow, noarchive">';
const count = (s, sub) => s.split(sub).length - 1;
if (count(original, ROBOTS_IN) !== 1) fail(`se esperaba exactamente un ${ROBOTS_IN}`);
if (count(original, '</body>') !== 1) fail('se esperaba exactamente un </body>');
const headMatch = original.match(/<head[^>]*>/i); if (!headMatch) fail('no se encuentra <head>');
if (!original.includes('id="masc"')) console.warn('! aviso: no se encuentra #masc (mascota anterior) en la landing');

const COMMENT = `\n<!-- COPIA DE PRUEBAS DE RUFI · no indexar · no enlazar · original: https://referencehome.es/ICO/aval-ico-valencia.html · retirar: borrar este archivo y /rufi/ -->`;
const SCRIPTS = '<script src="/rufi/config/aval-ico-test.js"></script>\n<script src="/rufi/rufi.js" defer></script>\n';
let test = original.replace(ROBOTS_IN, ROBOTS_OUT);
test = test.replace(headMatch[0], headMatch[0] + COMMENT);
test = test.replace('</body>', SCRIPTS + '</body>');

// Prueba de que no hay más cambios: deshacer los tres y comparar con el original
const undone = test.replace(SCRIPTS + '</body>', '</body>').replace(headMatch[0] + COMMENT, headMatch[0]).replace(ROBOTS_OUT, ROBOTS_IN);
if (undone !== original) fail('la copia de pruebas tiene cambios no previstos');
if (count(test, ROBOTS_OUT) !== 1 || count(test, 'noindex') < 1) fail('falta noindex');
console.log(`✓ copia de pruebas: idéntica al original salvo robots, comentario y 2 líneas de Rufi (original ${original.length} B, sha256 ${sha(original).slice(0, 16)}…)`);

// ---------------------------------------------------------------- configuración de la prueba
let cfg = readFileSync('src/config/aval-ico.js', 'utf8');
const rep = (a, b) => { if (!cfg.includes(a)) fail(`configuración: no se encuentra «${a.slice(0, 40)}»`); cfg = cfg.replace(a, b); };
rep("page: 'aval-ico-valencia',", "page: 'aval-ico-valencia-test',\n  test: true, // eventos con test: true y registro [Rufi PRUEBA] en la consola");
rep("message: 'Hola, he visto vuestra guía del Aval ICO y me gustaría recibir asesoramiento' }", "message: '[PRUEBA RUFI] Hola, he visto vuestra guía del Aval ICO y me gustaría recibir asesoramiento' }");
rep("message: 'Hola, he usado el simulador del Aval ICO y me gustaría revisarlo con vosotros' }", "message: '[PRUEBA RUFI] Hola, he usado el simulador del Aval ICO y me gustaría revisarlo con vosotros' }");
rep("footnote: 'Información orientativa. La aprobación del aval depende siempre del banco.',", "footnote: 'Información orientativa. La aprobación del aval depende siempre del banco. (Página de pruebas)',");
cfg = cfg.replace(' * Configuración de Rufi para https://referencehome.es/ICO/aval-ico-valencia.html', ' * CONFIGURACIÓN DE PRUEBA de Rufi para https://referencehome.es/ICO/aval-ico-valencia-rufi-test.html\n * (generada por scripts/package-ftp.mjs a partir de src/config/aval-ico.js)');

// ---------------------------------------------------------------- estructura FTP
rmSync(OUT, { recursive: true, force: true });
mkdirSync(`${WEB}/ICO`, { recursive: true }); mkdirSync(`${WEB}/rufi/config`, { recursive: true });
writeFileSync(`${WEB}/ICO/${TEST_NAME}`, test);
for (const f of ['rufi.js', 'rufi-3d.js', 'rufi-expresivo.web.glb', 'rufi-poster.webp']) copyFileSync(`dist/${f}`, `${WEB}/rufi/${f}`);
copyFileSync('src/config/aval-ico.js', `${WEB}/rufi/config/aval-ico.js`);
writeFileSync(`${WEB}/rufi/config/aval-ico-test.js`, cfg);
copyFileSync('hosting/rufi/.htaccess', `${WEB}/rufi/.htaccess`);
copyFileSync('hosting/rufi/index.html', `${WEB}/rufi/index.html`);
copyFileSync('hosting/LEEME-INSTALACION.md', `${OUT}/LEEME-INSTALACION.md`);

// ---------------------------------------------------------------- comprobación de rutas
const fileForUrl = (u) => path.join(WEB, u.replace(/^\//, ''));
for (const u of [...test.matchAll(/<script src="(\/rufi\/[^"]+)"/g)].map((m) => m[1])) { if (!existsSync(fileForUrl(u))) fail(`ruta rota en la copia de pruebas: ${u}`); console.log(`✓ ${u} → web${u}`); }
const core = readFileSync(`${WEB}/rufi/rufi.js`, 'utf8');
for (const f of ['rufi-3d.js', 'rufi-expresivo.web.glb', 'rufi-poster.webp']) { if (!core.includes(f)) fail(`rufi.js no referencia ${f}`); if (!existsSync(`${WEB}/rufi/${f}`)) fail(`falta /rufi/${f}`); console.log(`✓ rufi.js carga /rufi/${f} (relativo a su propia URL)`); }
if (!test.includes('src="/images/mascota.png"')) console.warn('! aviso: la landing ya no usa /images/mascota.png');

// ---------------------------------------------------------------- huellas y ZIP
const files = []; const walk = (d) => { for (const n of readdirSync(d)) { const p = path.join(d, n); if (statSync(p).isDirectory()) walk(p); else files.push(p); } };
walk(OUT);
const sums = files.filter((f) => !f.endsWith('SHA256SUMS.txt')).sort().map((f) => `${sha(readFileSync(f))}  ${path.relative(OUT, f)}`);
writeFileSync(`${OUT}/SHA256SUMS.txt`, sums.join('\n') + '\n');
const zip = path.resolve('build/rufi-prueba-ftp.zip');
rmSync(zip, { force: true });
execFileSync('zip', ['-r', '-X', '-q', zip, '.'], { cwd: OUT });
console.log(`\n✓ ${path.relative(process.cwd(), zip)} (${(statSync(zip).size / 1024).toFixed(1)} KB)`);
for (const l of sums) console.log('  ' + l.replace(/^(\w{12})\w+/, '$1…'));
