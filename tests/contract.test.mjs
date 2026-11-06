// Contrato 1.1 (configuración + API Rufi ↔ CRM): casos compartidos de spec/vectors/.
// El CRM (fase B) y el cargador/motor 1.1.0 (fase D) deben pasar estos mismos casos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { validateSchema, validateConfig, validateApi, validateEnvelope, features11 } from '../tools/validate-config.mjs';
import { decide } from '../spec/reference/decide.mjs';
import { pickLang, resolveTexts, LANGS } from '../spec/reference/i18n.mjs';

const J = (p) => JSON.parse(readFileSync(p, 'utf8'));
const dir = (d) => readdirSync(d).filter((n) => n.endsWith('.json') && !n.startsWith('_')).sort();
const V = 'spec/vectors';
const SCHEMA_10 = J('spec/contract/1.0/rufi-config.schema.json');
const SCHEMA_11 = J('spec/rufi-config.schema.json');
const v10 = (cfg) => validateSchema(cfg, SCHEMA_10, '', SCHEMA_10);
const repoConfigs = [...dir('configs').map((n) => `configs/${n}`), ...dir('configs/ejemplos').map((n) => `configs/ejemplos/${n}`)];

test('el esquema 1.0 congelado no ha cambiado (huella)', () => {
  assert.equal(createHash('sha256').update(readFileSync('spec/contract/1.0/rufi-config.schema.json')).digest('hex'), 'fc4de53c5948da15db38a7bce3a4094511fd8c4208fc89f618d0791f0844bf2f');
});

test('1.1 es una ampliación de 1.0: no falta ninguna propiedad ni definición', () => {
  const walk = (a, b, at) => {
    if (!a || typeof a !== 'object') return;
    for (const k of ['properties', '$defs']) for (const p of Object.keys(a[k] || {})) {
      assert.ok(b[k] && p in b[k], `${at}/${k}/${p} desaparece en 1.1`);
      walk(a[k][p], b[k][p], `${at}/${k}/${p}`);
    }
  };
  walk(SCHEMA_10, SCHEMA_11, '');
  for (const r of SCHEMA_10.required) assert.ok(SCHEMA_11.required.includes(r));
  assert.deepEqual(SCHEMA_11.required, SCHEMA_10.required, '1.1 no añade campos obligatorios');
});

test('compatibilidad: toda configuración 1.0 del repositorio sigue siendo válida en 1.1', () => {
  for (const p of [...repoConfigs, `${V}/config/valid/v10-minima.json`]) {
    const c = J(p);
    assert.deepEqual(v10(c), [], `${p} (1.0)`);
    assert.deepEqual(validateConfig(c).errors, [], `${p} (1.1)`);
    assert.deepEqual(features11(c), [], `${p} no usa campos 1.1`);
  }
});

test('configuraciones válidas (vectores)', () => {
  for (const n of dir(`${V}/config/valid`)) assert.deepEqual(validateConfig(J(`${V}/config/valid/${n}`)).errors, [], n);
});

test('configuraciones inválidas: cada una con el error esperado', () => {
  const expect = J(`${V}/config/invalid/_expect.json`);
  assert.deepEqual(Object.keys(expect).sort(), dir(`${V}/config/invalid`), 'todos los casos tienen error esperado');
  for (const [n, want] of Object.entries(expect)) {
    const errs = validateConfig(J(`${V}/config/invalid/${n}`)).errors;
    assert.ok(errs.some((e) => e.includes(want)), `${n}: se esperaba «${want}», hubo: ${errs.join(' | ') || '(ninguno)'}`);
  }
});

test('enlaces: el esquema 1.0 aceptaba javascript:, el 1.1 no (endurecimiento documentado)', () => {
  const c = J(`${V}/config/invalid/href-javascript.json`); delete c.contract; delete c.version; delete c.lang;
  assert.deepEqual(v10(c), []);
  assert.ok(validateConfig(c).errors.some((e) => e.includes('href')));
});

test('configuración 1.1 sin versión de motor: válida con aviso; con motor 1.0.0: error', () => {
  const c = J(`${V}/config/valid/v11-cinco-idiomas.json`); delete c.version;
  const r = validateConfig(c);
  assert.deepEqual(r.errors, []); assert.ok(r.warnings.some((w) => w.includes('≥ 1.1.0')));
  assert.ok(validateConfig(c, { engine: '1.0.0' }).errors.some((e) => e.includes('≥ 1.1.0')));
});

test('traducciones incompletas: aviso con lo que falta', () => {
  const c = J(`${V}/config/valid/v11-cinco-idiomas.json`); delete c.i18n.it.triggers;
  assert.ok(validateConfig(c).warnings.some((w) => w.startsWith('/i18n/it') && w.includes('llega-info')));
});

