/**
 * Rufi · cargador central (https://referencehome.es/rufi/rufi.js)
 *
 * Es lo único que se incluye en cada página. Pesa ~1 KB y decide si Rufi se activa:
 *
 *   Landing HTML (configuración por nombre):
 *     <script src="/rufi/rufi.js" data-rufi-config="aval-ico-valencia" defer></script>
 *
 *   Joomla (un único fragmento en la plantilla; la página se busca en configs/_routes.json):
 *     <script src="/rufi/rufi.js" defer></script>
 *
 *   Configuración en la propia página (sin archivo JSON):
 *     <script>window.RufiConfig = { ... }</script><script src="/rufi/rufi.js" defer></script>
 *
 * Orden de decisión: ?rufi=off en la URL → no carga · configs/_global.json enabled:false → no
 * carga (salvo ?rufi=on) · página en disabledPages → no carga · sin configuración para la
 * página → no carga · configuración con enabled:false → no carga. Solo si todo lo permite se
 * descarga el núcleo versionado (/rufi/v/<versión>/rufi-core.js) y, después, el 3D.
 */
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

  function start() {
    getJSON(BASE + 'configs/_global.json').then(function (global) {
      global = global || {};
      if (global.enabled === false && force !== 'on') return log('desactivado globalmente (_global.json)');
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
          var version = String(cfg.version || global.version || DEFAULT_VERSION).replace(/[^0-9a-z.\-]/gi, '');
          var assets = BASE + 'v/' + version + '/';
          var final = {};
          for (var k in cfg) final[k] = cfg[k];
          if (inline && cfgName) for (var k2 in inline) final[k2] = inline[k2]; // la página puede ajustar la configuración
          final.assetsBase = assets; final.autoInit = true;
          if (force === 'debug') final.debug = true;
          window.RufiConfig = final;
          var s = document.createElement('script');
          s.src = assets + 'rufi-core.js'; s.defer = true; s.setAttribute('data-rufi-core', version);
          (document.head || document.documentElement).appendChild(s);
          log('activado: ' + (cfgName || 'configuración en la página') + ' · versión ' + version);
        });
      });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
