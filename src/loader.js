/**
 * Rufi · cargador central (https://referencehome.es/rufi/rufi.js) · contrato 1.1
 *
 * Es lo único que se incluye en cada página. Decide si Rufi se activa:
 *
 *   Landing HTML (configuración por nombre):
 *     <script src="/rufi/rufi.js" data-rufi-config="aval-ico-valencia" defer></script>
 *
 *   Joomla (un único fragmento en la plantilla; la página se busca por su ruta):
 *     <script src="/rufi/rufi.js" defer></script>
 *
 *   Configuración en la propia página (sin archivo JSON):
 *     <script>window.RufiConfig = { ... }</script><script src="/rufi/rufi.js" defer></script>
 *
 * Dos modos, según configs/_global.json (Arsys):
 *
 *   1.0 («legacy», sin source.static): EXACTAMENTE el comportamiento del cargador 1.0.0.
 *     ?rufi=off → no carga · _global.json enabled:false → no carga (salvo ?rufi=on) · página en
 *     disabledPages → no carga · sin configuración → no carga · configuración con enabled:false →
 *     no carga. Si todo lo permite, descarga /rufi/v/<versión>/rufi-core.js y, después, el 3D.
 *
 *   1.1 («storage», con source.static = cubeta pública de Supabase Storage):
 *     lee a la vez v1/status.json y v1/pages/<slug>.json y aplica decide() de
 *     spec/reference/decide.mjs (el apagado gana siempre; sin estado válido, no carga; las copias
 *     de localStorage solo valen si son válidas, no han caducado y tienen la revisión más alta).
 *     Con la página abierta, cada recheckSeconds (pestaña visible), al volver a la pestaña y al
 *     recuperar la conexión, vuelve a mirar y aplica decideLive(): un apagado retira a Rufi.
 *
 * Toda la lógica de decisión está en src/loader-core.js (pura y probada con los vectores).
 */
import * as core from './loader-core.js';