test('API: sobres y mensajes válidos', () => {
  for (const n of dir(`${V}/api/valid`)) {
    const { def, value } = J(`${V}/api/valid/${n}`);
    const errs = def === 'pageEnvelope' ? validateEnvelope(value).errors : validateApi(value, def);
    assert.deepEqual(errs, [], n);
  }
});

test('API: casos inválidos, cada uno con el error esperado', () => {
  const expect = J(`${V}/api/invalid/_expect.json`);
  assert.deepEqual(Object.keys(expect).sort(), dir(`${V}/api/invalid`));
  for (const [n, want] of Object.entries(expect)) {
    const { def, value } = J(`${V}/api/invalid/${n}`);
    const errs = def === 'pageEnvelope' ? validateEnvelope(value).errors : validateApi(value, def);
    assert.ok(errs.some((e) => e.includes(want)), `${n}: se esperaba «${want}», hubo: ${errs.join(' | ') || '(ninguno)'}`);
  }
});

test('API: caducidad', () => {
  const { value } = J(`${V}/api/valid/pagina-activa.json`);
  assert.equal(validateEnvelope(value, { now: '2026-11-13T09:59:59Z' }).expired, false);
  assert.equal(validateEnvelope(value, { now: '2026-11-13T10:00:00Z' }).expired, true);
});

test('decisión del cargador en modo API (vectores)', () => {
  const { envelopes, cases } = J(`${V}/decision.json`);
  const ref = (x) => (typeof x === 'string' ? envelopes[x] : x);
  const isValid = (env, now) => { const r = validateEnvelope(env, { now }); return r.errors.length === 0 && !r.expired; };
  for (const c of cases) {
    const i = { ...c.input, cache: ref(c.input.cache), fallback: ref(c.input.fallback), api: c.input.api && c.input.api.envelope ? { ...c.input.api, envelope: ref(c.input.api.envelope) } : c.input.api };
    const got = decide(i, { isValid });
    for (const [k, v] of Object.entries(c.expect)) assert.deepEqual(got[k], v, `${c.name}: ${k} = ${JSON.stringify(got[k])}, se esperaba ${JSON.stringify(v)}`);
  }
});

test('idioma: elección (vectores)', () => {
  const { config, cases } = J(`${V}/i18n.json`);
  const cfg = J(`${V}/${config}`);
  for (const c of cases) assert.equal(pickLang({ ...c.input, cfg }), c.expect, c.name);
  assert.equal(pickLang({ htmlLang: 'en', cfg: J(`${V}/config/valid/v11-sin-traducciones.json`) }), 'es', 'sin traducciones → base');
});

test('idioma: textos resueltos para los 5 idiomas, válidos y sin i18n', () => {
  const cfg = J(`${V}/config/valid/v11-ia-activada.json`);
  for (const l of LANGS) {
    const r = resolveTexts(cfg, l);
    assert.equal(r.lang, l); assert.ok(!('i18n' in r));
    assert.deepEqual(validateConfig(r).errors, [], l);
    if (l !== 'es') {
      assert.equal(r.welcome.text, cfg.i18n[l].welcome.text);
      assert.equal(r.panel.options[1].label, cfg.i18n[l].panel.options.asesor.label);
      assert.equal(r.triggers[0].say, cfg.i18n[l].triggers['llega-info'].say);
      assert.equal(r.ai.notice, cfg.i18n[l].ai.notice);
      assert.deepEqual(r.panel.options.map((o) => o.action), cfg.panel.options.map((o) => o.action), 'las acciones no se traducen');
    }
  }
  const partial = J(`${V}/config/valid/v11-cinco-idiomas.json`); delete partial.i18n.en.triggers;
  assert.equal(resolveTexts(partial, 'en').triggers[0].say, partial.triggers[0].say, 'lo que falta queda en el idioma base');
});

test('huellas del contrato 1.1 al día (spec/contract/1.1.sha256, la copia fijada del CRM)', () => {
  const lines = readFileSync('spec/contract/1.1.sha256', 'utf8').trim().split('\n');
  const listed = lines.map((l) => l.split(/\s+/)[1]).sort();
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));
  const actual = ['spec/rufi-config.schema.json', 'spec/rufi-crm-api.schema.json', ...walk('spec/reference'), ...walk('spec/vectors')].sort();
  assert.deepEqual(listed, actual, 'archivos del contrato');
  for (const l of lines) { const [h, f] = l.split(/\s+/); assert.equal(createHash('sha256').update(readFileSync(f)).digest('hex'), h, `${f} cambió: regenera spec/contract/1.1.sha256 y avisa al CRM`); }
});
