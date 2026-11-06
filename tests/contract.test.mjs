// Contrato 1.1 (configuración + API Rufi ↔ CRM): casos compartidos de spec/vectors/.
// El CRM (fase B) y el cargador/motor 1.1.0 (fase D) deben pasar estos mismos casos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { validateSchema, validateConfig, validateApi, validateEnvelope, validateStatus, validateRoute, features11 } from '../tools/validate-config.mjs';
import { decide, decideLive } from '../spec/reference/decide.mjs';
import { guardPublicObject, planPublish, applyPlan, pagePath, routePath, STATUS_PATH } from '../spec/reference/publish.mjs';
import { normalizePath, routeObjectName } from '../spec/reference/routes.mjs';
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

const byDef = (def, v) => (def === 'pageEnvelope' ? validateEnvelope(v).errors : def === 'statusFile' ? validateStatus(v).errors : def === 'routeFile' ? validateRoute(v).errors : validateApi(v, def));

test('API: archivos públicos y mensajes válidos', () => {
  for (const n of dir(`${V}/api/valid`)) {
    const { def, value } = J(`${V}/api/valid/${n}`);
    const errs = byDef(def, value);
    assert.deepEqual(errs, [], n);
  }
});

test('API: casos inválidos, cada uno con el error esperado', () => {
  const expect = J(`${V}/api/invalid/_expect.json`);
  assert.deepEqual(Object.keys(expect).sort(), dir(`${V}/api/invalid`));
  for (const [n, want] of Object.entries(expect)) {
    const { def, value } = J(`${V}/api/invalid/${n}`);
    const errs = byDef(def, value);
    assert.ok(errs.some((e) => e.includes(want)), `${n}: se esperaba «${want}», hubo: ${errs.join(' | ') || '(ninguno)'}`);
  }
});

test('API: caducidad', () => {
  const { value } = J(`${V}/api/valid/pagina-activa.json`);
  assert.equal(validateEnvelope(value, { now: '2026-11-13T09:59:59Z' }).expired, false);
  assert.equal(validateEnvelope(value, { now: '2026-11-13T10:00:00Z' }).expired, true);
});

const fns = {
  validPage: (e, now) => { const r = validateEnvelope(e, { now }); return r.errors.length === 0 && !r.expired; },
  validStatus: (e, now) => { const r = validateStatus(e, { now }); return r.errors.length === 0 && !r.expired; },
};
const resolveInput = (input, envelopes) => {
  const ref = (x) => (typeof x === 'string' ? envelopes[x] : x);
  const res = (x) => (x && x.envelope ? { ...x, envelope: ref(x.envelope) } : x);
  return { ...input, remote: Object.fromEntries(Object.entries(input.remote || {}).map(([k, v]) => [k, res(v)])), cache: { status: ref(input.cache.status), page: ref(input.cache.page) } };
};

test('decisión del cargador (vectores): visitantes nuevos y que vuelven', () => {
  const { envelopes, cases } = J(`${V}/decision.json`);
  assert.ok(cases.some((c) => c.visitor === 'nuevo') && cases.some((c) => c.visitor === 'vuelve'));
  for (const c of cases) {
    const got = decide(resolveInput(c.input, envelopes), fns);
    for (const [k, v] of Object.entries(c.expect)) assert.deepEqual(got[k], v, `${c.name}: ${k} = ${JSON.stringify(got[k])}, se esperaba ${JSON.stringify(v)}`);
  }
});

test('páginas que siguen abiertas (vectores)', () => {
  const { envelopes, cases } = J(`${V}/live.json`);
  for (const c of cases) {
    const got = decideLive(resolveInput(c.input, envelopes), c.current, fns);
    for (const [k, v] of Object.entries(c.expect)) assert.deepEqual(got[k], v, `${c.name}: ${k} = ${JSON.stringify(got[k])}`);
  }
});