(function () {
  'use strict';
  if (window.__rufiLoader) return; window.__rufiLoader = true;
  var script = document.currentScript;
  if (!script) return;
  var BASE = script.src.replace(/[^/]*(\?.*)?$/, ''); // .../rufi/
  var DEFAULT_VERSION = '__RUFI_VERSION__';
  var params = new URLSearchParams(location.search);
  var force = params.get('rufi');
  if (force === 'off') return;

  function getJSON(url) {
    return fetch(url, { credentials: 'same-origin', cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }
  function routeFor(routes, path) {
    if (!routes || !routes.routes) return null;
    for (var i = 0; i < routes.routes.length; i++) {
      var r = routes.routes[i];
      if (r.path === path) return r.config;
      if (r.prefix && path.indexOf(r.prefix) === 0) return r.config;
    }
    return null;
  }
  function log(msg) { if (force === 'debug') try { console.info('[Rufi cargador] ' + msg); } catch (e) { /* */ } }
  function emit(name, detail) { try { document.dispatchEvent(new CustomEvent('rufi:' + name, { detail: detail })); } catch (e) { /* */ } }

  /** Descarga el núcleo de v/<versión>/ con la configuración final. Común a los dos modos. */
  function inject(cfg, cfgName, inline, version, extra) {
    version = core.cleanVersion(version) || DEFAULT_VERSION;
    var assets = BASE + 'v/' + version + '/';
    var final = {};
    for (var k in cfg) final[k] = cfg[k];
    if (inline && cfgName) for (var k2 in inline) final[k2] = inline[k2]; // la página puede ajustar la configuración
    if (extra) for (var k3 in extra) final[k3] = extra[k3];
    final.assetsBase = assets; final.autoInit = true;
    if (force === 'debug') final.debug = true;
    window.RufiConfig = final;
    var s = document.createElement('script');
    s.src = assets + 'rufi-core.js'; s.defer = true; s.setAttribute('data-rufi-core', version);
    (document.head || document.documentElement).appendChild(s);
    log('activado: ' + (cfgName || 'configuración en la página') + ' · versión ' + version);
  }

  // ------------------------------------------------------------------ modo 1.0 (sin cambios)
  function legacy(global) {
    var name = script.getAttribute('data-rufi-config');
    var inline = window.RufiConfig && typeof window.RufiConfig === 'object' ? window.RufiConfig : null;
    var pick = name || inline ? Promise.resolve(name) : getJSON(BASE + 'configs/_routes.json').then(function (r) { return routeFor(r, location.pathname); });
    return pick.then(function (cfgName) {
      if (!cfgName && !inline) return log('sin configuración para ' + location.pathname);
      if (cfgName && (global.disabledPages || []).indexOf(cfgName) >= 0 && force !== 'on') return log('página desactivada: ' + cfgName);
      var cfgP = inline && !cfgName ? Promise.resolve(inline) : getJSON(BASE + 'configs/' + encodeURIComponent(cfgName) + '.json' + (global.configVersion ? '?v=' + encodeURIComponent(global.configVersion) : ''));
      return cfgP.then(function (cfg) {
        if (!cfg) return log('configuración no encontrada: ' + cfgName);
        if (cfg.enabled === false && force !== 'on') return log('configuración desactivada: ' + cfgName);
        inject(cfg, cfgName, inline, cfg.version || global.version || DEFAULT_VERSION);
      });
    });
  }

  // ------------------------------------------------------------------ modo 1.1 (Supabase Storage)
  /** GET a la cubeta con tiempo máximo. Nunca lanza: devuelve el resultado que espera decide(). */
  function fetchRes(url, ms, opts) {
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timedOut = false;
    var t = setTimeout(function () { timedOut = true; if (ctrl) ctrl.abort(); }, ms);
    var o = { credentials: 'omit', cache: 'no-cache', mode: 'cors', redirect: 'error', referrerPolicy: 'no-referrer' };
    if (opts) for (var k in opts) o[k] = opts[k];
    if (ctrl) o.signal = ctrl.signal;
    return fetch(url, o)
      .then(function (r) { return r.status === 200 || r.status === 400 ? r.text().then(function (txt) { return core.toResult(r.status, txt); }) : core.toResult(r.status, null); })
      .catch(function () { return { kind: timedOut ? 'timeout' : 'error' }; })
      .then(function (res) { clearTimeout(t); return timedOut && res.kind === 'ok' ? { kind: 'timeout' } : res; });
  }
  var LS = 'rufi:v1:';
  function cacheGet(k) { try { return core.parseCached(localStorage.getItem(LS + k)); } catch (e) { return null; } }
  function cacheSet(k, v) { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } }
  function cacheDel(k) { try { localStorage.removeItem(LS + k); } catch (e) { /* */ } }
  function cacheClearAll() { try { Object.keys(localStorage).forEach(function (k) { if (k.indexOf(LS) === 0) localStorage.removeItem(k); }); } catch (e) { /* */ } }
  /** Aplica lo que decide() indica sobre las copias: write (guardar lo remoto), clear (borrar), keep. */
  function applyCache(d, slug, remote) {
    if (!d.cache) return;
    var pk = 'page:' + slug;
    if (d.cache.status === 'write' && remote.status && remote.status.kind === 'ok') cacheSet('status', remote.status.envelope);
    else if (d.cache.status === 'clear') cacheDel('status');
    if (slug) {
      if (d.cache.page === 'write' && remote.page && remote.page.kind === 'ok') cacheSet(pk, remote.page.envelope);
      else if (d.cache.page === 'clear') cacheDel(pk);
    }
  }
  function sha256hex(text) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (b) {
      var a = new Uint8Array(b), s = ''; for (var i = 0; i < a.length; i++) s += (a[i] < 16 ? '0' : '') + a[i].toString(16); return s;
    });
  }
  /** Joomla con fragmento global: v1/routes/<sha256(ruta)>.json y, si no está, el _routes.json local. */
  function findSlug(global, src) {
    var local = function () { return getJSON(BASE + 'configs/_routes.json').then(function (r) { return routeFor(r, location.pathname); }); };
    var p = core.normalizePath(location.pathname);
    if (p == null || !window.crypto || !crypto.subtle) return local();
    return sha256hex(p).then(function (h) { return fetchRes(src.static + '/routes/' + h + '.json', src.timeoutMs); })
      .then(function (res) { return core.slugFromRoute(res, new Date().toISOString()) || local(); }, local);
  }
  /** Token de vista previa en el ANCLA (#rufi-preview=…): el ancla no se envía al servidor ni en Referer. */
  function takePreviewToken() {
    var m = /(?:^#|&)rufi-preview=([^&]*)/.exec(location.hash || '');
    if (!m) return null;
    var tok = null; try { tok = decodeURIComponent(m[1]); } catch (e) { tok = null; }
    try { var rest = location.hash.replace(m[0], '').replace(/^#?&?/, ''); history.replaceState(history.state, '', location.pathname + location.search + (rest ? '#' + rest : '')); } catch (e) { /* */ }
    return tok && core.PREVIEW_TOKEN_RE.test(tok) ? tok : 'invalid';
  }
  function input(global, slug, remote, preview) {
    return { query: { rufi: force, preview: preview || null }, localGlobal: global, slug: slug, now: new Date().toISOString(), remote: remote, cache: { status: cacheGet('status'), page: slug ? cacheGet('page:' + slug) : null } };
  }

  function storage(global, src) {
    var name = script.getAttribute('data-rufi-config');
    var inline = window.RufiConfig && typeof window.RufiConfig === 'object' ? window.RufiConfig : null;
    var preview = takePreviewToken();
    var slugP = name ? Promise.resolve(name) : inline ? Promise.resolve(null) : findSlug(global, src);
    return slugP.then(function (slug) {
      if (!slug && !inline) return log('sin configuración para ' + location.pathname);
      if (slug && !core.SLUG_RE.test(slug)) return log('nombre de página no válido: ' + slug);
      if (!slug) { // configuración en la página: solo cuentan los interruptores locales y el estado global
        return fetchRes(src.static + '/status.json', src.timeoutMs).then(function (st) {
          var remote = { status: st };
          var d = core.decideInline(input(global, null, remote));
          applyCache(d, null, remote);
          if (!d.load) return log('no se carga (' + d.reason + ')');
          inject(inline, null, inline, inline.version || global.version || DEFAULT_VERSION);
        });
      }
      // Interruptores locales primero: no se pide nada a Storage si ya se sabe que no se carga.
      var pre = core.run(input(global, slug, {}, preview));
      if (core.LOCAL_REASONS.indexOf(pre.reason) >= 0) { applyCache(pre, slug, {}); return log('no se carga (' + pre.reason + ')'); }
      var remoteP;
      if (preview) {
        remoteP = !src.api || preview === 'invalid' ? Promise.resolve({ preview: { kind: 'error' } })
          : fetchRes(src.api + '/pages/' + encodeURIComponent(slug) + '?preview=' + encodeURIComponent(preview), src.timeoutMs, { cache: 'no-store' }).then(function (p) { return { preview: p }; });
      } else {
        remoteP = Promise.all([fetchRes(src.static + '/status.json', src.timeoutMs), fetchRes(src.static + '/pages/' + slug + '.json', src.timeoutMs)])
          .then(function (r) { return { status: r[0], page: r[1] }; });
      }
      return remoteP.then(function (remote) {
        var inp = input(global, slug, remote, preview);
        var d = core.run(inp);
        if (!preview) applyCache(d, slug, remote);
        if (!d.load) { emit('off', { page: slug, reason: d.reason }); return log('no se carga (' + d.reason + ')'); }
        var env = core.chosenEnvelope(d, inp);
        inject(env.config, slug, inline, env.engine || env.config.version || global.version, d.source === 'preview' ? { preview: true } : null);
        if (!preview) live(global, src, slug, env.revision);
      });
    });
  }

  /** Página abierta: vuelve a mirar y aplica decideLive(). Un corte de red no oculta a Rufi. */
  function live(global, src, slug, revision) {
    var current = { pageRevision: revision }, busy = false, done = false, lastGlobal = global;
    function check() {
      if (busy || done) return; busy = true;
      Promise.all([getJSON(BASE + 'configs/_global.json'), fetchRes(src.static + '/status.json', src.timeoutMs), fetchRes(src.static + '/pages/' + slug + '.json', src.timeoutMs)]).then(function (r) {
        if (r[0]) lastGlobal = r[0]; // sin respuesta de Arsys, vale la última conocida
        var remote = { status: r[1], page: r[2] };
        var inp = input(lastGlobal, slug, remote);
        applyCache(core.run(inp), slug, remote);
        var l = core.runLive(inp, current);
        if (l.action === 'hide') { done = true; hide(slug, l.reason); }
        else if (l.action === 'refresh') { current.pageRevision = l.revision; emit('update', { page: slug, revision: l.revision }); log('configuración nueva (revisión ' + l.revision + '): se aplicará al recargar'); }
      }).then(function () { busy = false; }, function () { busy = false; });
    }
    setInterval(function () { if (document.visibilityState === 'visible') check(); }, src.recheckSeconds * 1000);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') check(); });
    addEventListener('online', check);
  }
  function hide(slug, reason) {
    if (window.RufiConfig) window.RufiConfig.autoInit = false; // si el núcleo aún no ha arrancado, ya no arranca
    var R = window.Rufi;
    if (R && typeof R.destroy === 'function') R.destroy(); // motor ≥ 1.1.0
    else { var el = document.getElementById('rufi-root'); if (el) el.remove(); } // motor 1.0.0
    emit('off', { page: slug, reason: reason, live: true });
    log('retirado con la página abierta (' + reason + ')');
  }

  function start() {
    getJSON(BASE + 'configs/_global.json').then(function (global) {
      global = global || {};
      var src = core.sourceOf(global);
      if (global.enabled === false && force !== 'on') {
        if (src.mode !== 'legacy') cacheClearAll(); // decide() › local-kill: borra las copias (estado y páginas)
        return log('desactivado globalmente (_global.json)');
      }
      if (src.mode === 'legacy') return legacy(global);
      if (src.mode === 'invalid') return log('_global.json: «source» no cumple el contrato, Rufi no se carga (' + (src.errors || []).join('; ') + ')');
      return storage(global, src);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
