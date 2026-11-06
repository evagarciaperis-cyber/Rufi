// Fase D · decisión del cargador 1.1 con los vectores COMPARTIDOS del contrato (spec/vectors/).
// Se prueba dos veces: con src/loader-core.js tal cual (Node) y con el MISMO módulo empaquetado por
// esbuild como en dist/rufi.js (esquemas sin descripciones, minificado, es2017). Si el empaquetado
// cambiara alguna regla, estas pruebas fallarían.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import { schemaPlugin } from '../scripts/esbuild-schema.mjs';
import * as src from '../src/loader-core.js';

const J = (p) => JSON.parse(readFileSync(p, 'utf8'));
const V = 'spec/vectors';
const out = path.resolve('build/test/loader-core.bundle.mjs');
mkdirSync(path.dirname(out), { recursive: true });
await build({ entryPoints: ['src/loader-core.js'], outfile: out, bundle: true, format: 'esm', minify: true, target: ['es2017'], plugins: [schemaPlugin], legalComments: 'none', logLevel: 'silent' });
const bundled = await import(pathToFileURL(out).href + `?t=${Date.now()}`);

const resolveInput = (input, envelopes) => {
  const ref = (x) => (typeof x === 'string' ? envelopes[x] : x);
  const res = (x) => (x && x.envelope ? { ...x, envelope: ref(x.envelope) } : x);
  return { ...input, remote: Object.fromEntries(Object.entries(input.remote || {}).map(([k, v]) => [k, res(v)])), cache: { status: ref(input.cache.status), page: ref(input.cache.page) } };
};

