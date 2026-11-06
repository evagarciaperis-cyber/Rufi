#!/usr/bin/env node
/**
 * Valida configuraciones de Rufi (contrato 1.1, compatible con 1.0) y los sobres de la API
 * Rufi ↔ CRM, sin dependencias: implementa el subconjunto de JSON Schema que usan
 * spec/rufi-config.schema.json y spec/rufi-crm-api.schema.json, y añade comprobaciones de
 * sentido común (ids, WhatsApp, traducciones, aviso de IA, caducidad…).
 *
 * Uso: node tools/validate-config.mjs configs/aval-ico-valencia.json [más archivos…]
 *      [--html pagina.html]   comprueba además que los selectores existen en esa página
 *      [--api]                los archivos son sobres de la API (respaldo estático en modo API)
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = JSON.parse(readFileSync(path.join(here, '..', 'spec', 'rufi-config.schema.json'), 'utf8'));
let API_SCHEMA = null;
const apiSchema = () => {
  if (API_SCHEMA) return API_SCHEMA;
  const p = [path.join(here, '..', 'spec', 'rufi-crm-api.schema.json'), path.join(here, 'rufi-crm-api.schema.json')].find(existsSync);
  if (!p) throw new Error('falta spec/rufi-crm-api.schema.json');
  return (API_SCHEMA = JSON.parse(readFileSync(p, 'utf8')));
};

export const CONTRACT_VERSION = '1.1';
export const LANGS = ['es', 'en', 'fr', 'it', 'de'];
/** Palabra que debe aparecer en el aviso de IA de cada idioma (transparencia). */
export const AI_WORD = { es: /\bIA\b/, fr: /\bIA\b/, it: /\bIA\b/, en: /\bAI\b/, de: /\bKI\b/ };

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
const resolveIn = (root, ref) => ref.replace(/^#\//, '').split('/').reduce((o, k) => o[k], root);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/** Validación JSON Schema (subconjunto: type, enum, const, required, properties, additionalProperties
 *  (false o esquema), propertyNames, items, min/max, pattern, format date-time, $ref). */
