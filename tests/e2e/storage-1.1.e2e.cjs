/**
 * Fase D · cargador 1.1 + motor 1.1.0 en Chromium, con un Supabase Storage FALSO y local.
 *
 * - Storage falso: servidor Node `http` en 127.0.0.1 (puerto libre) con los archivos públicos del
 *   contrato (v1/status.json, v1/pages/<slug>.json, v1/routes/<sha256>.json). Se puede cambiar su
 *   contenido durante la prueba, devolver JSON roto, tardar más que timeoutMs o cortar la conexión.
 * - El navegador pide https://abcdefghijklmnopqrst.supabase.co/... (la URL que exige el contrato) y
 *   Playwright reenvía esas peticiones al servidor local. NO hay ninguna llamada a Supabase real.
 * - La API de vista previa del CRM también es falsa y local (secreto de DEMOSTRACIÓN, no el real).
 * - https://referencehome.es/... se sirve desde dist/ (como tests/e2e/loader.e2e.cjs).
 *
 * Uso: npm run build && node tests/e2e/storage-1.1.e2e.cjs
 */
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path'); const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const DIST = path.join(ROOT, 'dist');
const ORIGIN = 'https://referencehome.es';
const STORAGE = 'https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/rufi-public/v1';
const API = 'https://crm.referencehome.es/api/public/rufi/v1';
const DEMO_SECRET = 'solo-para-pruebas-locales-no-es-el-secreto-del-crm';
const TYPES = { '.js': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary', '.webp': 'image/webp' };
const J = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const results = []; let failures = 0;
const ok = (n, c, x = '') => { results.push(`${c ? '✓' : '✗'} ${n}${x ? ` — ${x}` : ''}`); if (!c) failures++; };

// ------------------------------------------------------------------ datos
const G10 = J('configs/_global.json'); // el de producción: sin source → modo 1.0
const G11 = { ...G10, version: '1.1.0', source: { static: STORAGE, api: API, timeoutMs: 1500, recheckSeconds: 300 } };
const iso = (ms) => new Date(Date.now() + ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const H = 3600e3, D = 24 * H;
const status = (st, revision, o = {}) => ({ api: 'rufi-crm/1', scope: 'site', status: st, revision, issuedAt: iso(-H), expiresAt: iso(7 * D), ...o });
const AVAL = J('configs/aval-ico-valencia.json');
const MULTI = J('spec/vectors/config/valid/v11-cinco-idiomas.json');
const page = (cfg, revision, o = {}) => ({ api: 'rufi-crm/1', slug: cfg.page, status: 'active', revision, issuedAt: iso(-H), expiresAt: iso(7 * D), engine: '1.1.0', contract: cfg.contract || '1.0', config: cfg, ...o });
const off = (slug, st, revision) => ({ api: 'rufi-crm/1', slug, status: st, revision, issuedAt: iso(-H), expiresAt: iso(7 * D) });
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const b64u = (b) => Buffer.from(b).toString('base64url');
function previewToken(claims, secret = DEMO_SECRET) {
  const c = b64u(JSON.stringify(claims));
  return `v1.${c}.${crypto.createHmac('sha256', secret).update(`v1.${c}`).digest('base64url')}`;
}

// ------------------------------------------------------------------ Storage y API falsos (Node http)
const store = new Map(); // ruta (v1/...) → { body | raw | status | delay | cut }
const storageLog = [];
function fakeServer() {
  return new Promise((res) => {
    const srv = http.createServer((q, r) => {
      const u = new URL(q.url, 'http://x');
      storageLog.push(u.pathname);
      const cors = { 'access-control-allow-origin': '*', 'cache-control': 'max-age=30' };
      if (u.pathname.startsWith('/api/')) return fakeApi(u, r, cors);
      const key = u.pathname.replace(/^\/storage\/v1\/object\/public\/rufi-public\//, '');
      const f = store.get(key);
      if (!f) { r.writeHead(400, { ...cors, 'content-type': 'application/json' }); return r.end('{"statusCode":"404","error":"not_found","message":"Object not found"}'); } // Supabase responde 400 en objetos inexistentes
      if (f.cut) return q.socket.destroy();
      setTimeout(() => {
        if (f.status === 404) { r.writeHead(404, cors); return r.end(''); }
        r.writeHead(f.status || 200, { ...cors, 'content-type': 'application/json' });
        r.end(f.raw != null ? f.raw : JSON.stringify(f.body));
      }, f.delay || 0);
    }).listen(0, '127.0.0.1', () => res(srv));
  });
}
const drafts = new Map(); // `${slug}:${draft}` → config del borrador
function fakeApi(u, r, cors) {
  // Imitación LOCAL de GET /pages/{slug}?preview=<token> (la ruta real NO existe y no se crea aquí).
  const m = /^\/api\/public\/rufi\/v1\/pages\/([a-z0-9-]+)$/.exec(u.pathname);
  const deny = (code) => { r.writeHead(code, { ...cors, 'content-type': 'application/json', 'cache-control': 'no-store' }); r.end(JSON.stringify({ error: { code: code === 401 ? 'unauthorized' : 'not_found', message: 'no' } })); };
  if (!m) return deny(404);
  const tok = u.searchParams.get('preview') || '';
  const [v, c, s] = tok.split('.');
  if (v !== 'v1' || !c || !s) return deny(401);
  const want = crypto.createHmac('sha256', DEMO_SECRET).update(`v1.${c}`).digest();
  const got = Buffer.from(s, 'base64url');
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return deny(401);
  const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
  if (claims.v !== 1 || claims.slug !== m[1] || !(claims.exp * 1000 > Date.now()) || claims.exp * 1000 - Date.now() > 600e3) return deny(401);
  const cfg = drafts.get(`${claims.slug}:${claims.draft}`); if (!cfg) return deny(404);
  r.writeHead(200, { ...cors, 'content-type': 'application/json', 'cache-control': 'no-store' });
  r.end(JSON.stringify({ ...page(cfg, 0), preview: true, expiresAt: new Date(claims.exp * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z') }));
}

// ------------------------------------------------------------------ escenario
async function open(browser, { global = G11, lang = 'es', url = '/ICO/aval-ico-valencia.html', snippet = `<script src="/rufi/rufi.js" data-rufi-config="aval-ico-valencia" defer></script>`, local = null, port }) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'es-ES' });
  if (local) await ctx.addInitScript((l) => { if (!sessionStorage.getItem('__seeded')) { for (const [k, v] of Object.entries(l)) localStorage.setItem(k, JSON.stringify(v)); sessionStorage.setItem('__seeded', '1'); } }, local);
  await ctx.addInitScript(() => { window.__ev = []; for (const n of ['ready', 'bubble', 'off', 'update', 'destroy']) document.addEventListener(`rufi:${n}`, (e) => window.__ev.push([n, e.detail])); });
  const p = await ctx.newPage();
  const reqs = []; const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(m.text()) && errors.push(m.text()));
  await ctx.route(/^https:\/\/(abcdefghijklmnopqrst\.supabase\.co|crm\.referencehome\.es)\//, async (route) => {
    const u = new URL(route.request().url()); reqs.push(u.host + u.pathname + u.search);
    try { const resp = await route.fetch({ url: `http://127.0.0.1:${port}${u.pathname}${u.search}`, timeout: 10000 }); await route.fulfill({ response: resp }); }
    catch (e) { await route.abort('failed').catch(() => {}); }
  });
  await ctx.route(`${ORIGIN}/**`, async (route) => {
    const u = new URL(route.request().url()); reqs.push(u.pathname + u.search);
    if (!u.pathname.startsWith('/rufi/')) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>p</title></head><body><h1 id="test">Página</h1><div id="simulador"></div><section id="info" style="margin-top:1500px">Info</section>${snippet}</body></html>` });
    const rel = u.pathname.slice(6);
    if (rel === 'configs/_global.json') return global === null ? route.fulfill({ status: 404, body: '' }) : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(global) });
    const f = path.join(DIST, rel);
    if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: 200, contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
  await p.goto(ORIGIN + url, { waitUntil: 'load' });
  const S = {
    p, ctx, reqs, errors,
    mounted: () => p.evaluate(() => !!document.getElementById('rufi-root')),
    waitMount: () => p.waitForFunction(() => !!document.getElementById('rufi-root'), null, { timeout: 15000 }).then(() => true, () => false),
    waitGone: (ms = 8000) => p.waitForFunction(() => !document.getElementById('rufi-root'), null, { timeout: ms }).then(() => true, () => false),
    core: () => reqs.filter((r) => r.includes('rufi-core.js')),
    heavy: () => reqs.some((r) => /rufi-core|rufi-3d|\.glb|\.webp/.test(r)),
    ls: () => p.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith('rufi:v1:')).map((k) => [k, JSON.parse(localStorage.getItem(k))]))),
    ev: () => p.evaluate(() => window.__ev),
    recheck: () => p.evaluate(() => window.dispatchEvent(new Event('online'))),
    close: () => ctx.close(),
  };
  return S;
}
const settle = (S, ms = 2500) => S.p.waitForTimeout(ms);
const noErrors = (t, S) => ok(`${t} sin errores en consola`, S.errors.length === 0, S.errors.slice(0, 2).join(' | '));
function reset(files) { store.clear(); for (const [k, v] of Object.entries(files)) store.set(k, v); }

(async () => {
  const srv = await fakeServer(); const port = srv.address().port;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const base = { 'v1/status.json': { body: status('active', 5) }, 'v1/pages/aval-ico-valencia.json': { body: page(AVAL, 10) } };
  let S, t;

  // 1 · compatibilidad 1.0
  t = '[1.0 · _global.json sin source]'; reset(base); storageLog.length = 0;
  S = await open(browser, { global: G10, port });
  ok(`${t} Rufi se activa`, await S.waitMount());
  ok(`${t} motor publicado 1.0.0 y configuración de Arsys`, S.core()[0] === '/rufi/v/1.0.0/rufi-core.js' && S.reqs.some((r) => r.startsWith('/rufi/configs/aval-ico-valencia.json')));
  ok(`${t} no pide nada a Storage`, !S.reqs.some((r) => r.includes('supabase')) && storageLog.length === 0);
  noErrors(t, S); await S.close();

  t = '[1.0 · configuración 1.0 con el motor 1.1.0]'; reset(base);
  S = await open(browser, { global: { ...G10, version: '1.1.0' }, port });
  ok(`${t} Rufi se activa`, await S.waitMount());
  ok(`${t} núcleo 1.1.0`, S.core()[0] === '/rufi/v/1.1.0/rufi-core.js');
  await S.p.waitForFunction(() => window.__ev.some(([n, d]) => n === 'bubble' && d.id === 'bienvenida'), null, { timeout: 30000 }).catch(() => {});
  ok(`${t} textos en español, como con 1.0.0`, (await S.p.locator('#rufi-root').locator('.bubble-t span').textContent().catch(() => '')) === AVAL.welcome.text);
  ok(`${t} etiqueta de cerrar en español`, (await S.p.locator('#rufi-root').locator('.bubble .x').getAttribute('aria-label')) === 'Cerrar mensaje de Rufi');
  noErrors(t, S); await S.close();

  // 2 · 1.1 con estado activo / apagado
  t = '[1.1 · estado activo + página activa]'; reset(base);
  S = await open(browser, { port });
  ok(`${t} Rufi se activa`, await S.waitMount());
  ok(`${t} pide status.json y su página a Storage (no a Arsys)`, S.reqs.some((r) => r.endsWith('/v1/status.json')) && S.reqs.some((r) => r.endsWith('/v1/pages/aval-ico-valencia.json')) && !S.reqs.some((r) => r.startsWith('/rufi/configs/aval-ico-valencia')));
  ok(`${t} motor del sobre (engine 1.1.0)`, S.core()[0] === '/rufi/v/1.1.0/rufi-core.js');
  let ls = await S.ls();
  ok(`${t} guarda copia del estado y de la página`, ls['rufi:v1:status']?.revision === 5 && ls['rufi:v1:page:aval-ico-valencia']?.revision === 10);
  noErrors(t, S); await S.close();

  t = '[1.1 · sitio apagado (status killed)]'; reset({ ...base, 'v1/status.json': { body: status('killed', 6) } });
  S = await open(browser, { port }); await settle(S);
  ok(`${t} Rufi NO se activa`, !(await S.mounted()));
  ok(`${t} no descarga núcleo, 3D ni modelo`, !S.heavy());
  ok(`${t} guarda la marca de apagado`, (await S.ls())['rufi:v1:status']?.status === 'killed');
  ok(`${t} evento rufi:off con motivo`, (await S.ev()).some(([n, d]) => n === 'off' && d.reason === 'killed'));
  noErrors(t, S); await S.close();

  t = '[1.1 · ?rufi=on no salta el apagado del CRM]'; reset({ ...base, 'v1/status.json': { body: status('killed', 6) } });
  S = await open(browser, { port, url: '/ICO/aval-ico-valencia.html?rufi=on' }); await settle(S);
  ok(`${t} Rufi NO se activa`, !(await S.mounted())); await S.close();

  t = '[1.1 · página apagada (disabled)]'; reset({ ...base, 'v1/pages/aval-ico-valencia.json': { body: off('aval-ico-valencia', 'disabled', 11) } });
  S = await open(browser, { port }); await settle(S);
  ok(`${t} Rufi NO se activa`, !(await S.mounted()) && !S.heavy()); await S.close();

  t = '[1.1 · página retirada (404)]'; reset({ ...base, 'v1/pages/aval-ico-valencia.json': { status: 404 } });
  S = await open(browser, { port, local: { 'rufi:v1:page:aval-ico-valencia': page(AVAL, 9) } }); await settle(S);
  ok(`${t} Rufi NO se activa aunque haya copia`, !(await S.mounted()));
  ok(`${t} borra la copia`, !(await S.ls())['rufi:v1:page:aval-ico-valencia']); await S.close();

  t = '[1.1 · _global.json local enabled:false]'; reset(base);
  S = await open(browser, { port, global: { ...G11, enabled: false }, local: { 'rufi:v1:status': status('active', 5), 'rufi:v1:page:aval-ico-valencia': page(AVAL, 10) } }); await settle(S);
  ok(`${t} Rufi NO se activa y no pide nada a Storage`, !(await S.mounted()) && !S.reqs.some((r) => r.includes('supabase')));
  ok(`${t} borra las copias`, Object.keys(await S.ls()).length === 0); await S.close();

  t = '[1.1 · source no válido (http://)]'; reset(base); storageLog.length = 0;
  S = await open(browser, { port, global: { ...G11, source: { static: STORAGE.replace('https:', 'http:') } } }); await settle(S);
  ok(`${t} falla cerrado: ni Rufi ni modo 1.0 ni Storage`, !(await S.mounted()) && !S.heavy() && !S.reqs.some((r) => r.includes('configs/aval-ico-valencia'))); await S.close();

  // 3 · apagado urgente con la página abierta
  t = '[1.1 · apagado urgente con la página abierta]'; reset(base);
  S = await open(browser, { port });
  ok(`${t} Rufi está activo`, await S.waitMount());
  store.set('v1/status.json', { body: status('killed', 12) });
  await S.recheck();
  ok(`${t} Rufi sale de la página`, await S.waitGone());
  ok(`${t} rufi:off (live) con motivo killed`, (await S.ev()).some(([n, d]) => n === 'off' && d.reason === 'killed' && d.live));
  ok(`${t} el motor 1.1.0 se desmonta (rufi:destroy)`, (await S.ev()).some(([n]) => n === 'destroy'));
  store.set('v1/status.json', { body: status('active', 13) }); await S.recheck(); await settle(S, 1200);
  ok(`${t} no vuelve sin recargar`, !(await S.mounted()));
  noErrors(t, S); await S.close();

  t = '[1.1 · página apagada con la página abierta]'; reset(base);
  S = await open(browser, { port }); await S.waitMount();
  store.set('v1/pages/aval-ico-valencia.json', { body: off('aval-ico-valencia', 'disabled', 14) }); await S.recheck();
  ok(`${t} Rufi sale de la página`, await S.waitGone()); await S.close();

  t = '[1.1 · apagado local (Arsys) con la página abierta]'; reset(base);
  S = await open(browser, { port }); await S.waitMount();
  await S.ctx.route(`${ORIGIN}/rufi/configs/_global.json`, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...G11, enabled: false }) }));
  await S.recheck();
  ok(`${t} Rufi sale de la página`, await S.waitGone()); await S.close();

  t = '[1.1 · corte de red con la página abierta]'; reset(base);
  S = await open(browser, { port }); await S.waitMount();
  store.set('v1/status.json', { cut: true }); store.set('v1/pages/aval-ico-valencia.json', { cut: true }); await S.recheck(); await settle(S, 1500);
  ok(`${t} Rufi se queda (un fallo no lo oculta)`, await S.mounted()); await S.close();

  t = '[1.1 · configuración nueva con la página abierta]'; reset(base);
  S = await open(browser, { port }); await S.waitMount();
  store.set('v1/pages/aval-ico-valencia.json', { body: page(AVAL, 15) }); await S.recheck(); await settle(S, 1500);
  ok(`${t} avisa (rufi:update) y guarda la copia para la siguiente carga`, (await S.ev()).some(([n, d]) => n === 'update' && d.revision === 15) && (await S.ls())['rufi:v1:page:aval-ico-valencia']?.revision === 15 && await S.mounted()); await S.close();

  t = '[1.1 · apagado con motor 1.0.0 (sobre engine 1.0.0)]'; reset({ ...base, 'v1/pages/aval-ico-valencia.json': { body: page(AVAL, 10, { engine: '1.0.0' }) } });
  S = await open(browser, { port }); ok(`${t} Rufi activo con el núcleo 1.0.0`, (await S.waitMount()) && S.core()[0] === '/rufi/v/1.0.0/rufi-core.js');
  store.set('v1/status.json', { body: status('killed', 16) }); await S.recheck();
  ok(`${t} el cargador lo retira igualmente`, await S.waitGone()); noErrors(t, S); await S.close();

  // 4 · caducidad
  t = '[1.1 · página caducada]'; reset({ ...base, 'v1/pages/aval-ico-valencia.json': { body: page(AVAL, 10, { issuedAt: iso(-8 * D), expiresAt: iso(-H) }) } });
  S = await open(browser, { port }); await settle(S);
  ok(`${t} Rufi NO se activa`, !(await S.mounted()) && !S.heavy()); await S.close();
  t = '[1.1 · estado caducado]'; reset({ ...base, 'v1/status.json': { body: status('active', 5, { issuedAt: iso(-8 * D), expiresAt: iso(-H) }) } });
  S = await open(browser, { port }); await settle(S);
  ok(`${t} Rufi NO se activa`, !(await S.mounted()) && !S.heavy()); await S.close();
  t = '[1.1 · Storage caído + copia caducada]'; reset({ 'v1/status.json': { cut: true }, 'v1/pages/aval-ico-valencia.json': { cut: true } });
  S = await open(browser, { port, local: { 'rufi:v1:status': status('active', 5), 'rufi:v1:page:aval-ico-valencia': page(AVAL, 10, { issuedAt: iso(-8 * D), expiresAt: iso(-H) }) } }); await settle(S);
  ok(`${t} Rufi NO se activa y borra la copia caducada`, !(await S.mounted()) && !(await S.ls())['rufi:v1:page:aval-ico-valencia']); await S.close();

  // 5 · JSON manipulado o no válido
  for (const [name, files] of [
    ['status.json no es JSON', { 'v1/status.json': { raw: '{"api":"rufi-crm/1",' } }],
    ['status.json con un campo de más', { 'v1/status.json': { body: { ...status('active', 5), nota: 'x' } } }],
    ['página con datos que no son del contrato', { 'v1/pages/aval-ico-valencia.json': { body: { ...page(AVAL, 10), contactos: [{ tel: '600000000' }] } } }],
    ['página con revisión en texto', { 'v1/pages/aval-ico-valencia.json': { body: { ...page(AVAL, 10), revision: '10' } } }],
    ['página con config manipulada (enlace javascript:)', { 'v1/pages/aval-ico-valencia.json': { body: page({ ...AVAL, panel: { ...AVAL.panel, options: [{ id: 'x', label: 'x', action: { type: 'link', href: 'javascript:alert(1)' } }] } }, 10) } }],
    ['página de otro slug', { 'v1/pages/aval-ico-valencia.json': { body: { ...page({ ...AVAL, page: 'otra' }, 10), slug: 'otra' } } }],
    ['página demasiado grande (> 64 KB)', { 'v1/pages/aval-ico-valencia.json': { raw: JSON.stringify(page(AVAL, 10)).replace('"revision"', `"x":"${'a'.repeat(70000)}","revision"`) } }],
    ['vista previa servida como página normal', { 'v1/pages/aval-ico-valencia.json': { body: { ...page(AVAL, 10), preview: true } } }],
  ]) {
    t = `[1.1 · ${name}]`; reset({ ...base, ...files });
    S = await open(browser, { port }); await settle(S);
    ok(`${t} Rufi NO se activa`, !(await S.mounted()) && !S.heavy()); noErrors(t, S); await S.close();
  }

  // 6 · fallos de red
  t = '[1.1 · Storage corta la conexión, visitante nuevo]'; reset({ 'v1/status.json': { cut: true }, 'v1/pages/aval-ico-valencia.json': { cut: true } });
  S = await open(browser, { port }); await settle(S);
  ok(`${t} Rufi NO se activa (la página sigue bien)`, !(await S.mounted()) && !S.heavy() && (await S.p.locator('#test').textContent()) === 'Página'); noErrors(t, S); await S.close();
  t = '[1.1 · Storage tarda más que timeoutMs]'; reset({ 'v1/status.json': { body: status('active', 5), delay: 4000 }, 'v1/pages/aval-ico-valencia.json': { body: page(AVAL, 10), delay: 4000 } });
  S = await open(browser, { port }); await settle(S, 3000);
  ok(`${t} Rufi NO se activa (espera máx. 1,5 s)`, !(await S.mounted()) && !S.heavy()); await S.close();
  t = '[1.1 · Storage caído, visitante que vuelve con copia válida]'; reset({ 'v1/status.json': { cut: true }, 'v1/pages/aval-ico-valencia.json': { cut: true } });
  S = await open(browser, { port, local: { 'rufi:v1:status': status('active', 5), 'rufi:v1:page:aval-ico-valencia': page(AVAL, 10) } });
  ok(`${t} Rufi se activa con su copia`, await S.waitMount()); await S.close();
  t = '[1.1 · Storage caído, vuelve con marca de apagado]'; reset({ 'v1/status.json': { cut: true }, 'v1/pages/aval-ico-valencia.json': { cut: true } });
  S = await open(browser, { port, local: { 'rufi:v1:status': status('killed', 6), 'rufi:v1:page:aval-ico-valencia': page(AVAL, 10) } }); await settle(S);
  ok(`${t} Rufi NO se activa`, !(await S.mounted())); await S.close();
  t = '[1.1 · CDN con estado viejo, el navegador ya vio el apagado]'; reset({ ...base, 'v1/status.json': { body: status('active', 5) } });
  S = await open(browser, { port, local: { 'rufi:v1:status': status('killed', 6) } }); await settle(S);
  ok(`${t} sigue apagado (gana la revisión más alta)`, !(await S.mounted())); await S.close();
  t = '[1.1 · Storage responde 503]'; reset({ 'v1/status.json': { status: 503, raw: '' }, 'v1/pages/aval-ico-valencia.json': { status: 503, raw: '' } });
  S = await open(browser, { port }); await settle(S);
  ok(`${t} Rufi NO se activa`, !(await S.mounted())); await S.close();

  // 7 · Joomla (ruta con hash) y configuración en la página
  t = '[1.1 · Joomla: v1/routes/<sha256>.json]'; reset({ ...base, [`v1/routes/${sha('/ICO/aval-ico-valencia.html')}.json`]: { body: { api: 'rufi-crm/1', slug: 'aval-ico-valencia', revision: 10, issuedAt: iso(-H), expiresAt: iso(7 * D) } } });
  S = await open(browser, { port, snippet: '<script src="/rufi/rufi.js" defer></script>' });
  ok(`${t} Rufi se activa`, await S.waitMount());
  ok(`${t} busca la ruta por su hash`, S.reqs.some((r) => r.endsWith(`/v1/routes/${sha('/ICO/aval-ico-valencia.html')}.json`))); await S.close();
  t = '[1.1 · Joomla: ruta desconocida]'; reset(base);
  S = await open(browser, { port, snippet: '<script src="/rufi/rufi.js" defer></script>', url: '/blog/otra' }); await settle(S);
  ok(`${t} Rufi NO se activa`, !(await S.mounted()) && !S.heavy()); await S.close();
  t = '[1.1 · configuración en la página + sitio apagado]'; reset({ ...base, 'v1/status.json': { body: status('killed', 6) } });
  S = await open(browser, { port, snippet: `<script>window.RufiConfig=${JSON.stringify({ ...AVAL, page: 'en-linea' })}</script><script src="/rufi/rufi.js" defer></script>` }); await settle(S);
  ok(`${t} Rufi NO se activa`, !(await S.mounted())); await S.close();
  t = '[1.1 · configuración en la página + sitio activo]'; reset(base);
  S = await open(browser, { port, snippet: `<script>window.RufiConfig=${JSON.stringify({ ...AVAL, page: 'en-linea' })}</script><script src="/rufi/rufi.js" defer></script>` });
  ok(`${t} Rufi se activa`, await S.waitMount()); await S.close();

  // 8 · idiomas
  for (const lang of ['es', 'en', 'fr', 'it', 'de']) {
    t = `[idioma ${lang} · <html lang="${lang}">]`;
    reset({ 'v1/status.json': { body: status('active', 5) }, 'v1/pages/demo-multi.json': { body: page(MULTI, 20) } });
    S = await open(browser, { port, lang, snippet: '<script src="/rufi/rufi.js" data-rufi-config="demo-multi" defer></script>' });
    await S.waitMount();
    await S.p.waitForFunction(() => window.__ev.some(([n, d]) => n === 'bubble' && d.id === 'bienvenida'), null, { timeout: 30000 }).catch(() => {});
    const tx = lang === 'es' ? { welcome: MULTI.welcome, panel: { title: MULTI.panel.title, options: Object.fromEntries(MULTI.panel.options.map((o) => [o.id, o])) } } : MULTI.i18n[lang];
    const R = S.p.locator('#rufi-root');
    ok(`${t} bienvenida`, (await R.locator('.bubble-t span').textContent().catch(() => '')) === tx.welcome.text);
    ok(`${t} evento ready con el idioma`, (await S.ev()).some(([n, d]) => n === 'ready' && d.lang === lang));
    ok(`${t} atributo lang del componente`, (await R.getAttribute('lang')) === lang);
    await R.locator('.hit').click(); await S.p.waitForTimeout(400);
    ok(`${t} título y opciones del panel`, (await R.locator('.title').textContent()) === tx.panel.title && JSON.stringify(await R.locator('.opt strong').allTextContents()) === JSON.stringify(MULTI.panel.options.map((o) => tx.panel.options[o.id].label)));
    const wa = await R.locator('.opt.wa').getAttribute('href');
    ok(`${t} mensaje de WhatsApp traducido`, wa && decodeURIComponent(wa).includes(lang === 'es' ? MULTI.whatsapp.message : MULTI.i18n[lang].whatsapp.message), wa);
    const closeLbl = { es: 'Cerrar opciones', en: 'Close options', fr: 'Fermer les options', it: 'Chiudi le opzioni', de: 'Optionen schließen' }[lang];
    ok(`${t} interfaz (cerrar) traducida`, (await R.locator('.close').getAttribute('aria-label')) === closeLbl);
    noErrors(t, S); await S.close();
  }
  t = '[idioma no disponible (pt) → navegador es-ES → base]'; reset({ 'v1/status.json': { body: status('active', 5) }, 'v1/pages/demo-multi.json': { body: page(MULTI, 20) } });
  S = await open(browser, { port, lang: 'pt-BR', snippet: '<script src="/rufi/rufi.js" data-rufi-config="demo-multi" defer></script>' }); await S.waitMount();
  ok(`${t} español`, (await S.ev()).some(([n, d]) => n === 'ready' && d.lang === 'es')); await S.close();

  // 9 · vista previa LOCAL (token en el ancla, API falsa)
  drafts.set('aval-ico-valencia:7', { ...AVAL, welcome: { text: 'BORRADOR: ¡Hola! Soy Rufi.' } });
  const claims = (o = {}) => ({ v: 1, slug: 'aval-ico-valencia', draft: 7, exp: Math.floor(Date.now() / 1000) + 600, nonce: 'abcdefghijklmnop1234', ...o });
  t = '[vista previa local · token válido]'; reset({ ...base, 'v1/status.json': { body: status('killed', 6) } }); storageLog.length = 0;
  S = await open(browser, { port, url: `/ICO/aval-ico-valencia.html#rufi-preview=${previewToken(claims())}` });
  ok(`${t} muestra el borrador`, await S.waitMount());
  await S.p.waitForFunction(() => window.__ev.some(([n, d]) => n === 'bubble' && d.id === 'bienvenida'), null, { timeout: 30000 }).catch(() => {});
  ok(`${t} texto del borrador y aviso «Vista previa»`, (await S.p.locator('#rufi-root').locator('.bubble-t span').textContent().catch(() => '')).startsWith('BORRADOR') && (await S.p.locator('#rufi-root').locator('.badge').textContent()) === 'Vista previa · borrador');
  ok(`${t} solo usa la API (ni Storage ni copias)`, !S.reqs.some((r) => r.includes('supabase')) && Object.keys(await S.ls()).length === 0);
  ok(`${t} quita el token de la barra de direcciones`, !(await S.p.evaluate(() => location.href)).includes('rufi-preview'));
  noErrors(t, S); await S.close();
  for (const [name, tok] of [['firma manipulada', previewToken(claims()).slice(0, -2) + 'AA'], ['caducado', previewToken(claims({ exp: Math.floor(Date.now() / 1000) - 5 }))], ['de otra página', previewToken(claims({ slug: 'otra' }))], ['firmado con otro secreto', previewToken(claims(), 'otro')], ['con forma no válida', 'v1.x.y']]) {
    t = `[vista previa local · ${name}]`; reset(base);
    S = await open(browser, { port, url: `/ICO/aval-ico-valencia.html#rufi-preview=${tok}`, local: { 'rufi:v1:status': status('active', 5), 'rufi:v1:page:aval-ico-valencia': page(AVAL, 10) } }); await settle(S);
    ok(`${t} no se muestra nada (tampoco la copia)`, !(await S.mounted())); await S.close();
  }

  await browser.close(); srv.close();
  console.log(results.join('\n'));
  console.log(`\n${results.length - failures}/${results.length} comprobaciones superadas`);
  process.exitCode = failures ? 1 : 0;
})();
