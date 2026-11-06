#!/usr/bin/env node
/**
 * Empaqueta el plugin de Joomla 6 de Rufi (fase F) para instalarlo desde
 * «Sistema → Instalar → Extensiones → Subir paquete». NO instala ni sube nada.
 *
 * Uso:
 *   node scripts/package-joomla.mjs        (o npm run package:joomla)
 *
 * Resultado: build/plg_system_rufi-<versión>.zip, con la versión de <version> en rufi.xml.
 * Usa el `zip` del sistema (no hay ninguna dependencia de compresión fijada en package.json).
 * Comprueba después el contenido del zip: mismos archivos que la carpeta, rufi.xml en la raíz,
 * todo lo que lista el manifiesto presente, contenido byte a byte idéntico (SHA-256) y, si hay
 * PHP, `php -l` de cada archivo PHP extraído.
 */
import { readFileSync, readdirSync, statSync, mkdirSync, rmSync, mkdtempSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const SRC = 'integrations/joomla/plg_system_rufi';
const fail = (m) => { console.error(`✗ ${m}`); process.exit(1); };
const ok = (m) => console.log(`✓ ${m}`);
const sha = (b) => createHash('sha256').update(b).digest('hex');

if (!existsSync(`${SRC}/rufi.xml`)) fail(`no existe ${SRC}/rufi.xml (ejecuta desde la raíz del repositorio)`);
const manifest = readFileSync(`${SRC}/rufi.xml`, 'utf8');
const version = (manifest.match(/<version>([0-9]+\.[0-9]+\.[0-9]+)<\/version>/) || [])[1];
if (!version) fail('rufi.xml sin <version> x.y.z');

// Archivos de la carpeta (sin ocultos).
const walk = (dir) => readdirSync(dir).filter((n) => !n.startsWith('.')).flatMap((n) => {
  const p = path.join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [path.relative(SRC, p).split(path.sep).join('/')];
});
const files = walk(SRC).sort();

// Todo lo que lista el manifiesto tiene que existir.
for (const [, kind, name] of manifest.matchAll(/<(folder|filename)[^>]*>([^<]+)<\/\1>/g)) {
  if (!files.some((f) => f === name || f.startsWith(`${name}/`))) fail(`el manifiesto lista ${kind} «${name}» y no existe`);
}
for (const [, name] of manifest.matchAll(/<language tag="[^"]+">([^<]+)<\/language>/g)) {
  if (!files.includes(`language/${name}`)) fail(`el manifiesto lista el idioma «${name}» y no existe`);
}

mkdirSync('build', { recursive: true });
const zip = path.resolve(`build/plg_system_rufi-${version}.zip`);
rmSync(zip, { force: true });
execFileSync('zip', ['-X', '-q', zip, ...files], { cwd: SRC });

// ------------------------------------------------------------------ verificación del zip
const listed = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).split('\n').filter((l) => l && !l.endsWith('/')).sort();
if (JSON.stringify(listed) !== JSON.stringify(files)) fail(`el zip no coincide con la carpeta:\n  zip: ${listed.join(', ')}\n  carpeta: ${files.join(', ')}`);
ok(`${listed.length} archivos, los mismos que ${SRC}/`);
if (!listed.includes('rufi.xml')) fail('rufi.xml no está en la raíz del zip');
ok('rufi.xml en la raíz del zip');
if (listed.some((f) => f.includes('..') || f.startsWith('/'))) fail('rutas no seguras en el zip');

const out = mkdtempSync(path.join(tmpdir(), 'rufi-joomla-'));
try {
  execFileSync('unzip', ['-q', zip, '-d', out]);
  for (const f of files) {
    if (sha(readFileSync(path.join(out, f))) !== sha(readFileSync(path.join(SRC, f)))) fail(`${f} distinto en el zip`);
  }
  ok('contenido idéntico byte a byte (SHA-256 de cada archivo)');
  const php = spawnSync('php', ['-v']);
  if (php.status === 0) {
    for (const f of files.filter((x) => x.endsWith('.php'))) {
      const r = spawnSync('php', ['-l', path.join(out, f)], { encoding: 'utf8' });
      if (r.status !== 0) fail(`php -l ${f}: ${r.stdout}${r.stderr}`);
    }
    ok('php -l sin errores en los archivos PHP del zip');
  } else {
    console.log('· php no disponible: se omite php -l');
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}

const bytes = readFileSync(zip);
console.log(`\n✓ ${path.relative(process.cwd(), zip)} (${(bytes.length / 1024).toFixed(1)} KB) · versión ${version}\n  SHA-256 ${sha(bytes)}`);
console.log('  Contenido:\n' + listed.map((f) => `    ${f}`).join('\n'));
