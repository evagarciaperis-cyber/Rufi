/**
 * Genera assets/web/rufi-poster.webp renderizando el propio motor 3D (dist/rufi-3d.js) en reposo,
 * con el mismo encuadre que el componente: así el paso del póster al 3D no da saltos.
 * Requiere Playwright (Chromium). Uso: npm run build && node scripts/make-poster.cjs && npm run build
 */
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, '..');
const types = { '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.html': 'text/html' };
const page = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:transparent">
<div id="c" style="position:relative;width:300px;height:352px"></div>
<script type="module">
import { createRufi3D } from '/dist/rufi-3d.js';
const e = await createRufi3D({ container: document.getElementById('c'), modelUrl: '/dist/rufi-expresivo.web.glb' });
e.setState('idle'); setTimeout(() => { window.READY = true; }, 900);
</script>`;
const srv = http.createServer((q, r) => { if (q.url === '/') { r.writeHead(200, { 'content-type': 'text/html' }); return r.end(page); }
  const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); fs.readFile(f, (e, b) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); r.end(b); }); })
  .listen(8790, async () => {
    const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const p = await b.newPage({ viewport: { width: 300, height: 352 }, deviceScaleFactor: 2 });
    p.on('pageerror', (e) => console.log('pageerror', e.message));
    await p.goto('http://localhost:8790/'); await p.waitForFunction(() => window.READY, null, { timeout: 60000 });
    await p.locator('#c').screenshot({ path: path.join(root, 'build/poster.png'), omitBackground: true });
    await b.close(); srv.close();
    await require('sharp')(path.join(root, 'build/poster.png')).webp({ quality: 88, alphaQuality: 95 }).toFile(path.join(root, 'assets/web/rufi-poster.webp'));
    console.log('assets/web/rufi-poster.webp', (fs.statSync(path.join(root, 'assets/web/rufi-poster.webp')).size / 1024).toFixed(1), 'KB');
  });
