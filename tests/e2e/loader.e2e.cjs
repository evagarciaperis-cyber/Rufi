/**
 * Pruebas del cargador central (dist/rufi.js) en Chromium: decide bien cuándo NO cargar Rufi.
 * Sirve dist/ como si fuera https://referencehome.es/rufi/ (sin red: todo con page.route).
 * Uso: npm run build && node tests/e2e/loader.e2e.cjs
 * Fase D: el cargador es el 1.1, pero con este _global.json (sin source) debe comportarse como el 1.0.0.
 */
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const DIST = path.join(__dirname, '..', '..', 'dist');
const V = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')).rufiVersion;
const ORIGIN = 'https://referencehome.es';
const TYPES = { '.js': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary', '.webp': 'image/webp' };
const results = []; let failures = 0;
const ok = (n, c, x = '') => { results.push(`${c ? '✓' : '✗'} ${n}${x ? ` — ${x}` : ''}`); if (!c) failures++; };
const html = (snippet) => `<!doctype html><html><head><meta charset="utf-8"><title>p</title></head><body><h1 id="test">Página</h1><div id="simulador"></div>${snippet}</body></html>`;

async function scenario(browser, name, { url = '/ICO/aval-ico-valencia.html', snippet = `<script src="/rufi/rufi.js" data-rufi-config="aval-ico-valencia" defer></script>`, override = {} }, expect) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const reqs = []; const errors = [];
  page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => m.type() === 'error' && !/404/.test(m.text()) && errors.push(m.text()));
  await ctx.route(`${ORIGIN}/**`, async (route) => {
    const u = new URL(route.request().url()); reqs.push(u.pathname + u.search);
    if (!u.pathname.startsWith('/rufi/')) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html(snippet) });
    const rel = u.pathname.slice('/rufi/'.length);
    if (rel in override) return override[rel] === null ? route.fulfill({ status: 404, body: '' }) : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(override[rel]) });
    const f = path.join(DIST, rel);
    if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: 200, contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
  await page.goto(ORIGIN + url, { waitUntil: 'load' });
  await page.waitForTimeout(expect.mounts ? 0 : 1500);
  if (expect.mounts) await page.waitForFunction(() => !!document.getElementById('rufi-root'), null, { timeout: 15000 }).catch(() => {});
  const mounted = await page.evaluate(() => !!document.getElementById('rufi-root'));
  const cfg = await page.evaluate(() => window.Rufi && window.Rufi.instance ? { page: window.Rufi.instance.cfg.page, assetsBase: window.Rufi.instance.cfg.assetsBase, debug: !!window.Rufi.instance.cfg.debug, position: window.Rufi.instance.cfg.position } : null);
  const core = reqs.filter((r) => r.includes('rufi-core.js'));
  ok(`[${name}] ${expect.mounts ? 'Rufi se activa' : 'Rufi NO se activa'}`, mounted === !!expect.mounts);
  if (!expect.mounts && !expect.allowCore) ok(`[${name}] no descarga núcleo, 3D ni modelo`, !reqs.some((r) => /rufi-core|rufi-3d|\.glb|\.webp/.test(r)), reqs.filter((r) => r.startsWith('/rufi/')).join(' '));
  if (expect.check) for (const [label, fn] of expect.check) ok(`[${name}] ${label}`, fn({ reqs, cfg, core }), '');
  ok(`[${name}] sin errores en consola`, errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const G = JSON.parse(fs.readFileSync(path.join(DIST, 'configs/_global.json'), 'utf8'));
  const CFG = JSON.parse(fs.readFileSync(path.join(DIST, 'configs/aval-ico-valencia.json'), 'utf8'));
  await scenario(browser, 'landing con data-rufi-config', {}, { mounts: true, check: [
    [`núcleo desde /rufi/v/${G.version}/ (versión de _global.json)`, ({ core }) => core.length === 1 && core[0] === `/rufi/v/${G.version}/rufi-core.js`],
    ['configuración con ?v=configVersion', ({ reqs }) => reqs.includes(`/rufi/configs/aval-ico-valencia.json?v=${G.configVersion}`)],
    ['no consulta _routes.json', ({ reqs }) => !reqs.some((r) => r.includes('_routes'))],
    ['página y assetsBase correctos', ({ cfg }) => cfg && cfg.page === 'aval-ico-valencia' && cfg.assetsBase.endsWith(`/rufi/v/${G.version}/`)],
  ] });
  await scenario(browser, '?rufi=off', { url: '/ICO/aval-ico-valencia.html?rufi=off' }, { mounts: false, check: [['no pide nada a /rufi/ salvo el cargador', ({ reqs }) => reqs.filter((r) => r.startsWith('/rufi/')).join() === '/rufi/rufi.js']] });
  await scenario(browser, '_global.json enabled:false', { override: { 'configs/_global.json': { ...G, enabled: false } } }, { mounts: false, check: [['no pide la configuración', ({ reqs }) => !reqs.some((r) => r.includes('aval-ico-valencia.json'))]] });
  await scenario(browser, '_global.json enabled:false + ?rufi=on', { url: '/ICO/aval-ico-valencia.html?rufi=on', override: { 'configs/_global.json': { ...G, enabled: false } } }, { mounts: true });
  await scenario(browser, 'página en disabledPages', { override: { 'configs/_global.json': { ...G, disabledPages: ['aval-ico-valencia'] } } }, { mounts: false });
  await scenario(browser, 'configuración con enabled:false', { override: { 'configs/aval-ico-valencia.json': { ...CFG, enabled: false } } }, { mounts: false });
  await scenario(browser, 'configuración inexistente', { snippet: `<script src="/rufi/rufi.js" data-rufi-config="no-existe" defer></script>` }, { mounts: false });
  await scenario(browser, 'sin _global.json (fallo de red)', { override: { 'configs/_global.json': null } }, { mounts: true, check: [[`usa la versión del cargador (${V})`, ({ core }) => core[0] === `/rufi/v/${V}/rufi-core.js`]] });
  await scenario(browser, 'versión fijada en la configuración', { override: { 'configs/aval-ico-valencia.json': { ...CFG, version: '0.9.0' } } }, { mounts: false, allowCore: true, check: [['pide /rufi/v/0.9.0/rufi-core.js (vuelta atrás por página)', ({ reqs }) => reqs.includes('/rufi/v/0.9.0/rufi-core.js')]] });
  await scenario(browser, 'Joomla: fragmento global, página en _routes.json', { snippet: `<script src="/rufi/rufi.js" defer></script>`, url: '/ICO/aval-ico-valencia.html' }, { mounts: true, check: [['consulta _routes.json', ({ reqs }) => reqs.some((r) => r.startsWith('/rufi/configs/_routes.json'))]] });
  await scenario(browser, 'Joomla: fragmento global, página no listada', { snippet: `<script src="/rufi/rufi.js" defer></script>`, url: '/blog/otra-pagina' }, { mounts: false, check: [['solo pide _global.json y _routes.json', ({ reqs }) => reqs.filter((r) => r.startsWith('/rufi/configs/')).every((r) => /_global|_routes/.test(r))]] });
  await scenario(browser, 'Joomla: prefijo en _routes.json', { snippet: `<script src="/rufi/rufi.js" defer></script>`, url: '/hipotecas/simulador', override: { 'configs/_routes.json': { routes: [{ prefix: '/hipotecas/', config: 'aval-ico-valencia' }] } } }, { mounts: true });
  await scenario(browser, 'configuración en la propia página', { snippet: `<script>window.RufiConfig=${JSON.stringify({ ...CFG, page: 'en-linea' })}</script><script src="/rufi/rufi.js" defer></script>` }, { mounts: true, check: [['no pide archivo de configuración', ({ reqs }) => !reqs.some((r) => r.includes('aval-ico-valencia.json') || r.includes('_routes'))], ['usa la configuración de la página', ({ cfg }) => cfg && cfg.page === 'en-linea']] });
  await scenario(browser, 'ajuste en la página sobre el archivo', { snippet: `<script>window.RufiConfig={ position: 'left' }</script><script src="/rufi/rufi.js" data-rufi-config="aval-ico-valencia" defer></script>` }, { mounts: true, check: [['mezcla archivo + ajuste', ({ cfg }) => cfg && cfg.page === 'aval-ico-valencia' && cfg.position === 'left']] });
  await scenario(browser, '?rufi=debug', { url: '/ICO/aval-ico-valencia.html?rufi=debug' }, { mounts: true, check: [['activa debug', ({ cfg }) => cfg && cfg.debug]] });
  await scenario(browser, 'cargador incluido dos veces', { snippet: `<script src="/rufi/rufi.js" data-rufi-config="aval-ico-valencia" defer></script><script src="/rufi/rufi.js" data-rufi-config="aval-ico-valencia" defer></script>` }, { mounts: true, check: [['un solo núcleo', ({ core }) => core.length === 1]] });
  await browser.close();
  console.log(results.join('\n'));
  console.log(`\n${results.length - failures}/${results.length} comprobaciones superadas`);
  process.exitCode = failures ? 1 : 0;
})();
