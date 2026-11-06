/**
 * Referencia del contrato 1.1 · decisión del cargador en «modo API» (Rufi ↔ CRM).
 * Función pura: recibe lo que el cargador sabe (URL, _global.json local, respuesta de la API,
 * copia del navegador, respaldo estático) y devuelve qué hacer. El cargador de la fase D debe
 * dar exactamente estos resultados: los casos están en spec/vectors/decision.json.
 *
 * Prioridades (de mayor a menor):
 *   1. ?rufi=off                                   → no carga (cualquiera puede probarlo)
 *   2. _global.json LOCAL (Arsys) enabled:false     → no carga y borra la copia (apagado sin depender del CRM)
 *      y disabledPages                             (?rufi=on solo salta estos dos interruptores locales)
 *   3. sin "source" en _global.json                 → comportamiento 1.0 (archivos estáticos), sin cambios
 *   4. vista previa (?rufi-preview=token)           → solo la API; ni copia ni respaldo; si falla, no carga
 *   5. entre la API, la copia del navegador y el respaldo estático, VÁLIDOS y SIN CADUCAR,
 *      gana el de mayor `revision` (contador del sitio, siempre creciente). Un apagado («killed»
 *      o «disabled») también es una revisión: así una respuesta antigua de la caché o un respaldo
 *      viejo nunca «resucitan» a Rufi después de apagarlo. A igual revisión: API > copia > respaldo.
 *   6. La API responde 404 (página no publicada en el CRM) → no carga y borra la copia: es una respuesta firme.
 *   7. ?rufi=on NO salta un apagado remoto (killed/disabled): es una decisión del CRM.
 */
export function decide(input, { isValid }) {
  const { query = {}, localGlobal, slug, now, api, cache, fallback } = input;
  const on = query.rufi === 'on';
  const r = (load, reason, extra = {}) => ({ load, reason, source: null, cache: 'keep', ...extra });
  if (query.rufi === 'off') return r(false, 'off');
  if (localGlobal && localGlobal.enabled === false && !on) return r(false, 'local-kill', { cache: 'clear' });
  if (localGlobal && (localGlobal.disabledPages || []).includes(slug) && !on) return r(false, 'local-disabled', { cache: 'clear' });
  if (!localGlobal || !localGlobal.source) return r(null, 'legacy', { source: 'legacy' });

  const ok = (env) => !!env && env.slug === slug && isValid(env, now);
  const apiEnv = api && api.kind === 'ok' && ok(api.envelope) && !api.envelope.preview ? api.envelope : null;

  if (query.preview) {
    const e = api && api.kind === 'ok' ? api.envelope : null;
    if (e && e.preview === true && e.status === 'active' && ok(e)) return r(true, 'preview', { source: 'preview' });
    return r(false, 'preview-failed');
  }

  if (api && api.kind === 'not-found') return r(false, 'not-found', { cache: 'clear' });
  const cands = [['api', apiEnv], ['cache', ok(cache) && !cache.preview ? cache : null], ['fallback', ok(fallback) && !fallback.preview ? fallback : null]].filter(([, e]) => e);
  if (!cands.length) return r(false, api && api.kind === 'ok' ? 'api-invalid' : api ? 'unavailable' : 'no-config', { cache: cache && !ok(cache) ? 'clear' : 'keep' });
  let [src, best] = cands[0];
  for (const [s, e] of cands) if (e.revision > best.revision) { src = s; best = e; }
  const write = src === 'api' ? 'write' : 'keep';
  if (best.status === 'killed') return r(false, 'killed', { cache: write, revision: best.revision });
  if (best.status === 'disabled') return r(false, 'disabled', { cache: write, revision: best.revision });
  return r(true, src === 'api' ? 'api' : src === 'cache' ? 'cache' : 'fallback', { source: src, cache: write, revision: best.revision });
}