for (const [label, core] of [['src', src], ['empaquetado', bundled]]) {
  test(`[${label}] decide: los 30 casos de spec/vectors/decision.json`, () => {
    const { envelopes, cases } = J(`${V}/decision.json`);
    assert.equal(cases.length, 30);
    for (const c of cases) {
      const got = core.run(resolveInput(c.input, envelopes));
      for (const [k, v] of Object.entries(c.expect)) assert.deepEqual(got[k], v, `${c.name}: ${k} = ${JSON.stringify(got[k])}, se esperaba ${JSON.stringify(v)}`);
    }
  });

  test(`[${label}] decideLive: los 8 casos de spec/vectors/live.json`, () => {
    const { envelopes, cases } = J(`${V}/live.json`);
    assert.equal(cases.length, 8);
    for (const c of cases) {
      const got = core.runLive(resolveInput(c.input, envelopes), c.current);
      for (const [k, v] of Object.entries(c.expect)) assert.deepEqual(got[k], v, `${c.name}: ${k}`);
    }
  });

  test(`[${label}] el apagado siempre gana (625 combinaciones)`, () => {
    const { envelopes: E, cases } = J(`${V}/decision.json`);
    const G = cases[6].input.localGlobal;
    const statuses = [null, E.st5, E.st7, E.stKilled6, E.stKilled8];
    const pages = [null, E.pg9, E.pg10, E.pg12, E.pgDisabled11];
    const res = (e) => (e ? { kind: 'ok', envelope: e } : { kind: 'timeout' });
    let n = 0;
    for (const rs of statuses) for (const cs of statuses) for (const rp of pages) for (const cp of pages) {
      const d = core.run({ query: {}, localGlobal: G, slug: 'demo', now: '2026-11-06T12:00:00Z', remote: { status: res(rs), page: res(rp) }, cache: { status: cs, page: cp } });
      const bestS = [rs, cs].filter(Boolean).sort((a, b) => b.revision - a.revision)[0];
      const bestP = [rp, cp].filter(Boolean).sort((a, b) => b.revision - a.revision)[0];
      if (!bestS || bestS.status === 'killed' || (bestP && bestP.status !== 'active')) assert.notEqual(d.load, true);
      n++;
    }
    assert.equal(n, 625);
  });

  test(`[${label}] source de _global.json según el contrato (localGlobal)`, () => {
    assert.equal(core.sourceOf(null).mode, 'legacy');
    assert.equal(core.sourceOf({ enabled: true, version: '1.0.0' }).mode, 'legacy');
    assert.equal(core.sourceOf({ source: {} }).mode, 'legacy', 'igual que decide(): sin source.static → 1.0');
    const ok = core.sourceOf(J(`${V}/api/valid/source-local.json`).value);
    assert.equal(ok.mode, 'storage'); assert.ok(ok.timeoutMs >= 500 && ok.recheckSeconds >= 60);
    for (const n of readdirSync(`${V}/api/invalid`).filter((x) => x.startsWith('source-'))) assert.equal(core.sourceOf(J(`${V}/api/invalid/${n}`).value).mode, 'invalid', n);
    assert.equal(core.sourceOf({ source: { static: 'https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/rufi-public/v1', extra: 1 } }).mode, 'invalid');
  });

  test(`[${label}] respuestas HTTP → resultado (JSON manipulado, demasiado grande, 404, 5xx)`, () => {
    assert.deepEqual(core.toResult(404, ''), { kind: 'not-found' });
    assert.deepEqual(core.toResult(500, ''), { kind: 'error', status: 500 });
    assert.deepEqual(core.toResult(400, '{"statusCode":"404","error":"not_found","message":"Object not found"}'), { kind: 'not-found' });
    assert.deepEqual(core.toResult(400, '{"statusCode":"400"}'), { kind: 'error', status: 400 });
    assert.deepEqual(core.toResult(200, '{"a":'), { kind: 'ok', envelope: null });
    assert.deepEqual(core.toResult(200, 'x'.repeat(65 * 1024)), { kind: 'ok', envelope: null });
    const { envelopes: E, cases } = J(`${V}/decision.json`);
    const G = cases[6].input.localGlobal;
    const base = { query: {}, localGlobal: G, slug: 'demo', now: '2026-11-06T12:00:00Z' };
    // estado manipulado (no es JSON) y sin copia → no carga
    assert.equal(core.run({ ...base, remote: { status: core.toResult(200, '{oops'), page: { kind: 'ok', envelope: E.pg10 } }, cache: { status: null, page: null } }).reason, 'status-unknown');
    // página manipulada y sin copia → no carga
    assert.equal(core.run({ ...base, remote: { status: { kind: 'ok', envelope: E.st5 }, page: core.toResult(200, '<html>') }, cache: { status: null, page: null } }).reason, 'page-invalid');
    // un campo cambiado a mano (revisión en texto) invalida el sobre
    assert.equal(core.run({ ...base, remote: { status: { kind: 'ok', envelope: { ...E.st5, revision: '99' } }, page: { kind: 'ok', envelope: E.pg10 } }, cache: { status: null, page: null } }).load, false);
    // copia de localStorage manipulada
    assert.equal(core.parseCached('{"a"'), null);
    assert.equal(core.parseCached('"texto"'), null);
  });

  test(`[${label}] configuración en la página: solo cuenta el estado global`, () => {
    const { envelopes: E, cases } = J(`${V}/decision.json`);
    const G = cases[6].input.localGlobal;
    const run = (st, cache = null, extra = {}) => core.decideInline({ query: {}, localGlobal: G, now: '2026-11-06T12:00:00Z', remote: { status: st }, cache: { status: cache, page: null }, ...extra });
    assert.equal(run({ kind: 'ok', envelope: E.st5 }).load, true);
    assert.equal(run({ kind: 'ok', envelope: E.stKilled6 }).load, false);
    assert.equal(run({ kind: 'timeout' }).reason, 'status-unknown');
    assert.equal(run({ kind: 'timeout' }, E.stKilled8).reason, 'killed');
    assert.equal(run({ kind: 'ok', envelope: E.st7 }, E.stKilled8).reason, 'killed', 'la marca de apagado vista gana');
    assert.equal(run({ kind: 'ok', envelope: E.stCaducado }).reason, 'status-unknown');
    assert.equal(run({ kind: 'ok', envelope: E.st5 }, null, { localGlobal: { ...G, enabled: false } }).reason, 'local-kill');
  });

  test(`[${label}] rutas de Joomla: archivo válido y sin caducar`, () => {
    const { value } = J(`${V}/api/valid/ruta.json`);
    const now = new Date(Date.parse(value.issuedAt) + 1000).toISOString();
    assert.equal(core.slugFromRoute({ kind: 'ok', envelope: value }, now), value.slug);
    assert.equal(core.slugFromRoute({ kind: 'ok', envelope: value }, value.expiresAt), null, 'caducada');
    assert.equal(core.slugFromRoute({ kind: 'ok', envelope: { ...value, extra: 1 } }, now), null, 'campos de más');
    assert.equal(core.slugFromRoute({ kind: 'not-found' }, now), null);
    for (const c of J(`${V}/routes.json`).cases) assert.equal(core.normalizePath(c.input), c.normalized, c.input);
  });

  test(`[${label}] token de vista previa: solo con la forma v1.<claims>.<firma>`, () => {
    assert.ok(core.PREVIEW_TOKEN_RE.test('v1.' + 'a'.repeat(40) + '.' + 'b'.repeat(43)));
    for (const t of ['v1.x.y', 'v2.' + 'a'.repeat(40) + '.' + 'b'.repeat(43), 'v1.' + 'a'.repeat(40) + '.' + 'b'.repeat(42), 'v1.<script>.' + 'b'.repeat(43)]) assert.ok(!core.PREVIEW_TOKEN_RE.test(t), t);
  });
}

test('el empaquetado del cargador no lleva descripciones de los esquemas, pero sí todas las reglas', () => {
  const txt = readFileSync(out, 'utf8');
  assert.ok(!txt.includes('Nota interna: qué página es'), 'sin descripciones');
  assert.ok(txt.includes('rufi-public'), 'patrón de la cubeta');
});
