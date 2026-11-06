/**
 * Rufi — componente web oficial (núcleo ligero, sin three.js).
 *
 * Instalación:
 *   <script>window.RufiConfig = { ... };</script>
 *   <script src="/rufi/rufi.js" defer></script>
 *
 * - Shadow DOM: no toca ni hereda estilos de la página.
 * - Muestra al instante un póster (render del propio modelo 3D) y carga el 3D (dist/rufi-3d.js)
 *   cuando la página ya ha cargado y el navegador está libre. Sin WebGL o con movimiento
 *   reducido, se queda el póster: Rufi siempre se ve y el panel siempre funciona.
 * - Mensajes predefinidos: no es un chat ni simula inteligencia artificial.
 */
(function () {
  'use strict';
  if (window.Rufi && window.Rufi.__loaded) return;

  const SCRIPT = document.currentScript;
  const BASE = SCRIPT && SCRIPT.src ? SCRIPT.src.replace(/[^/]*$/, '') : '';

  const DEFAULTS = {
    page: 'default',
    assetsBase: BASE,
    model: 'rufi-expresivo.web.glb',
    poster: 'rufi-poster.webp',
    engine: 'rufi-3d.js',
    position: 'right',
    zIndex: 46,
    size: { mobile: [112, 132], desktop: [150, 176] },
    offset: { mobile: [4, 2], desktop: [20, 16] }, // [lado, abajo] en px
    breakpoint: 768,
    replaceSelector: null, // elemento existente que Rufi sustituye (se oculta en tiempo de ejecución)
    label: 'Rufi, asistente de Reference Home: abrir opciones de ayuda',
    intro: { delay: 1800, peek: 1700 },
    welcome: null, // { text }
    bubbles: { autoHide: 9000, minGap: 20000, maxPerPage: 4, typingPause: 2000 },
    sleepAfter: 45000,
    panel: { title: '¿En qué te ayudo?', subtitle: '', options: [], footnote: '' },
    triggers: [],
    whatsapp: { number: '', message: '' },
    maxFps: 60,
    maxFpsMobile: 30, // en móvil: menos batería y menos calor; el movimiento de Rufi es suave a 30 fps
    debug: false,
    test: false, // páginas de prueba: todos los eventos llevan test: true y se registran en la consola
  };

  const merge = (a, b) => { const o = { ...a }; for (const k of Object.keys(b || {})) o[k] = b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k]) ? merge(a[k], b[k]) : b[k]; return o; };
  const store = (() => { const mem = {}; return {
    get(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch (e) { return mem[k] ?? null; } },
    set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { mem[k] = v; } },
  }; })();
  const reducedMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasWebGL = () => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; } };
  const waUrl = (number, message) => `https://wa.me/${String(number).replace(/\D/g, '')}${message ? `?text=${encodeURIComponent(message)}` : ''}`;
  /** Mensaje de WhatsApp con código de referencia opcional (para disparadores de ManyChat u otras automatizaciones). */
  const waMessage = (cfg, message, ref) => (cfg.automation && cfg.automation.appendRef && ref ? `${message} [${ref}]` : message);

  const ICONS = {
    check: '<path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    calculator: '<rect x="5" y="3.5" width="14" height="17" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8.5 7.5h7M8.5 11.5h1M12 11.5h1M15.5 11.5h0M8.5 15h1M12 15h1M15.5 15h0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    whatsapp: '<path d="M4 18.5V6.8A2.8 2.8 0 0 1 6.8 4h10.4A2.8 2.8 0 0 1 20 6.8v6.9a2.8 2.8 0 0 1-2.8 2.8H8.5L4 20z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  };

  const CSS = `
  :host{all:initial;position:fixed;z-index:var(--rufi-z,46);bottom:0;right:0;display:block;
    --g:#A11F48;--g2:#7E1638;--ink:#2B2B2B;--muted:#5E5A56;--line:#D9CEC3;--paper:#FFFDF9;--focus:#4A5D5A;
    font-family:"Montserrat",system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;color:var(--ink);font-size:15px;line-height:1.45}
  *,*::before,*::after{box-sizing:border-box}
  [hidden]{display:none!important}
  .rufi{position:relative;width:var(--w);height:var(--h)}
  .stage{position:absolute;inset:0;overflow:hidden;border-radius:0 0 4px 4px}
  .poster{position:absolute;left:0;right:0;bottom:0;margin:auto;width:100%;height:100%;object-fit:contain;object-position:50% 100%;opacity:0;transition:opacity .45s ease}
  .poster.on{opacity:1}
  canvas{opacity:0;transition:opacity .45s ease} canvas.on{opacity:1}
  .hit{position:absolute;left:12%;right:12%;top:6%;bottom:0;border:0;padding:0;margin:0;background:transparent;cursor:pointer;border-radius:40% 40% 30% 30%;-webkit-tap-highlight-color:transparent}
  .hit:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
  .rufi.hidden .hit{pointer-events:none}
  .bubble{position:absolute;bottom:calc(100% - 14px);right:calc(var(--w) * .42);width:max-content;max-width:min(260px,calc(100vw - 40px));
    background:var(--paper);border:1px solid var(--line);border-radius:16px 16px 4px 16px;box-shadow:0 8px 24px rgba(43,43,43,.14);
    display:flex;align-items:flex-start;gap:4px;padding:4px 4px 4px 0;opacity:0;transform:translateY(6px);transition:opacity .28s ease,transform .28s ease}
  .bubble.on{opacity:1;transform:none}
  .bubble-t{all:unset;cursor:pointer;padding:9px 6px 9px 13px;font-size:14px;color:var(--ink)}
  .bubble-t:focus-visible{outline:2px solid var(--focus);outline-offset:2px;border-radius:10px}
  .bubble-t b{display:block;font-size:12px;color:var(--g);letter-spacing:.02em}
  .x{all:unset;cursor:pointer;width:30px;height:30px;display:grid;place-items:center;border-radius:10px;color:var(--muted);flex:none}
  .x:hover{background:#F5E3E8;color:var(--g2)} .x:focus-visible{outline:2px solid var(--focus)}
  .x svg{width:16px;height:16px}
  .panel{position:absolute;bottom:calc(100% + 6px);right:6px;width:min(330px,calc(100vw - 20px));background:var(--paper);border:1px solid var(--line);
    border-radius:18px;box-shadow:0 18px 48px rgba(43,43,43,.2);padding:14px;opacity:0;transform:translateY(8px) scale(.98);transform-origin:100% 100%;transition:opacity .25s ease,transform .25s ease}
  .panel.on{opacity:1;transform:none}
  .head{display:flex;gap:10px;align-items:flex-start;justify-content:space-between}
  .title{font-weight:700;font-size:16px;margin:2px 0 2px}
  .sub{margin:0;color:var(--muted);font-size:13px}
  ul{list-style:none;margin:12px 0 0;padding:0;display:grid;gap:8px}
  .opt{all:unset;box-sizing:border-box;cursor:pointer;display:grid;grid-template-columns:36px minmax(0,1fr) auto;gap:10px;align-items:center;width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:14px;background:#fff}
  .opt:hover{border-color:var(--g)} .opt:focus-visible{outline:3px solid var(--focus);outline-offset:1px}
  .ic{width:36px;height:36px;border-radius:12px;display:grid;place-items:center;background:#F5E3E8;color:var(--g)} .ic svg{width:20px;height:20px}
  .opt.wa .ic{background:#E1E8E3;color:var(--focus)}
  .opt strong{display:block;font-size:14px} .opt small{display:block;color:var(--muted);font-size:12px}
  .ar{color:var(--g);font-weight:700}
  .foot{margin:10px 2px 0;color:var(--muted);font-size:11.5px}
  @media (prefers-reduced-motion: reduce){.poster,canvas,.bubble,.panel{transition:none}}
  `;

  class RufiWidget {
    constructor(cfg) {
      this.cfg = merge(DEFAULTS, cfg);
      this.key = `rufi:${this.cfg.page}:`;
      this.engine = null; this.state = 'hidden'; this.shown = 0; this.lastBubble = 0; this.typingAt = 0; this.queue = [];
      this.reduced = reducedMotion();
    }

    mount() {
      const c = this.cfg;
      if (c.replaceSelector) document.querySelectorAll(c.replaceSelector).forEach((el) => { el.hidden = true; el.setAttribute('aria-hidden', 'true'); el.style.setProperty('display', 'none', 'important'); });
      this.host = document.createElement('div');
      this.host.id = 'rufi-root'; this.host.setAttribute('data-rufi', '');
      const root = this.host.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>${CSS}</style>
        <div class="rufi hidden" part="rufi">
          <div class="stage"><img class="poster" alt="" decoding="async" draggable="false"></div>
          <button class="hit" type="button" aria-expanded="false" aria-controls="rufi-panel"></button>
          <div class="bubble" role="status" aria-live="polite" hidden>
            <button class="bubble-t" type="button"><b>Rufi</b><span></span></button>
            <button class="x" type="button" aria-label="Cerrar mensaje de Rufi"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
          </div>
          <div class="panel" id="rufi-panel" role="dialog" aria-modal="false" aria-labelledby="rufi-title" hidden>
            <div class="head"><div><p class="title" id="rufi-title"></p><p class="sub"></p></div>
              <button class="x close" type="button" aria-label="Cerrar opciones"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button></div>
            <ul></ul><p class="foot"></p>
          </div>
        </div>`;
      this.$ = (s) => root.querySelector(s);
      this.el = this.$('.rufi');
      this.$('.hit').setAttribute('aria-label', c.label);
      this.$('.poster').src = c.assetsBase + c.poster;
      this.buildPanel();
      this.applyLayout();
      addEventListener('resize', () => this.applyLayout(), { passive: true });
      document.body.appendChild(this.host);
      this.bind();
      this.watchContext();
      this.startIntro();
      this.loadEngine();
      window.Rufi.instance = this;
      this.emit('ready', {});
    }

    isMobile() { return innerWidth < this.cfg.breakpoint || (window.matchMedia && matchMedia('(pointer: coarse)').matches); }

    applyLayout() {
      const c = this.cfg; const mobile = innerWidth < c.breakpoint;
      const [w, h] = mobile ? c.size.mobile : c.size.desktop; const [side, bottom] = mobile ? c.offset.mobile : c.offset.desktop;
      const s = this.host.style;
      s.setProperty('--w', `${w}px`); s.setProperty('--h', `${h}px`); s.setProperty('--rufi-z', String(c.zIndex));
      s.setProperty('bottom', `calc(${bottom}px + env(safe-area-inset-bottom, 0px))`);
      if (c.position === 'left') { s.setProperty('left', `calc(${side}px + env(safe-area-inset-left, 0px))`); s.setProperty('right', 'auto'); }
      else s.setProperty('right', `calc(${side}px + env(safe-area-inset-right, 0px))`);
    }

    buildPanel() {
      const p = this.cfg.panel;
      this.$('.title').textContent = p.title; this.$('.sub').textContent = p.subtitle; this.$('.foot').textContent = p.footnote;
      const ul = this.$('ul');
      for (const o of p.options) {
        const li = document.createElement('li');
        const a = document.createElement(o.action.type === 'whatsapp' || o.action.type === 'link' ? 'a' : 'button');
        a.className = `opt${o.action.type === 'whatsapp' ? ' wa' : ''}`;
        if (a.tagName === 'A') { a.href = o.action.type === 'whatsapp' ? waUrl(o.action.number || this.cfg.whatsapp.number, waMessage(this.cfg, o.action.message || this.cfg.whatsapp.message, o.ref || o.action.ref)) : o.action.href; a.target = '_blank'; a.rel = 'noopener'; }
        else a.type = 'button';
        a.innerHTML = `<span class="ic" aria-hidden="true"><svg viewBox="0 0 24 24">${ICONS[o.icon] || ICONS.check}</svg></span><span><strong></strong><small></small></span><span class="ar" aria-hidden="true">→</span>`;
        a.querySelector('strong').textContent = o.label; a.querySelector('small').textContent = o.hint || '';
        a.addEventListener('click', (e) => this.runAction(o, e));
        li.appendChild(a); ul.appendChild(li);
      }
    }

    bind() {
      this.$('.hit').addEventListener('click', () => this.togglePanel());
      this.$('.hit').addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse' && this.state === 'idle') this.setState('curious'); });
      this.$('.close').addEventListener('click', () => this.closePanel(true));
      this.$('.bubble .x').addEventListener('click', () => { this.hideBubble(); store.set(this.key + 'silencio', true); this.emit('bubble-dismiss', {}); });
      this.$('.bubble-t').addEventListener('click', () => { const a = this.bubbleAction; this.hideBubble(); if (a) this.runAction({ id: 'bubble', action: a }); else this.openPanel(); });
      this.host.shadowRoot.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (!this.$('.panel').hidden) this.closePanel(true); else this.hideBubble(); } });
      document.addEventListener('pointerdown', (e) => { if (!this.$('.panel').hidden && !e.composedPath().includes(this.host)) this.closePanel(false); });
      const activity = () => { this.lastActivity = performance.now(); if (this.state === 'sleep') this.setState('idle'); };
      for (const ev of ['pointermove', 'keydown', 'scroll', 'touchstart']) addEventListener(ev, activity, { passive: true });
      document.addEventListener('input', (e) => { if (!e.composedPath().includes(this.host)) this.typingAt = performance.now(); }, true);
      this.lastActivity = performance.now();
      setInterval(() => { if (this.state === 'idle' && this.$('.panel').hidden && performance.now() - this.lastActivity > this.cfg.sleepAfter) this.setState('sleep'); this.flushQueue(); }, 1000);
    }

    // ------------------------------------------------------------------ estados
    setState(name) {
      if (this.state === name && name !== 'curious') return;
      this.state = name;
      // Estados pasajeros sin clip propio: vuelven a reposo (si no, Rufi no volvería a dormirse)
      clearTimeout(this.transientT);
      const hold = { happy: 1800 }[name];
      if (hold) this.transientT = setTimeout(() => { if (this.state === name) this.setState('idle'); }, hold);
      this.el.classList.toggle('hidden', name === 'hidden' || name === 'exit');
      if (this.engine) this.engine.setState(name);
      this.emit('state', { state: name });
    }
    react(expr) { if (this.engine) this.engine.react(expr); }

    startIntro() {
      const greeted = store.get(this.key + 'saludo');
      const run = () => {
        this.showFigure();
        if (this.reduced || !this.engine) { this.setState('idle'); if (!greeted) this.welcome(); return; }
        if (greeted) { this.setState('enter'); setTimeout(() => this.state === 'enter' && this.setState('idle'), 900); return; }
        this.setState('peek');
        setTimeout(() => { this.setState('enter'); setTimeout(() => { this.setState('greet'); this.welcome(); }, 800); }, this.cfg.intro.peek);
      };
      this.introRun = run;
      setTimeout(() => { this.introDue = true; if (this.engine || this.engineFailed || this.reduced) run(); }, this.cfg.intro.delay);
    }

    showFigure() { if (this.engine) this.engine.canvas.classList.add('on'); else this.$('.poster').classList.add('on'); }

    loadEngine() {
      if (this.reduced || !hasWebGL()) { this.engineFailed = true; if (this.introDue) this.introRun(); return; }
      const go = () => import(/* webpackIgnore: true */ this.cfg.assetsBase + this.cfg.engine)
        .then((m) => m.createRufi3D({ container: this.$('.stage'), modelUrl: this.cfg.assetsBase + this.cfg.model, modelBuffer: this.cfg.modelBuffer || null, maxFps: this.isMobile() ? this.cfg.maxFpsMobile : this.cfg.maxFps, maxPixelRatio: this.isMobile() ? 1.5 : 2, onStateEnd: (s, next) => { this.emit('state-end', { state: s }); if (this.state === s) { this.state = next; this.el.classList.toggle('hidden', false); this.emit('state', { state: next }); } } }))
        .then((engine) => {
          this.engine = engine;
          this.$('.poster').classList.remove('on');
          if (this.introDue) this.introRun();
          this.emit('engine', { clips: engine.clips });
        })
        .catch((err) => { this.engineFailed = true; if (this.cfg.debug) console.warn('[Rufi] 3D no disponible, se usa el póster:', err); if (this.introDue) this.introRun(); });
      const idle = window.requestIdleCallback || ((f) => setTimeout(f, 1200));
      if (document.readyState === 'complete') idle(go, { timeout: 2500 }); else addEventListener('load', () => idle(go, { timeout: 2500 }), { once: true });
    }

    // ------------------------------------------------------------------ mensajes
    welcome() {
      const w = this.cfg.welcome; if (!w || store.get(this.key + 'saludo')) return;
      store.set(this.key + 'saludo', true);
      this.say({ id: 'bienvenida', text: w.text, force: true, priority: 3 });
    }

    /** Muestra un mensaje si las reglas lo permiten; si el visitante está escribiendo, espera. */
    say(m) {
      const b = this.cfg.bubbles;
      if (m.once && store.get(this.key + 'visto:' + m.id)) return false;
      if (!m.force) {
        if (store.get(this.key + 'silencio')) return false;
        if (this.shown >= b.maxPerPage) return false;
      }
      // Prioridad: el resultado de un proceso (test terminado, simulador) sustituye en el acto a
      // un mensaje de menor prioridad que esté visible, en lugar de esperar a que se oculte.
      const prio = m.priority || 1;
      const replacing = !this.$('.bubble').hidden && prio > (this.bubblePriority || 0);
      const busy = !this.$('.panel').hidden || performance.now() - this.typingAt < b.typingPause || (!m.force && !replacing && performance.now() - this.lastBubble < b.minGap);
      if (busy) { if (!this.queue.some((q) => q.id === m.id)) this.queue.push({ ...m, until: performance.now() + 20000 }); return false; }
      if (m.once) store.set(this.key + 'visto:' + m.id, true);
      this.queue = this.queue.filter((q) => q.id !== m.id);
      const bub = this.$('.bubble');
      this.$('.bubble-t span').textContent = m.text;
      this.bubbleAction = m.action || null; this.bubblePriority = prio;
      bub.hidden = false; requestAnimationFrame(() => bub.classList.add('on'));
      this.shown++; this.lastBubble = performance.now();
      if (m.state && this.state !== 'greet') this.setState(m.state);
      if (m.expr) this.react(m.expr);
      clearTimeout(this.hideT); this.hideT = setTimeout(() => this.hideBubble(), b.autoHide);
      this.emit('bubble', { id: m.id, text: m.text });
      return true;
    }
    flushQueue() {
      const now = performance.now();
      // fuera: caducados, ya no relevantes, ya vistos o silenciados (si no, bloquearían la cola)
      this.queue = this.queue.filter((m) => m.until > now && (!m.isRelevant || m.isRelevant()) && !(m.once && store.get(this.key + 'visto:' + m.id)) && !(!m.force && store.get(this.key + 'silencio')));
      if (!this.queue.length) return;
      if (!this.$('.bubble').hidden && !this.queue.some((q) => (q.priority || 1) > (this.bubblePriority || 0))) return;
      this.queue.sort((a, c) => (c.priority || 1) - (a.priority || 1));
      const m = this.queue.shift(); if (!this.say({ ...m })) this.queue.unshift(m);
    }
    hideBubble() { const bub = this.$('.bubble'); bub.classList.remove('on'); this.bubblePriority = 0; clearTimeout(this.hideT); setTimeout(() => { if (!bub.classList.contains('on')) bub.hidden = true; }, this.reduced ? 0 : 300); }

    // ------------------------------------------------------------------ panel
    togglePanel() { if (this.$('.panel').hidden) this.openPanel(); else this.closePanel(true); }
    openPanel() {
      if (this.state === 'hidden' || this.state === 'peek') this.setState('enter');
      this.hideBubble();
      const p = this.$('.panel'); p.hidden = false; requestAnimationFrame(() => p.classList.add('on'));
      this.$('.hit').setAttribute('aria-expanded', 'true');
      if (this.state === 'sleep') this.setState('idle');
      this.react('smile');
      const first = this.$('.opt'); if (first) first.focus({ preventScroll: true });
      this.emit('open', {});
    }
    closePanel(returnFocus) {
      const p = this.$('.panel'); if (p.hidden) return;
      p.classList.remove('on'); setTimeout(() => { if (!p.classList.contains('on')) p.hidden = true; }, this.reduced ? 0 : 260);
      this.$('.hit').setAttribute('aria-expanded', 'false');
      if (returnFocus) this.$('.hit').focus({ preventScroll: true });
      this.emit('close', {});
    }

    runAction(o, ev) {
      const a = o.action;
      this.emit('action', { id: o.id, type: a.type, ref: o.ref || a.ref || null });
      if (a.type === 'scroll') {
        if (ev) ev.preventDefault();
        const el = document.querySelector(a.target);
        this.closePanel(false);
        if (el) {
          el.scrollIntoView({ behavior: this.reduced ? 'auto' : 'smooth', block: 'start' });
          // Las páginas con contenido que aparece al hacer scroll (animaciones .reveal, imágenes
          // diferidas) mueven el destino durante el desplazamiento: se comprueba y se corrige.
          const fix = (n) => setTimeout(() => { const top = el.getBoundingClientRect().top; if (Math.abs(top) > 40 && n > 0) { el.scrollIntoView({ behavior: 'auto', block: 'start' }); fix(n - 1); } }, 900);
          fix(2);
          const f = a.focus ? document.querySelector(a.focus) : el;
          if (f) { if (!f.hasAttribute('tabindex') && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(f.tagName)) f.setAttribute('tabindex', '-1'); setTimeout(() => f.focus({ preventScroll: true }), this.reduced ? 0 : 450); }
        }
        this.react('smile');
      } else if (a.type === 'whatsapp' || a.type === 'link') {
        // Desde el panel es un enlace <a> real; desde una burbuja se abre aquí.
        if (!ev || !ev.currentTarget || ev.currentTarget.tagName !== 'A') {
          const url = a.type === 'whatsapp' ? waUrl(a.number || this.cfg.whatsapp.number, waMessage(this.cfg, a.message || this.cfg.whatsapp.message, a.ref)) : a.href;
          const w = window.open(url, '_blank', 'noopener'); if (!w) location.href = url;
        }
        this.closePanel(false);
      } else if (a.type === 'event') {
        if (ev) ev.preventDefault(); this.closePanel(false); // solo emite rufi:action (para automatizaciones)
      } else if (a.type === 'panel') {
        if (ev) ev.preventDefault(); this.openPanel();
      }
    }

    // ------------------------------------------------------------------ contexto
    watchContext() {
      for (const t of this.cfg.triggers) {
        const msg = () => ({ id: t.id, text: t.say, once: t.once !== false, state: t.state, expr: t.expr, action: t.bubbleAction, priority: t.priority || (t.on === 'visible' ? 1 : 2), isRelevant: t.relevant });
        if (t.on === 'visible') {
          const el = document.querySelector(t.selector); if (!el) continue;
          let timer = 0;
          const io = new IntersectionObserver(([e]) => {
            clearTimeout(timer);
            if (e.isIntersecting && e.intersectionRatio >= (t.threshold || 0.3)) timer = setTimeout(() => this.say({ ...msg(), isRelevant: () => this.isVisible(el, t.threshold || 0.3) }), t.dwell || 1200);
          }, { threshold: [0, t.threshold || 0.3, 0.6] });
          io.observe(el);
        } else if (t.on === 'complete') {
          const root = document.querySelector(t.selector); if (!root) continue;
          const check = () => { const m = root.querySelector(t.match); if (m && !(t.match && t.visibleOnly && m.closest('[hidden]'))) { this.say(msg()); return true; } return false; };
          const mo = new MutationObserver(() => { if (check() && t.once !== false) mo.disconnect(); });
          mo.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class'] });
        } else if (t.on === 'shown') {
          const el = document.querySelector(t.selector); if (!el) continue;
          const mo = new MutationObserver(() => { if (!el.hidden) { this.say(msg()); if (t.once !== false) mo.disconnect(); } });
          mo.observe(el, { attributes: true, attributeFilter: ['hidden'] });
        }
      }
    }
    isVisible(el, ratio) { const r = el.getBoundingClientRect(); const vis = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)); return vis / Math.min(r.height || 1, innerHeight) >= ratio * 0.8; }

    emit(name, detail) {
      const d = { page: this.cfg.page, ...(this.cfg.test ? { test: true } : {}), ...detail };
      if (this.cfg.test || this.cfg.debug) try { console.info(`[Rufi${this.cfg.test ? ' PRUEBA' : ''}] ${name}`, d); } catch (e) { /* */ }
      try { document.dispatchEvent(new CustomEvent(`rufi:${name}`, { detail: d })); } catch (e) { /* sin eventos */ }
    }
  }

  window.Rufi = {
    __loaded: true,
    init(cfg) {
      const w = new RufiWidget(cfg);
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => w.mount(), { once: true }); else w.mount();
      return w;
    },
    /** Solo para pruebas: borra la memoria de sesión de una página. */
    resetSession(page = 'default') { try { Object.keys(sessionStorage).filter((k) => k.startsWith(`rufi:${page}:`)).forEach((k) => sessionStorage.removeItem(k)); } catch (e) { /* */ } },
  };
  if (window.RufiConfig && window.RufiConfig.autoInit !== false) window.Rufi.init(window.RufiConfig);
})();
