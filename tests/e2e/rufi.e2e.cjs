/**
 * Pruebas de extremo a extremo del componente (Playwright + Chromium).
 * Escritorio (1280×800) y móvil emulado (iPhone 13, Pixel 7: tamaño, DPR, táctil).
 * Uso: npm run build && node tests/e2e/rufi.e2e.cjs [--landing ruta/aval-ico-valencia.html] [--shots carpeta]
 *
 * Para no esperar 20 s entre burbujas, la prueba sirve la configuración real con minGap = 2,5 s
 * y sleepAfter = 6 s; el resto de la configuración es la de dist/configs/aval-ico-valencia.json,
 * cargada por el cargador central (dist/rufi.js → dist/v/<versión>/rufi-core.js).
 */
const { chromium, devices } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const args = process.argv.slice(2);
const landing = args.includes('--landing') ? path.resolve(args[args.indexOf('--landing') + 1]) : null;
const shots = args.includes('--shots') ? path.resolve(args[args.indexOf('--shots') + 1]) : null;
if (shots) fs.mkdirSync(shots, { recursive: true });
const TYPES = { '.json': 'application/json', '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.html': 'text/html; charset=utf-8', '.webp': 'image/webp', '.css': 'text/css' };

const results = []; let failures = 0;
const ok = (name, cond, extra = '') => { results.push(`${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`); if (!cond) failures++; };

function serve() {
  return new Promise((res) => {
    const srv = http.createServer((q, r) => {
      let p = decodeURIComponent(q.url.split('?')[0]);
      if (p === '/landing-real/') return fs.readFile(landing, 'utf8', (e, html) => {
        // Copia local de la landing real + las dos líneas de instalación (solo en la prueba)
        const inject = '<script src="/dist/rufi.js" data-rufi-config="aval-ico-valencia" defer></script>\n</body>';
        r.writeHead(200, { 'content-type': TYPES['.html'] }); r.end(html.replace(/<\/body>/i, inject));
      });
      if (p.endsWith('/')) p += 'index.html';
      const f = path.join(ROOT, p);
      fs.readFile(f, (e, b) => {
        if (e) { r.writeHead(404); return r.end(); }
        if (p === '/dist/configs/aval-ico-valencia.json') { const c = JSON.parse(b); c.bubbles = { minGap: 2500, autoHide: 9000, maxPerPage: 6, typingPause: 2000 }; c.sleepAfter = 6000; b = Buffer.from(JSON.stringify(c)); }
        r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); r.end(b);
      });
    }).listen(0, () => res(srv));
  });
}