test('las marcas de apagado siempre ganan a configuraciones antiguas (exhaustivo)', () => {
  // Para cualquier combinación de estados/páginas remotos y en caché, si la marca de apagado vista
  // tiene la revisión más alta, el resultado nunca es «cargar».
  const { envelopes: E } = J(`${V}/decision.json`);
  const G = J(`${V}/decision.json`).cases[6].input.localGlobal;
  const statuses = [null, E.st5, E.st7, E.stKilled6, E.stKilled8];
  const pages = [null, E.pg9, E.pg10, E.pg12, E.pgDisabled11];
  const res = (e) => (e ? { kind: 'ok', envelope: e } : { kind: 'timeout' });
  let n = 0;
  for (const rs of statuses) for (const cs of statuses) for (const rp of pages) for (const cp of pages) {
    const d = decide({ query: {}, localGlobal: G, slug: 'demo', now: '2026-11-06T12:00:00Z', remote: { status: res(rs), page: res(rp) }, cache: { status: cs, page: cp } }, fns);
    const bestS = [rs, cs].filter(Boolean).sort((a, b) => b.revision - a.revision)[0];
    const bestP = [rp, cp].filter(Boolean).sort((a, b) => b.revision - a.revision)[0];
    if ((bestS && bestS.status === 'killed') || (bestP && bestP.status !== 'active') || !bestS) assert.notEqual(d.load, true, JSON.stringify({ rs: rs && rs.revision, cs: cs && cs.revision, rp: rp && rp.revision, cp: cp && cp.revision, d }));
    n++;
  }
  assert.equal(n, 625);
});

const validators = { page: (o, x) => validateEnvelope(o, x), status: (o, x) => validateStatus(o, x), route: (o, x) => validateRoute(o, x) };

test('cubeta pública: solo rutas permitidas (borradores, copias, IA y datos del CRM rechazados)', () => {
  const { valid, invalid } = J(`${V}/public-paths.json`);
  const { envelopes: E } = J(`${V}/decision.json`);
  const bodyFor = (p) => (p === STATUS_PATH ? E.st5 : p.startsWith('v1/pages/') ? { ...E.pg10, slug: p.slice(9, -5), config: { ...E.pg10.config, page: p.slice(9, -5) } } : { api: 'rufi-crm/1', slug: 'demo', revision: 1, issuedAt: E.st5.issuedAt, expiresAt: E.st5.expiresAt });
  for (const p of valid) assert.ok(guardPublicObject(p, bodyFor(p), validators, { now: '2026-11-06T12:00:00Z' }).ok, p);
  for (const p of invalid) assert.equal(guardPublicObject(p, E.st5, validators).ok, false, p);
});

test('cubeta pública: el contenido también se controla (no solo la ruta)', () => {
  const { envelopes: E } = J(`${V}/decision.json`);
  const now = '2026-11-06T12:00:00Z';
  assert.equal(guardPublicObject(pagePath('demo'), E.pgFuga, validators, { now }).ok, false, 'campo con datos del CRM');
  assert.equal(guardPublicObject(pagePath('demo'), E.pgPreview, validators, { now }).ok, false, 'vista previa');
  assert.equal(guardPublicObject(pagePath('otra'), E.pg10, validators, { now }).ok, false, 'slug distinto del archivo');
  assert.equal(guardPublicObject(pagePath('demo'), E.pgCaducada, validators, { now }).ok, false, 'caducado');
  assert.equal(guardPublicObject(STATUS_PATH, E.pg10, validators, { now }).ok, false, 'una página en status.json');
  assert.equal(guardPublicObject(pagePath('demo'), { ...E.pg10, config: { ...E.pg10.config, ai: { enabled: false, instructions: 'secreto' } } }, validators, { now }).ok, false, 'instrucciones de IA');
  assert.equal(guardPublicObject(pagePath('demo'), 'x'.repeat(70000), validators, { now }).ok, false, 'no JSON / tamaño');
  assert.ok(guardPublicObject(pagePath('demo'), E.pg10, validators, { now }).ok);
});

