/**
 * Compatibilidad hacia atrás del contrato 1.1: el motor PUBLICADO (dist/v/1.0.0, sin cambios)
 * recibe configuraciones 1.1 (cinco idiomas, IA) y debe funcionar igual que con una 1.0:
 * se monta, muestra los textos base en español, ignora i18n/ai y no da errores.
 * Uso: npm run build && node tests/e2e/compat-1.1.e2e.cjs
 */
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const DIST = path.join(ROOT, 'dist');
const ORIGIN = 'https://referencehome.es';
const TYPES = { '.js': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary', '.webp': 'image/webp' };
const results = []; let failures = 0;
const ok = (n, c, x = '') => { results.push(`${c ? '✓' : '✗'} ${n}${x ? ` — ${x}` : ''}`); if (!c) failures++; };
const J = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

async function run(browser, name, cfgFile, htmlLang) {
  const cfg = J(cfgFile); delete cfg.version; // sin versión propia → la global de _global.json (1.0.0)
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = []; const reqs = [];
  page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.addInitScript(() => { window.__ev = []; for (const n of ['ready', 'bubble', 'engine']) document.addEventListener(`rufi:${n}`, (e) => window.__ev.push([n, e.detail])); });
  await ctx.route(`${ORIGIN}/**`, async (route) => {
    const u = new URL(route.request().url()); reqs.push(u.pathname);
    if (!u.pathname.startsWith('/rufi/')) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: `<!doctype html><html lang="${htmlLang}"><head><meta charset="utf-8"><title>p</title></head><body><h1 id="info">Info</h1><div style="height:2000px"></div><script src="/rufi/rufi.js" data-rufi-config="${cfg.page}" defer></script></body></html>` });
    const rel = u.pathname.slice(6);
    if (rel === `configs/${cfg.page}.json`) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cfg) });
    const f = path.join(DIST, rel);
    if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: 200, contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
  await page.goto(`${ORIGIN}/prueba.html`);
  await page.waitForFunction(() => window.__ev.some(([n, d]) => n === 'bubble' && d.id === 'bienvenida'), null, { timeout: 30000 }).catch(() => {});
  const t = `[${name}]`;
  ok(`${t} motor publicado 1.0.0`, reqs.includes('/rufi/v/1.0.0/rufi-core.js') && !reqs.some((r) => r.includes('/v/1.1.0/')));
  ok(`${t} se monta`, await page.evaluate(() => !!document.getElementById('rufi-root')?.shadowRoot));
  const welcome = await page.locator('#rufi-root').locator('.bubble-t span').textContent().catch(() => '');
  ok(`${t} bienvenida con el texto base (español)`, welcome === cfg.welcome.text, welcome);
  await page.locator('#rufi-root').locator('.hit').click(); await page.waitForTimeout(400);
  const labels = await page.locator('#rufi-root').locator('.opt strong').allTextContents();
  ok(`${t} botones con los textos base`, JSON.stringify(labels) === JSON.stringify(cfg.panel.options.map((o) => o.label)), labels.join(' · '));
  const shadowText = await page.locator('#rufi-root').evaluate((el) => el.shadowRoot.textContent);
  ok(`${t} no muestra textos de i18n ni el chat de IA`, !Object.values(cfg.i18n || {}).some((tx) => tx.welcome && shadowText.includes(tx.welcome.text)) && !(cfg.ai && shadowText.includes(cfg.ai.notice)));
  ok(`${t} sin errores en consola`, errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  await run(browser, '1.1 cinco idiomas, página es', 'spec/vectors/config/valid/v11-cinco-idiomas.json', 'es');
  await run(browser, '1.1 cinco idiomas, página en', 'spec/vectors/config/valid/v11-cinco-idiomas.json', 'en');
  await run(browser, '1.1 con IA activada', 'spec/vectors/config/valid/v11-ia-activada.json', 'fr');
  await run(browser, '1.1 enlaces seguros', 'spec/vectors/config/valid/v11-enlaces-seguros.json', 'es');
  await browser.close();
  console.log(results.join('\n'));
  console.log(`\n${results.length - failures}/${results.length} comprobaciones superadas`);
  process.exitCode = failures ? 1 : 0;
})();
