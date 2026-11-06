#!/usr/bin/env node
/**
 * Valida configuraciones de Rufi (contrato 1.1, compatible con 1.0) y los sobres de la API
 * Rufi ↔ CRM, sin dependencias: implementa el subconjunto de JSON Schema que usan
 * spec/rufi-config.schema.json y spec/rufi-crm-api.schema.json, y añade comprobaciones de
 * sentido común (ids, WhatsApp, traducciones, aviso de IA, caducidad…).
 *
 * Uso: node tools/validate-config.mjs configs/aval-ico-valencia.json [más archivos…]
 *      [--html pagina.html]   comprueba además que los selectores existen en esa página
 *      [--api]                los archivos son archivos públicos de Storage (status.json, pages/*.json, routes/*.json)
 *
 * Fase D: la lógica está en tools/contract-core.mjs (compartida con el cargador del navegador).
 * Corregido: las claves se comprueban como propiedades PROPIAS (Object.prototype.hasOwnProperty),
 * así «__proto__» o «constructor» ya no pasan como propiedades conocidas ni como obligatorias.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { makeValidators, CONTRACT_VERSION, LANGS, AI_WORD, MAX_TTL_DAYS, semverCmp, features11, hasOwn } from './contract-core.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = JSON.parse(readFileSync(path.join(here, '..', 'spec', 'rufi-config.schema.json'), 'utf8'));
let API_SCHEMA = null;
const apiSchema = () => {
  if (API_SCHEMA) return API_SCHEMA;
  const p = [path.join(here, '..', 'spec', 'rufi-crm-api.schema.json'), path.join(here, 'rufi-crm-api.schema.json')].find(existsSync);
  if (!p) throw new Error('falta spec/rufi-crm-api.schema.json');
  return (API_SCHEMA = JSON.parse(readFileSync(p, 'utf8')));
};

// La lógica de validación vive en tools/contract-core.mjs (sin node:fs) para que el cargador del
// navegador use exactamente el mismo código. Este archivo solo lee los esquemas y añade la CLI.
export { CONTRACT_VERSION, LANGS, AI_WORD, MAX_TTL_DAYS, semverCmp, features11, hasOwn };
export const { validateSchema, validateConfig, validateApi, validateEnvelope, validateStatus, validateRoute } = makeValidators({ configSchema: SCHEMA, apiSchema });

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
    const kind = !api ? 'config' : cfg && cfg.scope === 'site' ? 'status' : hasOwn(cfg, 'status') ? 'page' : 'route';
    const now = new Date();
    const { errors, warnings, expired } = kind === 'config' ? validateConfig(cfg, { html }) : kind === 'status' ? validateStatus(cfg, { now }) : kind === 'page' ? validateEnvelope(cfg, { html, now }) : validateRoute(cfg, { now });
    if (expired) warnings.push('caducado: el cargador no lo usaría (expiresAt ya ha pasado)');
    console.log(`${errors.length ? '✗' : '✓'} ${f}${errors.length ? '' : ' — válida'}`);
    for (const e of errors) console.log(`    ✗ ${e}`);
    for (const w of warnings) console.log(`    ! ${w}`);
    if (errors.length) bad++;
  }
  return bad ? 1 : 0;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) process.exitCode = main();
