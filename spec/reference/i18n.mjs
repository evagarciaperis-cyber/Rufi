/**
 * Referencia del contrato 1.1 · idiomas. Funciones puras, sin dependencias (válidas en navegador
 * y en Node). El motor 1.1.0 (fase D) y el CRM (fase B) deben dar exactamente estos resultados:
 * los casos están en spec/vectors/i18n.json.
 */
export const LANGS = ['es', 'en', 'fr', 'it', 'de'];

const primary = (l) => (typeof l === 'string' ? l.trim().toLowerCase().split(/[-_]/)[0] : '');

/**
 * Idioma de Rufi en una página: 1) <html lang> de la página (Rufi habla el idioma de la página,
 * para que sus botones y mensajes coincidan con lo que se ve), 2) idiomas del navegador,
 * 3) idioma base de la configuración. Solo idiomas disponibles (base + i18n).
 */
export function pickLang({ htmlLang, navigatorLangs = [], cfg }) {
  const base = (cfg && cfg.lang) || 'es';
  const available = new Set([base, ...Object.keys((cfg && cfg.i18n) || {})].filter((l) => LANGS.includes(l)));
  for (const c of [htmlLang, ...navigatorLangs].map(primary)) if (available.has(c)) return c;
  return base;
}

/** Configuración con los textos del idioma `lang` aplicados (lo que falte queda en el idioma base). Sin i18n en la salida. */
export function resolveTexts(cfg, lang) {
  const out = JSON.parse(JSON.stringify(cfg));
  delete out.i18n;
  const base = cfg.lang || 'es';
  out.lang = base;
  const tx = lang !== base && cfg.i18n ? cfg.i18n[lang] : null;
  if (!tx) return out;
  out.lang = lang;
  const set = (obj, key, v) => { if (obj && typeof v === 'string' && v) obj[key] = v; };
  set(out, 'label', tx.label);
  if (tx.welcome && out.welcome) set(out.welcome, 'text', tx.welcome.text);
  if (tx.whatsapp && out.whatsapp) set(out.whatsapp, 'message', tx.whatsapp.message);
  if (tx.panel && out.panel) {
    for (const k of ['title', 'subtitle', 'footnote']) set(out.panel, k, tx.panel[k]);
    for (const o of out.panel.options || []) {
      const t = tx.panel.options && tx.panel.options[o.id]; if (!t) continue;
      set(o, 'label', t.label); set(o, 'hint', t.hint);
      if (o.action && o.action.type === 'whatsapp') set(o.action, 'message', t.message);
    }
  }
  for (const t of out.triggers || []) {
    const x = tx.triggers && tx.triggers[t.id]; if (!x) continue;
    set(t, 'say', x.say);
    if (t.bubbleAction && t.bubbleAction.type === 'whatsapp') set(t.bubbleAction, 'message', x.message);
  }
  if (tx.ai && out.ai) { set(out.ai, 'notice', tx.ai.notice); set(out.ai, 'greeting', tx.ai.greeting); }
  return out;
}