export function validateSchema(value, schema = SCHEMA, at = '', root = SCHEMA) {
  const errors = [];
  if (schema.$ref) return validateSchema(value, resolveIn(root, schema.$ref), at, root);
  const t = typeOf(value);
  if (schema.type) { const types = [].concat(schema.type); if (!types.includes(t) && !(t === 'integer' && types.includes('number'))) { errors.push(`${at || '/'}: debe ser ${types.join(' o ')} (es ${t})`); return errors; } }
  if ('const' in schema && value !== schema.const) errors.push(`${at || '/'}: debe ser ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${at}: valor no permitido «${value}» (permitidos: ${schema.enum.join(', ')})`);
  if (t === 'string') {
    if (schema.minLength != null && value.length < schema.minLength) errors.push(`${at}: texto vacío o demasiado corto`);
    if (schema.maxLength != null && value.length > schema.maxLength) errors.push(`${at}: texto demasiado largo (${value.length} > ${schema.maxLength})`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${at}: formato no válido «${value.slice(0, 80)}»`);
    if (schema.format === 'date-time' && (!ISO.test(value) || Number.isNaN(Date.parse(value)))) errors.push(`${at}: fecha no válida (ISO 8601 en UTC, …Z)`);
  }
  if (t === 'number' || t === 'integer') {
    if (schema.minimum != null && value < schema.minimum) errors.push(`${at}: mínimo ${schema.minimum}`);
    if (schema.maximum != null && value > schema.maximum) errors.push(`${at}: máximo ${schema.maximum}`);
  }
  if (t === 'array') {
    if (schema.minItems != null && value.length < schema.minItems) errors.push(`${at}: al menos ${schema.minItems} elementos`);
    if (schema.maxItems != null && value.length > schema.maxItems) errors.push(`${at}: como mucho ${schema.maxItems} elementos`);
    if (schema.items) value.forEach((v, i) => errors.push(...validateSchema(v, schema.items, `${at}/${i}`, root)));
  }
  if (t === 'object') {
    for (const r of schema.required || []) if (!(r in value)) errors.push(`${at}/${r}: obligatorio`);
    for (const [k, v] of Object.entries(value)) {
      if (schema.propertyNames) { const e = validateSchema(k, schema.propertyNames, `${at}/${k}`, root); if (e.length) { errors.push(`${at}/${k}: nombre de propiedad no permitido`); continue; } }
      if (schema.properties && k in schema.properties) errors.push(...validateSchema(v, schema.properties[k], `${at}/${k}`, root));
      else if (schema.additionalProperties === false) errors.push(`${at}/${k}: propiedad desconocida`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') errors.push(...validateSchema(v, schema.additionalProperties, `${at}/${k}`, root));
    }
  }
  return errors;
}

/** Compara versiones x.y.z. */
export function semverCmp(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0) ? -1 : 1;
  return 0;
}

/** Campos de 1.1 que usa la configuración (vacío = es una configuración 1.0). */
export function features11(cfg) {
  return ['lang', 'i18n', 'ai'].filter((k) => cfg && k in cfg).concat(cfg && cfg.contract === '1.1' ? ['contract'] : []);
}

/** Comprobaciones de sentido común. `html`: texto de la página para comprobar selectores.
 *  `engine`: versión del motor que la servirá (si se conoce). */
export function validateConfig(cfg, { html, engine } = {}) {
  const errors = validateSchema(cfg);
  const warnings = [];
  if (typeOf(cfg) !== 'object') return { errors, warnings };
  const opts = Array.isArray(cfg.panel?.options) ? cfg.panel.options : [];
  const trigs = Array.isArray(cfg.triggers) ? cfg.triggers : [];
  const ids = opts.map((o) => o.id);
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i); if (dup.length) errors.push(`/panel/options: ids repetidos ${dup.join(', ')}`);
  const tids = trigs.map((t) => t.id);
  const tdup = tids.filter((x, i) => tids.indexOf(x) !== i); if (tdup.length) errors.push(`/triggers: ids repetidos ${tdup.join(', ')}`);
  const usesWA = opts.some((o) => o.action?.type === 'whatsapp' && !o.action.number) || trigs.some((t) => t.bubbleAction?.type === 'whatsapp' && !t.bubbleAction.number);
  if (usesWA && !cfg.whatsapp?.number) errors.push('/whatsapp/number: obligatorio si alguna acción es de WhatsApp sin número propio');
  for (const o of opts) if (o.action?.type === 'scroll' && !o.action.target) errors.push(`/panel/options/${o.id}: una acción scroll necesita target`);
  for (const o of opts) if (o.action?.type === 'link' && !o.action.href) errors.push(`/panel/options/${o.id}: una acción link necesita href`);
  for (const t of trigs) if (t.bubbleAction?.type === 'link' && !t.bubbleAction.href) errors.push(`/triggers/${t.id}: una acción link necesita href`);
  for (const t of trigs) if (t.on === 'complete' && !t.match) errors.push(`/triggers/${t.id}: on=complete necesita match`);
  if (cfg.automation?.appendRef) {
    const missing = opts.filter((o) => o.action?.type === 'whatsapp' && !o.ref && !o.action.ref).map((o) => o.id);
    if (missing.length) warnings.push(`automation.appendRef activo pero sin ref en: ${missing.join(', ')}`);
  }
  if (cfg.enabled === false) warnings.push('enabled: false → Rufi no se cargará en esta página');

  // ---------------------------------------------------------------- contrato 1.1
  const f11 = features11(cfg);
  if (f11.length) {
    if (cfg.contract === '1.0') errors.push(`/contract: «1.0» no admite ${f11.join(', ')} (usa contract «1.1»)`);
    const v = engine || cfg.version;
    if (v && semverCmp(v, '1.1.0') < 0) errors.push(`/version: ${f11.join(', ')} necesitan el motor ≥ 1.1.0 (se serviría con ${v})`);
    else if (!v) warnings.push(`usa ${f11.join(', ')} (1.1): la versión global del motor debe ser ≥ 1.1.0; con 1.0.0 se mostrarían solo los textos base`);
  }
  const base = cfg.lang || 'es';
  const i18n = cfg.i18n && typeOf(cfg.i18n) === 'object' ? cfg.i18n : {};
  if (base in i18n) errors.push(`/i18n/${base}: es el idioma base (lang); sus textos van en los campos normales`);
  for (const [lang, tx] of Object.entries(i18n)) {
    if (typeOf(tx) !== 'object') continue;
    const at = `/i18n/${lang}`;
    for (const id of Object.keys(tx.panel?.options || {})) {
      const o = opts.find((x) => x.id === id);
      if (!o) errors.push(`${at}/panel/options/${id}: no existe esa opción`);
      else if (tx.panel.options[id].message && o.action?.type !== 'whatsapp') errors.push(`${at}/panel/options/${id}/message: solo para opciones de WhatsApp`);
    }
    for (const id of Object.keys(tx.triggers || {})) {
      const t = trigs.find((x) => x.id === id);
      if (!t) errors.push(`${at}/triggers/${id}: no existe ese disparador`);
      else if (tx.triggers[id].message && t.bubbleAction?.type !== 'whatsapp') errors.push(`${at}/triggers/${id}/message: solo para disparadores con acción de WhatsApp`);
    }
    const missing = [];
    if (cfg.welcome?.text && !tx.welcome?.text) missing.push('welcome');
    if (cfg.panel?.title && !tx.panel?.title) missing.push('panel.title');
    for (const o of opts) if (!tx.panel?.options?.[o.id]?.label) missing.push(`opción ${o.id}`);
    for (const t of trigs) if (!tx.triggers?.[t.id]?.say) missing.push(`mensaje ${t.id}`);
    if (missing.length) warnings.push(`${at}: sin traducir (se verá en «${base}»): ${missing.join(', ')}`);
  }
  if (cfg.ai?.enabled) {
    if (!cfg.ai.notice) errors.push('/ai/notice: obligatorio con la IA activada (aviso visible de que es una IA)');
    else if (!AI_WORD[base].test(cfg.ai.notice)) errors.push(`/ai/notice: el aviso debe decir claramente que es una IA (palabra «${String(AI_WORD[base]).replace(/[\\/b]/g, '')}»)`);
    for (const [lang, tx] of Object.entries(i18n)) {
      const n = tx?.ai?.notice;
      if (!n) errors.push(`/i18n/${lang}/ai/notice: obligatorio con la IA activada`);
      else if (!AI_WORD[lang].test(n)) errors.push(`/i18n/${lang}/ai/notice: el aviso debe decir claramente que es una IA (palabra «${String(AI_WORD[lang]).replace(/[\\/b]/g, '')}»)`);
    }
    if (!cfg.whatsapp?.number) errors.push('/whatsapp/number: obligatorio con la IA activada (derivación a una persona)');
  }

  if (html) {
    const selectors = [cfg.replaceSelector, ...opts.flatMap((o) => [o.action?.target, o.action?.focus]), ...trigs.flatMap((t) => [t.selector, t.bubbleAction?.target])].filter(Boolean);
    for (const s of new Set(selectors)) {
      const m = s.match(/^#([\w-]+)$/);
      if (m && !new RegExp(`id=["']${m[1]}["']`).test(html)) errors.push(`selector ${s}: no existe en la página`);
      else if (!m) warnings.push(`selector ${s}: no se puede comprobar sin navegador (solo se comprueban #id)`);
    }
  }
  return { errors, warnings };
}

/** Valida cualquier forma de la API (pageEnvelope, chatRequest, error…) contra spec/rufi-crm-api.schema.json. */
export function validateApi(value, def) {
  const root = apiSchema();
  if (!root.$defs[def]) throw new Error(`forma desconocida: ${def}`);
  return validateSchema(value, root.$defs[def], '', root);
}

export const MAX_TTL_DAYS = 30;
/** Sobre de página (respuesta de GET /v1/pages/{slug} o respaldo estático en modo API).
 *  `now`: fecha de referencia para la caducidad (Date o ISO). Devuelve { errors, warnings, expired }. */
export function validateEnvelope(env, { now, html } = {}) {
  const errors = validateApi(env, 'pageEnvelope');
  const warnings = [];
  let expired = false;
  if (typeOf(env) !== 'object') return { errors, warnings, expired };
  const iss = Date.parse(env.issuedAt), exp = Date.parse(env.expiresAt);
  if (!Number.isNaN(iss) && !Number.isNaN(exp)) {
    if (exp <= iss) errors.push('/expiresAt: debe ser posterior a issuedAt');
    else if (exp - iss > MAX_TTL_DAYS * 864e5) errors.push(`/expiresAt: como mucho ${MAX_TTL_DAYS} días después de issuedAt`);
    if (now != null && exp <= +new Date(now)) expired = true;
  }
  if (env.status === 'active') {
    if (!env.config) errors.push('/config: obligatorio con status active');
    if (!env.engine) errors.push('/engine: obligatorio con status active');
    if (!env.contract) errors.push('/contract: obligatorio con status active');
  } else if ('config' in env) errors.push(`/config: no se envía con status ${env.status}`);
  if (env.preview && env.status !== 'active') errors.push('/preview: solo con status active');
  if (env.config && typeOf(env.config) === 'object') {
    if (env.config.page !== env.slug) errors.push(`/config/page: debe ser igual a slug («${env.slug}»)`);
    if (env.config.enabled === false) errors.push('/config/enabled: una página apagada se envía con status disabled, no con config');
    const r = validateConfig(env.config, { html, engine: env.engine });
    errors.push(...r.errors.map((e) => `/config${e.startsWith('/') ? '' : ' '}${e}`));
    warnings.push(...r.warnings.filter((w) => !w.startsWith('usa ')));
    const f11 = features11(env.config);
    if (f11.length && env.contract === '1.0') errors.push(`/contract: la configuración usa ${f11.join(', ')} (1.1)`);
  }
  return { errors, warnings, expired };
}

function main() {
  const args = process.argv.slice(2);
  const htmlIdx = args.indexOf('--html');
  const html = htmlIdx >= 0 ? readFileSync(args[htmlIdx + 1], 'utf8') : null;
  const api = args.includes('--api');
  const files = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--html');
  if (!files.length) { console.error('Uso: node tools/validate-config.mjs configs/<nombre>.json [--html pagina.html] [--api]'); return 2; }
  let bad = 0;
  for (const f of files) {
    let cfg; try { cfg = JSON.parse(readFileSync(f, 'utf8')); } catch (e) { console.log(`✗ ${f}: JSON no válido (${e.message})`); bad++; continue; }
    const { errors, warnings, expired } = api ? validateEnvelope(cfg, { html, now: new Date() }) : validateConfig(cfg, { html });
    if (expired) warnings.push('caducado: el cargador no lo usaría (expiresAt ya ha pasado)');
    console.log(`${errors.length ? '✗' : '✓'} ${f}${errors.length ? '' : ' — válida'}`);
    for (const e of errors) console.log(`    ✗ ${e}`);
    for (const w of warnings) console.log(`    ! ${w}`);
    if (errors.length) bad++;
  }
  return bad ? 1 : 0;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) process.exitCode = main();
