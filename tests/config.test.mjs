import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { validateConfig } from '../tools/validate-config.mjs';

const load = (p) => JSON.parse(readFileSync(p, 'utf8'));
const pages = [...readdirSync('configs').filter((n) => n.endsWith('.json') && !n.startsWith('_')).map((n) => `configs/${n}`), ...readdirSync('configs/ejemplos').map((n) => `configs/ejemplos/${n}`)];

test('todas las configuraciones de página son válidas', () => {
  for (const p of pages) assert.deepEqual(validateConfig(load(p)).errors, [], p);
});

test('la configuración de pruebas solo difiere en lo previsto', () => {
  const prod = load('configs/aval-ico-valencia.json'), t = load('configs/aval-ico-valencia-test.json');
  assert.equal(t.test, true); assert.equal(t.page, 'aval-ico-valencia-test'); assert.ok(!prod.test);
  assert.ok(t.whatsapp.message.startsWith('[PRUEBA RUFI] ')); assert.ok(!prod.whatsapp.message.includes('PRUEBA'));
  assert.deepEqual(t.panel.options.map((o) => o.action), prod.panel.options.map((o) => o.action));
  assert.deepEqual(t.triggers.map((x) => [x.id, x.on, x.selector, x.say]), prod.triggers.map((x) => [x.id, x.on, x.selector, x.say]));
});

test('_global.json y _routes.json apuntan a cosas que existen', () => {
  const g = load('configs/_global.json'), pkg = load('package.json');
  // _global.json apunta a una versión publicada (scripts/published-versions.json) o a la que se construye.
  // Fase D: sigue en 1.0.0 hasta que se autorice el cambio a 1.1.0.
  const published = Object.keys(load('scripts/published-versions.json')).filter((k) => k !== '$comment');
  assert.ok(g.version === pkg.rufiVersion || published.includes(g.version), `versión ${g.version}`);
  for (const n of g.disabledPages) assert.ok(pages.includes(`configs/${n}.json`), n);
  for (const r of load('configs/_routes.json').routes) { assert.ok(r.path || r.prefix); assert.ok(pages.includes(`configs/${r.config}.json`), r.config); }
});

test('el validador detecta errores típicos', () => {
  const base = load('configs/aval-ico-valencia.json');
  const bad = (mut) => { const c = structuredClone(base); mut(c); return validateConfig(c).errors; };
  assert.ok(bad((c) => { c.panel.options.push(structuredClone(c.panel.options[0])); }).some((e) => e.includes('ids repetidos')));
  assert.ok(bad((c) => { delete c.whatsapp; }).some((e) => e.includes('/whatsapp/number')));
  assert.ok(bad((c) => { c.whatsapp.number = '+34 674'; }).some((e) => e.includes('formato')));
  assert.ok(bad((c) => { c.panel.options[0].action = { type: 'scroll' }; }).some((e) => e.includes('target')));
  assert.ok(bad((c) => { c.triggers[1].on = 'complete'; delete c.triggers[1].match; }).some((e) => e.includes('match')));
  assert.ok(bad((c) => { c.colorr = 'x'; }).some((e) => e.includes('propiedad desconocida')));
  assert.ok(bad((c) => { c.triggers[0].say = 'x'.repeat(201); }).some((e) => e.includes('demasiado largo')));
  assert.deepEqual(validateConfig(base, { html: '<div id="test"></div>' }).errors.filter((e) => e.includes('#simulador')).length > 0, true);
});