test('publicación a medias: cualquier corte deja un estado seguro', () => {
  const { envelopes: E } = J(`${V}/decision.json`);
  const G = J(`${V}/decision.json`).cases[6].input.localGlobal;
  const now = '2026-11-06T12:00:00Z';
  const H = 'b'.repeat(64), H2 = 'c'.repeat(64);
  const route = (slug, rev) => ({ api: 'rufi-crm/1', slug, revision: rev, issuedAt: E.st5.issuedAt, expiresAt: E.st5.expiresAt });
  const look = (store, returning) => decide({ query: {}, localGlobal: G, slug: 'demo', now, remote: { status: store.has(STATUS_PATH) ? { kind: 'ok', envelope: store.get(STATUS_PATH) } : { kind: 'not-found' }, page: store.has(pagePath('demo')) ? { kind: 'ok', envelope: store.get(pagePath('demo')) } : { kind: 'not-found' } }, cache: returning || { status: null, page: null } }, fns);
  const base = () => new Map([[STATUS_PATH, E.st5], [pagePath('demo'), E.pg10], [routePath(H2), route('demo', 3)]]);
  const ops = {
    'apagar sitio': { type: 'kill-site', status: E.stKilled6 },
    'apagar página': { type: 'disable-page', envelope: E.pgDisabled11, routesRemove: [H2] },
    'publicar página con ruta nueva': { type: 'publish-page', envelope: E.pg12, routesAdd: [{ hash: H, body: route('demo', 12) }], routesRemove: [H2] },
  };
  for (const [name, op] of Object.entries(ops)) {
    const steps = planPublish(op);
    for (let k = -1; k < steps.length; k++) {
      const store = base();
      const res = applyPlan(store, steps, validators, { failAt: k, now });
      const d = look(store);
      if (k === -1) assert.ok(res.complete, name);
      else assert.ok(!res.complete && res.pending.length > 0, `${name}: el diario marca la operación incompleta`);
      // Invariantes: nunca se muestra una configuración que no sea la anterior completa o la nueva completa.
      if (d.load) assert.ok([10, 12].includes(d.revision), `${name} (corte en ${k}): revisión mostrada ${d.revision}`);
      if (name !== 'publicar página con ruta nueva' && res.complete) assert.equal(d.load, false, `${name}: completo → apagado`);
      if (name === 'apagar página' && k > 0) assert.equal(d.load, false, 'en cuanto se escribe la página apagada, no se muestra aunque queden rutas');
    }
  }
  // Apagar el sitio es UNA escritura: no hay estado intermedio posible.
  assert.equal(planPublish(ops['apagar sitio']).length, 1);
  // Orden de «publicar»: rutas nuevas antes de la página, borrado de rutas viejas al final.
  assert.deepEqual(planPublish(ops['publicar página con ruta nueva']).map((s) => s.op + ' ' + s.path.split('/')[1]), ['put routes', 'put pages', 'delete routes']);
  // Una subida rechazada por el control para la operación (no se escribe nada más).
  const store = base();
  const r = applyPlan(store, [{ op: 'put', path: 'v1/drafts/demo.json', body: E.pg12 }, { op: 'put', path: pagePath('demo'), body: E.pg12 }], validators, { now });
  assert.ok(r.rejected && !r.complete); assert.equal(store.get(pagePath('demo')).revision, 10);
});

test('rutas de Joomla: normalización y nombre con hash (vectores)', async () => {
  const sha = async (s) => createHash('sha256').update(s).digest('hex');
  for (const c of J(`${V}/routes.json`).cases) {
    assert.equal(normalizePath(c.input), c.normalized, JSON.stringify(c.input).slice(0, 60));
    assert.equal(await routeObjectName(c.input, sha), c.sha256 ? `${c.sha256}.json` : null);
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

test('herramienta de medición de propagación (servidor simulado con caché que tarda 7 s)', async () => {
  const { measure } = await import('../tools/measure-propagation.mjs');
  let t = 0; const changeVisibleAt = 7000;
  const fetchImpl = async () => ({ ok: true, status: 200, headers: new Map([['cf-cache-status', t < changeVisibleAt ? 'HIT' : 'MISS']]), json: async () => ({ revision: t < changeVisibleAt ? 127 : 128 }) });
  const r = await measure({ url: 'https://x', revision: 128, since: 0, every: 2000, timeout: 60000, fetchImpl, now: () => t, sleep: async (ms) => { t += ms; } });
  assert.ok(r.ok); assert.equal(r.seconds, 8); assert.equal(r.attempts, 5);
  const never = await measure({ url: 'https://x', revision: 999, since: 0, every: 2000, timeout: 10000, fetchImpl, now: () => t, sleep: async (ms) => { t += ms; } });
  assert.equal(never.ok, false);
});