async function withRufi(page, url) {
  await page.addInitScript(() => {
    window.__rufiLog = []; window.__cls = 0;
    for (const n of ['ready', 'state', 'bubble', 'engine', 'open', 'close', 'action', 'bubble-dismiss']) document.addEventListener(`rufi:${n}`, (e) => window.__rufiLog.push([n, e.detail, performance.now()]));
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.goto(url);
}
const log = (page) => page.evaluate(() => window.__rufiLog);
const shadow = (page, sel) => page.locator('#rufi-root').locator(sel);
const waitLog = (page, name, pred = () => true, timeout = 30000) => page.waitForFunction(([n, p]) => window.__rufiLog.some(([k, d]) => k === n && new Function('d', `return ${p}`)(d)), [name, pred.toString().replace(/^\(?d?\)?\s*=>\s*/, '')], { timeout })
  .catch(async (e) => { console.log(`  · esperando ${name} ${pred}:`, JSON.stringify((await log(page)).map(([k, d]) => [k, d.state || d.id || ''])).slice(0, 600)); throw e; });

async function scenario(browser, base, name, ctxOpts, opts = {}) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); if (process.env.RUFI_E2E_DEBUG && m.text().startsWith('setState')) console.log('  ·', m.text()); });
  const url = base + (opts.path || '/examples/demo-aval-ico/');
  const t0 = Date.now();
  await withRufi(page, url);
  const tag = `[${name}]`;

  // Aislamiento: estilos de la página antes de que Rufi monte
  const before = await page.evaluate(() => { const b = getComputedStyle(document.body); const h = document.querySelector('h1, h2'); return [b.fontFamily, b.color, b.backgroundColor, h ? getComputedStyle(h).fontSize : '']; });
  await waitLog(page, 'ready');
  ok(`${tag} el componente se monta en Shadow DOM`, await page.evaluate(() => !!document.getElementById('rufi-root')?.shadowRoot));
  ok(`${tag} la mascota anterior #masc queda oculta`, await page.evaluate(() => { const m = document.getElementById('masc'); return !m || getComputedStyle(m).display === 'none'; }));

  if (opts.reduced) {
    await page.waitForTimeout(2600);
    const l = await log(page);
    ok(`${tag} movimiento reducido: no carga el 3D`, !l.some(([k]) => k === 'engine'));
    ok(`${tag} movimiento reducido: póster visible`, await shadow(page, '.poster.on').count() === 1);
    ok(`${tag} movimiento reducido: bienvenida mostrada`, l.some(([k, d]) => k === 'bubble' && d.id === 'bienvenida'));
    await shadow(page, '.hit').click();
    ok(`${tag} movimiento reducido: el panel funciona`, await shadow(page, '.panel').isVisible());
    if (shots) await page.screenshot({ path: path.join(shots, `${name}-panel.png`) });
    ok(`${tag} sin errores en consola`, errors.length === 0, errors.join(' | '));
    await ctx.close(); return;
  }

  await waitLog(page, 'engine', undefined, 60000);
  const tEngine = Date.now() - t0;
  ok(`${tag} motor 3D cargado con las animaciones reales`, (await log(page)).some(([k, d]) => k === 'engine' && ['idle', 'wave', 'curious', 'blink', 'smile'].every((c) => d.clips.includes(c))), `${tEngine} ms`);
  await waitLog(page, 'state', (d) => d.state === 'peek', 15000);
  if (shots) { await page.waitForTimeout(700); await page.screenshot({ path: path.join(shots, `${name}-1-asoma.png`) }); }
  await waitLog(page, 'state', (d) => d.state === 'greet', 15000);
  await waitLog(page, 'bubble', (d) => d.id === 'bienvenida', 5000);
  if (shots) { await page.waitForTimeout(1100); await page.screenshot({ path: path.join(shots, `${name}-2-saluda.png`) }); }
  await waitLog(page, 'state', (d) => d.state === 'idle', 15000);
  const seq = (await log(page)).filter(([k]) => k === 'state').map(([, d]) => d.state);
  ok(`${tag} secuencia de entrada hidden→peek→enter→greet→idle`, ['peek', 'enter', 'greet', 'idle'].every((s, i) => seq.indexOf(s) >= 0 && (i === 0 || seq.indexOf(s) > seq.indexOf(['peek', 'enter', 'greet', 'idle'][i - 1]))), seq.join('→'));
  ok(`${tag} bienvenida con el texto configurado`, (await shadow(page, '.bubble-t span').textContent()).includes('Soy Rufi'));

  // Aislamiento: la página no cambia
  const after = await page.evaluate(() => { const b = getComputedStyle(document.body); const h = document.querySelector('h1, h2'); return [b.fontFamily, b.color, b.backgroundColor, h ? getComputedStyle(h).fontSize : '']; });
  ok(`${tag} estilos de la página intactos`, JSON.stringify(before) === JSON.stringify(after));
  ok(`${tag} sin desplazamiento horizontal`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  // Posición: esquina inferior derecha, dentro de la pantalla, sin tapar el botón de WhatsApp
  const box = await page.locator('#rufi-root').boundingBox(); const vp = page.viewportSize();
  ok(`${tag} Rufi en la esquina inferior derecha`, box.x + box.width <= vp.width + 1 && box.y + box.height >= vp.height - 24 && box.x > vp.width / 2, `${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}×${Math.round(box.height)}`);
  const wa = await page.locator('#wa-dock .btn').boundingBox();
  if (wa) ok(`${tag} no tapa el botón de WhatsApp de la página`, wa.x + wa.width <= box.x + box.width * 0.2 || wa.y + wa.height <= box.y + box.height * 0.15, `wa ${Math.round(wa.x)}–${Math.round(wa.x + wa.width)}, rufi ${Math.round(box.x)}`);

  // Rendimiento aproximado (emulación por software, no es un móvil real)
  const fps = await page.evaluate(() => new Promise((res) => { let n = 0; const t = performance.now(); const f = () => { n++; if (performance.now() - t < 2000) requestAnimationFrame(f); else res(n / 2); }; requestAnimationFrame(f); }));
  const mobileCtx = !!ctxOpts.isMobile;
  ok(`${tag} fotogramas por segundo con Rufi animado (render por software SwiftShader${mobileCtx ? ', informativo: no es un móvil real' : ''})`, mobileCtx ? fps > 0 : fps > 20, `${fps.toFixed(0)} fps`);

  // Panel
  await page.waitForTimeout(400);
  await shadow(page, '.hit').click();
  await page.waitForTimeout(350);
  ok(`${tag} el panel se abre al pulsar a Rufi`, await shadow(page, '.panel').isVisible() && (await shadow(page, '.hit').getAttribute('aria-expanded')) === 'true');
  ok(`${tag} tres acciones en el panel`, (await shadow(page, '.opt').count()) === 3);
  const href = await shadow(page, 'a.opt.wa').getAttribute('href');
  ok(`${tag} WhatsApp al +34 674 61 22 72`, href.startsWith('https://wa.me/34674612272?text=') && (await shadow(page, 'a.opt.wa').getAttribute('target')) === '_blank', href.slice(0, 48) + '…');
  ok(`${tag} el foco pasa a la primera opción`, await page.evaluate(() => document.getElementById('rufi-root').shadowRoot.activeElement?.classList.contains('opt')));
  if (shots) await page.screenshot({ path: path.join(shots, `${name}-3-panel.png`) });
  await page.keyboard.press('Escape'); await page.waitForTimeout(350);
  ok(`${tag} Esc cierra el panel y el foco vuelve a Rufi`, !(await shadow(page, '.panel').isVisible()) && await page.evaluate(() => document.getElementById('rufi-root').shadowRoot.activeElement?.classList.contains('hit')));

  // Acción "Comprobar requisitos": lleva al test
  await shadow(page, '.hit').click(); await page.waitForTimeout(300);
  await shadow(page, '.opt').first().click();
  await page.waitForTimeout(2600);
  const testTop = await page.evaluate(() => document.getElementById('test').getBoundingClientRect().top);
  ok(`${tag} «Comprobar requisitos» lleva al test`, Math.abs(testTop) < 80, `top ${Math.round(testTop)} px`);

  // Contexto: llegada al test (curioso + burbuja)
  await waitLog(page, 'bubble', (d) => d.id === 'llega-test', 12000).then(() => ok(`${tag} reacciona al llegar al test`, true)).catch(() => ok(`${tag} reacciona al llegar al test`, false));
  ok(`${tag} estado curioso al llegar al test`, (await log(page)).some(([k, d]) => k === 'state' && d.state === 'curious'));
  if (shots) await page.screenshot({ path: path.join(shots, `${name}-4-test.png`) });

  // Fin del test (demo: botón «Sí»; real: el test completo)
  if (!opts.path) {
    await page.click('#q-yes');
    await waitLog(page, 'bubble', (d) => d.id === 'fin-test', 12000).then(() => ok(`${tag} reacciona al terminar el test`, true)).catch(() => ok(`${tag} reacciona al terminar el test`, false));
    ok(`${tag} se alegra (happy → smile)`, (await log(page)).some(([k, d]) => k === 'state' && d.state === 'happy'));
  }

  // Simulador: llega, escribe (espera a la pausa) y resultado
  await page.evaluate(() => document.getElementById('simulador').scrollIntoView({ block: 'start' }));
  await waitLog(page, 'bubble', (d) => d.id === 'llega-simulador', 15000).then(() => ok(`${tag} reacciona al llegar al simulador`, true)).catch(() => ok(`${tag} reacciona al llegar al simulador`, false));
  await page.waitForTimeout(2700);
  const tType = await page.evaluate(() => performance.now());
  await page.fill('#precio', '');
  await page.type('#precio', '200000', { delay: 120 });
  const tTyped = await page.evaluate(() => performance.now());
  await waitLog(page, 'bubble', (d) => d.id === 'resultado-simulador', 20000).then(() => ok(`${tag} reacciona al resultado del simulador`, true)).catch(() => ok(`${tag} reacciona al resultado del simulador`, false));
  const tBubble = (await log(page)).find(([k, d]) => k === 'bubble' && d.id === 'resultado-simulador');
  ok(`${tag} no interrumpe mientras se escribe (espera ≥ 2 s tras la última tecla)`, tBubble && tBubble[2] - tTyped >= 1900, tBubble ? `${Math.round(tBubble[2] - tTyped)} ms tras la última tecla` : 'sin burbuja');
  if (shots) await page.screenshot({ path: path.join(shots, `${name}-5-simulador.png`) });

  // Cerrar burbuja → silencio el resto de la sesión
  await shadow(page, '.bubble .x').click(); await page.waitForTimeout(400);
  const nBefore = (await log(page)).filter(([k]) => k === 'bubble').length;
  await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(1500);
  await page.evaluate(() => document.getElementById('test').scrollIntoView()); await page.waitForTimeout(3500);
  ok(`${tag} tras cerrar una burbuja no vuelve a hablar por iniciativa propia`, (await log(page)).filter(([k]) => k === 'bubble').length === nBefore);

  // Reposo: se duerme sin actividad (6 s en la prueba) y despierta
  const nLog = (await log(page)).length;
  await page.waitForTimeout(8500);
  ok(`${tag} se duerme tras un rato sin actividad`, (await log(page)).slice(nLog).some(([k, d]) => k === 'state' && d.state === 'sleep'));
  if (process.env.RUFI_E2E_DEBUG) await page.evaluate(() => { const w = window.Rufi.instance; const o = w.setState.bind(w); w.setState = (n) => { console.log('setState', n, 'desde', w.state, new Error().stack.split('\n').slice(2, 5).join(' | ')); o(n); }; });
  await page.mouse.move(10, 10);
  await page.waitForTimeout(500);
  if (process.env.RUFI_E2E_DEBUG) console.log('  · log final:', JSON.stringify((await log(page)).slice(-10).map(([k, d, t]) => [k, d.state || d.id || '', Math.round(t)])));
  const lastStates = (await log(page)).filter(([k]) => k === 'state').slice(-3).map(([, d]) => d.state);
  ok(`${tag} despierta con la actividad`, lastStates[lastStates.length - 1] === 'idle', lastStates.join('→'));

  // Bienvenida una sola vez por sesión
  await page.reload(); await waitLog(page, 'engine', undefined, 60000); await page.waitForTimeout(4500);
  const l2 = await log(page);
  ok(`${tag} la bienvenida no se repite en la misma sesión`, !l2.some(([k, d]) => k === 'bubble' && d.id === 'bienvenida') && !l2.some(([k, d]) => k === 'state' && d.state === 'greet'));
  ok(`${tag} CLS = 0`, (await page.evaluate(() => window.__cls)) < 0.001, String(await page.evaluate(() => window.__cls)));
  ok(`${tag} sin errores en consola`, errors.length === 0, errors.join(' | '));
  await ctx.close();
}

(async () => {
  const srv = await serve(); const base = `http://localhost:${srv.address().port}`;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const only = process.env.RUFI_E2E_ONLY;
  const want = (n) => !only || n === only;
  if (want('escritorio')) await scenario(browser, base, 'escritorio', { viewport: { width: 1280, height: 800 } });
  if (want('iphone13')) await scenario(browser, base, 'iphone13', { ...devices['iPhone 13'] });
  if (want('pixel7')) await scenario(browser, base, 'pixel7', { ...devices['Pixel 7'] });
  if (want('movimiento-reducido')) await scenario(browser, base, 'movimiento-reducido', { viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' }, { reduced: true });
  if (landing) {
    await scenario(browser, base, 'landing-real-escritorio', { viewport: { width: 1280, height: 800 } }, { path: '/landing-real/' });
    await scenario(browser, base, 'landing-real-iphone13', { ...devices['iPhone 13'] }, { path: '/landing-real/' });
  }
  await browser.close(); srv.close();
  console.log(results.join('\n'));
  console.log(`\n${results.length - failures}/${results.length} comprobaciones superadas`);
  process.exitCode = failures ? 1 : 0;
})();
