#!/usr/bin/env node
/**
 * Valida configuraciones de Rufi contra spec/rufi-config.schema.json (sin dependencias:
 * implementa el subconjunto de JSON Schema que usa ese archivo) y añade comprobaciones de
 * sentido común (selectores, ids repetidos, WhatsApp, longitud de textos).
 *
 * Uso: node tools/validate-config.mjs configs/aval-ico-valencia.json [más archivos…]
 *      [--html pagina.html]   comprueba además que los selectores existen en esa página
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = JSON.parse(readFileSync(path.join(here, '..', 'spec', 'rufi-config.schema.json'), 'utf8'));

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
function resolve(ref) { return ref.replace(/^#\//, '').split('/').reduce((o, k) => o[k], SCHEMA); }

/** Validación JSON Schema (subconjunto: type, enum, required, properties, additionalProperties, items, min/max, pattern, $ref). */
export function validateSchema(value, schema = SCHEMA, at = '') {
  const errors = [];
  if (schema.$ref) return validateSchema(value, resolve(schema.$ref), at);
  const t = typeOf(value);
  if (schema.type) { const types = [].concat(schema.type); if (!types.includes(t) && !(t === 'integer' && types.includes('number'))) { errors.push(`${at || '/'}: debe ser ${types.join(' o ')} (es ${t})`); return errors; } }
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${at}: valor no permitido «${value}» (permitidos: ${schema.enum.join(', ')})`);
  if (t === 'string') {
    if (schema.minLength != null && value.length < schema.minLength) errors.push(`${at}: texto vacío o demasiado corto`);
    if (schema.maxLength != null && value.length > schema.maxLength) errors.push(`${at}: texto demasiado largo (${value.length} > ${schema.maxLength})`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${at}: formato no válido «${value}»`);
  }
  if (t === 'number' || t === 'integer') {
    if (schema.minimum != null && value < schema.minimum) errors.push(`${at}: mínimo ${schema.minimum}`);
    if (schema.maximum != null && value > schema.maximum) errors.push(`${at}: máximo ${schema.maximum}`);
  }
  if (t === 'array') {
    if (schema.minItems != null && value.length < schema.minItems) errors.push(`${at}: al menos ${schema.minItems} elementos`);
    if (schema.maxItems != null && value.length > schema.maxItems) errors.push(`${at}: como mucho ${schema.maxItems} elementos`);
    if (schema.items) value.forEach((v, i) => errors.push(...validateSchema(v, schema.items, `${at}/${i}`)));
  }
  if (t === 'object') {
    for (const r of schema.required || []) if (!(r in value)) errors.push(`${at}/${r}: obligatorio`);
    for (const [k, v] of Object.entries(value)) {
      if (schema.properties && k in schema.properties) errors.push(...validateSchema(v, schema.properties[k], `${at}/${k}`));
      else if (schema.additionalProperties === false) errors.push(`${at}/${k}: propiedad desconocida`);
    }
  }
  return errors;
}

/** Comprobaciones de sentido común. `html` opcional: texto de la página para comprobar selectores. */
export function validateConfig(cfg, { html } = {}) {
  const errors = validateSchema(cfg);
  const warnings = [];
  const ids = (cfg.panel?.options || []).map((o) => o.id);
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i); if (dup.length) errors.push(`/panel/options: ids repetidos ${dup.join(', ')}`);
  const tids = (cfg.triggers || []).map((t) => t.id);
  const tdup = tids.filter((x, i) => tids.indexOf(x) !== i); if (tdup.length) errors.push(`/triggers: ids repetidos ${tdup.join(', ')}`);
  const usesWA = (cfg.panel?.options || []).some((o) => o.action?.type === 'whatsapp' && !o.action.number) || (cfg.triggers || []).some((t) => t.bubbleAction?.type === 'whatsapp' && !t.bubbleAction.number);
  if (usesWA && !cfg.whatsapp?.number) errors.push('/whatsapp/number: obligatorio si alguna acción es de WhatsApp sin número propio');
  for (const o of cfg.panel?.options || []) if (o.action?.type === 'scroll' && !o.action.target) errors.push(`/panel/options/${o.id}: una acción scroll necesita target`);
  for (const t of cfg.triggers || []) if (t.on === 'complete' && !t.match) errors.push(`/triggers/${t.id}: on=complete necesita match`);
  if (cfg.automation?.appendRef) {
    const missing = (cfg.panel?.options || []).filter((o) => o.action?.type === 'whatsapp' && !o.ref && !o.action.ref).map((o) => o.id);
    if (missing.length) warnings.push(`automation.appendRef activo pero sin ref en: ${missing.join(', ')}`);
  }
  if (cfg.enabled === false) warnings.push('enabled: false → Rufi no se cargará en esta página');
  if (html) {
    const selectors = [cfg.replaceSelector, ...(cfg.panel?.options || []).flatMap((o) => [o.action?.target, o.action?.focus]), ...(cfg.triggers || []).flatMap((t) => [t.selector, t.bubbleAction?.target])].filter(Boolean);
    for (const s of new Set(selectors)) {
      const m = s.match(/^#([\w-]+)$/);
      if (m && !new RegExp(`id=["']${m[1]}["']`).test(html)) errors.push(`selector ${s}: no existe en la página`);
      else if (!m) warnings.push(`selector ${s}: no se puede comprobar sin navegador (solo se comprueban #id)`);
    }
  }
  return { errors, warnings };
}

function main() {
  const args = process.argv.slice(2);
  const htmlIdx = args.indexOf('--html');
  const html = htmlIdx >= 0 ? readFileSync(args[htmlIdx + 1], 'utf8') : null;
  const files = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--html');
  if (!files.length) { console.error('Uso: node tools/validate-config.mjs configs/<nombre>.json [--html pagina.html]'); return 2; }
  let bad = 0;
  for (const f of files) {
    let cfg; try { cfg = JSON.parse(readFileSync(f, 'utf8')); } catch (e) { console.log(`✗ ${f}: JSON no válido (${e.message})`); bad++; continue; }
    const { errors, warnings } = validateConfig(cfg, { html });
    console.log(`${errors.length ? '✗' : '✓'} ${f}${errors.length ? '' : ' — válida'}`);
    for (const e of errors) console.log(`    ✗ ${e}`);
    for (const w of warnings) console.log(`    ! ${w}`);
    if (errors.length) bad++;
  }
  return bad ? 1 : 0;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) process.exitCode = main();
