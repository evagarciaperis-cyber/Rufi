/**
 * Rufi · cargador 1.1 — parte PURA (sin DOM ni red). La usa src/loader.js y se prueba en Node con
 * los vectores compartidos del contrato (tests/loader-decision.test.mjs).
 *
 * Nada de lógica propia de decisión: decide() y decideLive() son las de spec/reference/decide.mjs,
 * importadas tal cual, y la validación de los archivos públicos es la de tools/contract-core.mjs
 * (la misma que usa tools/validate-config.mjs) con los esquemas del contrato incluidos en el
 * paquete. Aquí solo se traduce lo que ve el navegador (respuestas HTTP, copias de localStorage)
 * a las entradas que esperan esas funciones.
 */
import { decide, decideLive } from '../spec/reference/decide.mjs';
import { normalizePath } from '../spec/reference/routes.mjs';
import { makeValidators, decisionFns, hasOwn } from '../tools/contract-core.mjs';
import configSchema from '../spec/rufi-config.schema.json' with { type: 'json' };
import apiSchema from '../spec/rufi-crm-api.schema.json' with { type: 'json' };

export const validators = makeValidators({ configSchema, apiSchema });
export const fns = decisionFns(validators);
export { decide, decideLive, normalizePath };

/** Tamaño máximo de un archivo público (el mismo límite que publish.mjs › MAX_OBJECT_BYTES). */
export const MAX_BYTES = 64 * 1024;
export const SLUG_RE = /^[a-z0-9-]{1,64}$/;
/** Token de vista previa del CRM: v1.<claims b64url>.<HMAC-SHA256 b64url> (43 caracteres). */
export const PREVIEW_TOKEN_RE = /^v1\.[A-Za-z0-9_-]{16,600}\.[A-Za-z0-9_-]{43}$/;
const SRC = apiSchema.$defs.localGlobal.properties.source.properties;
const DEFAULT_TIMEOUT = 2500, DEFAULT_RECHECK = 300;

/**
 * Modo de funcionamiento según _global.json:
 *   legacy  → sin source.static: comportamiento 1.0 exactamente igual que el cargador 1.0.0
 *   storage → source válido según el contrato (localGlobal)
 *   invalid → hay «source» pero no cumple el contrato: Rufi no se carga (falla cerrado; nunca se
 *             vuelve al modo 1.0 por un error de escritura en _global.json)
 */
export function sourceOf(global) {
  // Igual que decide(): sin source o sin source.static → 1.0.
  if (!global || typeof global !== 'object' || !global.source || !global.source.static) return { mode: 'legacy' };
  const s = global.source;
  const errors = validators.validateApi(global, 'localGlobal');
  if (errors.length) return { mode: 'invalid', errors };
  return { mode: 'storage', static: s.static, api: s.api || null, timeoutMs: s.timeoutMs || DEFAULT_TIMEOUT, recheckSeconds: s.recheckSeconds || DEFAULT_RECHECK };
}
export const STATIC_PATTERN = SRC.static.pattern;

/**
 * Respuesta HTTP → resultado para decide():
 *   200 → { kind: 'ok', envelope } (envelope = null si no es JSON o pasa de 64 KB: decide lo trata como inválido)
 *   404 → { kind: 'not-found' }   · otro código → { kind: 'error', status }
 * Los cortes de red y las esperas agotadas los marca el cargador como { kind: 'timeout' } / { kind: 'error' }.
 */
export function toResult(status, text) {
  if (status === 404) return { kind: 'not-found' };
  // Supabase Storage puede responder 400 con {"statusCode":"404","error":"not_found"} a un objeto
  // que no existe (según versión; POR VERIFICAR en la fase B con la cubeta de pruebas).
  if (status === 400 && typeof text === 'string' && text.length < 2048) { try { const e = JSON.parse(text); if (e && (String(e.statusCode) === '404' || e.error === 'not_found')) return { kind: 'not-found' }; } catch (e) { /* */ } }
  if (status !== 200) return { kind: 'error', status };
  let envelope = null;
  if (typeof text === 'string' && text.length <= MAX_BYTES) { try { envelope = JSON.parse(text); } catch (e) { envelope = null; } }
  return { kind: 'ok', envelope };
}

/** Lee una copia de localStorage (texto) como objeto, o null. decide() la valida igualmente. */
export function parseCached(text) {
  if (typeof text !== 'string' || text.length > MAX_BYTES) return null;
  try { const v = JSON.parse(text); return v && typeof v === 'object' ? v : null; } catch (e) { return null; }
}

export const run = (input) => decide(input, fns);
export const runLive = (input, current) => decideLive(input, current, fns);
/** Razones que se deciden sin red (interruptores locales): el cargador no pide nada a Storage. */
export const LOCAL_REASONS = ['off', 'local-kill', 'local-disabled', 'legacy'];

/** Sobre que hay que usar según la decisión. */
export function chosenEnvelope(d, input) {
  if (!d.load) return null;
  if (d.source === 'preview') return input.remote.preview.envelope;
  if (d.source === 'remote') return input.remote.page.envelope;
  if (d.source === 'cache') return input.cache.page;
  return null;
}

/**
 * Configuración EN LA PÁGINA (window.RufiConfig sin data-rufi-config) con source.static: no hay
 * archivo de página en el CRM, pero el apagado del sitio debe valer igual. Se usa decide() tal cual
 * con una página sintética siempre activa, de modo que solo cuentan los interruptores locales y el
 * ESTADO GLOBAL (killed o desconocido → no carga). Ampliación documentada en docs/16 §2.4.
 */
const INLINE = { slug: '__inline__', status: 'active', revision: 0 };
export function decideInline(input) {
  const vPage = (e) => e === INLINE;
  return decide({ ...input, slug: INLINE.slug, query: { ...(input.query || {}), preview: null }, remote: { status: input.remote.status, page: { kind: 'ok', envelope: INLINE } }, cache: { status: input.cache.status, page: null } }, { validPage: vPage, validStatus: fns.validStatus });
}

/** Ruta de Joomla → slug: archivo v1/routes/<sha256>.json válido y sin caducar, o null. */
export function slugFromRoute(result, now) {
  if (!result || result.kind !== 'ok' || !fns.validRoute(result.envelope, now)) return null;
  return SLUG_RE.test(result.envelope.slug) ? result.envelope.slug : null;
}

/** Versión del motor que hay que cargar (solo caracteres seguros para la URL). */
export const cleanVersion = (v) => String(v || '').replace(/[^0-9a-z.\-]/gi, '');
