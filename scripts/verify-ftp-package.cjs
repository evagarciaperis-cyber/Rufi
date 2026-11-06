/**
 * Verifica el paquete FTP (instalación centralizada) como si ya estuviera subido a referencehome.es.
 *
 * El navegador abre https://referencehome.es/ICO/aval-ico-valencia-rufi-test.html. Las peticiones
 * a esa página y a /rufi/ se sirven desde ORIGEN (un Apache local con el ZIP descomprimido, con
 * sus cabeceras reales); el resto de referencehome.es sale a la red real.
 *
 * Uso: node scripts/verify-ftp-package.cjs http://localhost:8088 [--shots carpeta]
 */
const { chromium, devices } = require('playwright');
const path = require('path'); const fs = require('fs');
const ORIGIN = process.argv[2] || 'http://localhost:8088';
const shots = process.argv.includes('--shots') ? path.resolve(process.argv[process.argv.indexOf('--shots') + 1]) : null;
if (shots) fs.mkdirSync(shots, { recursive: true });
const PAGE = 'https://referencehome.es/ICO/aval-ico-valencia-rufi-test.html';
const results = []; let failures = 0;
const ok = (n, c, x = '') => { results.push(`${c ? '✓' : '✗'} ${n}${x ? ` — ${x}` : ''}`); if (!c) failures++; };

async function run(browser, name, ctxOpts) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const requests = [], errors = [], consoleTest = [];
  page.on('request', (r) => requests.push(r.url()));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); if (m.text().startsWith('[Rufi PRUEBA]')) consoleTest.push(m.text()); });
  const served = {};
  await page.route('https://referencehome.es/**', async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith('/rufi/') || u.pathname === '/ICO/aval-ico-valencia-rufi-test.html') {
      const resp = await route.fetch({ url: ORIGIN + u.pathname + u.search });
      served[u.pathname] = [resp.status(), resp.headers()['content-type'], resp.headers()['cache-control'] || '(sin cabecera)'];
      return route.fulfill({ response: resp });
    }
    return route.continue();
  });
  await page.addInitScript(() => { window.__ev = []; for (const n of ['ready', 'engine', 'state', 'bubble', 'open', 'action']) document.addEventListener(`rufi:${n}`, (e) => window.__ev.push([n, e.detail])); });
  const tag = `[${name}]`;
  await page.goto(PAGE, { waitUntil: 'load' });
  ok(`${tag} meta robots noindex`, await page.evaluate(() => document.querySelector('meta[name=robots]')?.content) === 'noindex, nofollow, noarchive');
  ok(`${tag} canonical sigue apuntando a la página original`, await page.evaluate(() => document.querySelector('link[rel=canonical]')?.href) === 'https://referencehome.es/ICO/aval-ico-valencia.html');
  await page.waitForFunction(() => window.__ev.some(([n]) => n === 'engine'), null, { timeout: 60000 }).catch(() => {});
  await page.waitForFunction(() => window.__ev.some(([n, d]) => n === 'bubble' && d.id === 'bienvenida'), null, { timeout: 20000 }).catch(() => {});
  const ev = await page.evaluate(() => window.__ev);
  ok(`${tag} Rufi se monta (Shadow DOM)`, await page.evaluate(() => !!document.getElementById('rufi-root')?.shadowRoot));
  ok(`${tag} motor 3D cargado desde /rufi/`, ev.some(([n]) => n === 'engine'));
  ok(`${tag} asoma, saluda y da la bienvenida`, ['peek', 'greet'].every((s) => ev.some(([n, d]) => n === 'state' && d.state === s)) && ev.some(([n, d]) => n === 'bubble' && d.id === 'bienvenida'));
  ok(`${tag} mascota anterior oculta en la copia`, await page.evaluate(() => getComputedStyle(document.getElementById('masc')).display === 'none'));
  ok(`${tag} eventos marcados como prueba (test: true, page aval-ico-valencia-test)`, ev.length > 0 && ev.every(([, d]) => d.test === true && d.page === 'aval-ico-valencia-test'));
  ok(`${tag} registro en consola «[Rufi PRUEBA]»`, consoleTest.length > 0, `${consoleTest.length} mensajes`);
  if (shots) await page.screenshot({ path: path.join(shots, `${name}-saludo.png`) });
  await page.locator('#rufi-root').locator('.hit').click(); await page.waitForTimeout(400);
  const wa = await page.locator('#rufi-root').locator('a.opt.wa').getAttribute('href');
  ok(`${tag} WhatsApp de Rufi con «[PRUEBA RUFI]» al +34 674 61 22 72`, wa.startsWith('https://wa.me/34674612272?text=') && decodeURIComponent(wa).includes('[PRUEBA RUFI]'));
  ok(`${tag} pie del panel indica «Página de pruebas»`, (await page.locator('#rufi-root').locator('.foot').textContent()).includes('Página de pruebas'));
  if (shots) await page.screenshot({ path: path.join(shots, `${name}-panel.png`) });
  await page.locator('#rufi-root').locator('.opt').first().click(); await page.waitForTimeout(2800);
  ok(`${tag} «Comprobar requisitos» lleva al test real`, Math.abs(await page.evaluate(() => document.getElementById('test').getBoundingClientRect().top)) < 80);
  await page.waitForFunction(() => window.__ev.some(([n, d]) => n === 'bubble' && d.id === 'llega-test'), null, { timeout: 30000 }).then(() => ok(`${tag} reacciona al test real`, true)).catch(() => ok(`${tag} reacciona al test real`, false));
  // Rutas servidas desde el paquete
  const V = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).rufiVersion;
  for (const p of ['/ICO/aval-ico-valencia-rufi-test.html', '/rufi/rufi.js', '/rufi/configs/_global.json', '/rufi/configs/aval-ico-valencia-test.json', `/rufi/v/${V}/rufi-core.js`, `/rufi/v/${V}/rufi-3d.js`, `/rufi/v/${V}/rufi-expresivo.web.glb`, `/rufi/v/${V}/rufi-poster.webp`]) {
    ok(`${tag} ${p} servido por el paquete`, served[p] && served[p][0] === 200, served[p] ? served[p].join(' · ') : 'no pedido');
  }
  ok(`${tag} no consulta _routes.json (la página usa data-rufi-config)`, !served['/rufi/configs/_routes.json']);
  ok(`${tag} no pide la configuración de producción`, !served['/rufi/configs/aval-ico-valencia.json']);
  const external = [...new Set(requests.map((u) => new URL(u)).filter((u) => !['data:', 'blob:'].includes(u.protocol) && u.hostname !== 'referencehome.es').map((u) => u.hostname))];
  ok(`${tag} sin peticiones a otros dominios (analítica, CDNs…)`, external.length === 0, external.join(', ') || `${requests.length} peticiones, todas a referencehome.es`);
  ok(`${tag} sin errores en consola`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  await run(browser, 'escritorio', { viewport: { width: 1280, height: 800 } });
  await run(browser, 'iphone13', { ...devices['iPhone 13'] });
  await browser.close();
  console.log(results.join('\n'));
  console.log(`\n${results.length - failures}/${results.length} comprobaciones superadas`);
  process.exitCode = failures ? 1 : 0;
})();
