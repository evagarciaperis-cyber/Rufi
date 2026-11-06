/**
 * Referencia del contrato 1.1 · decisión del cargador en «modo Storage» (Rufi ↔ CRM, opción A).
 * Funciones puras: reciben lo que el cargador sabe y devuelven qué hacer. El cargador/motor 1.1.0
 * (fase D) debe dar exactamente estos resultados: casos en spec/vectors/decision.json y live.json.
 *
 * Fuentes (todas opcionales; validez = esquema + slug correcto + sin caducar):
 *   remote.status  v1/status.json      (Supabase Storage, público)   estado GLOBAL del sitio
 *   remote.page    v1/pages/<slug>.json                               sobre de la página
 *   remote.preview GET /api/public/rufi/v1/pages/<slug>?preview=…    (Vercel; solo vista previa)
 *   cache.status / cache.page          copia del navegador (localStorage), incluidas marcas de apagado
 *
 * Prioridades (de mayor a menor):
 *   1. ?rufi=off                                   → no carga
 *   2. _global.json LOCAL (Arsys) enabled:false     → no carga y borra copias   (?rufi=on salta solo 2 y 3)
 *   3. disabledPages local                          → no carga y borra la copia de la página
 *   4. sin source.static en _global.json            → comportamiento 1.0 sin cambios («legacy»)
 *   5. vista previa                                 → solo la API dinámica; ni copias ni Storage; si falla, no carga
 *   6. ESTADO GLOBAL: entre remote.status y cache.status válidos gana la revision más alta
 *      (a igual revisión, el remoto). killed → no carga. Si no hay NINGÚN estado válido → no carga
 *      («status-unknown»): sin saber si el sitio está apagado, se falla cerrado.
 *   7. PÁGINA: 404 de Storage con el estado remoto obtenido → no carga y borra la copia.
 *      Entre remote.page y cache.page válidos gana la revision más alta. disabled/killed → no carga.
 *   8. ?rufi=on NO salta un apagado del CRM (killed / disabled).
 */
const isOk = (res) => !!res && res.kind === 'ok';

function pick(remoteEnv, cacheEnv, valid) {
  const c = [['remote', valid(remoteEnv) ? remoteEnv : null], ['cache', valid(cacheEnv) ? cacheEnv : null]].filter(([, e]) => e);
  if (!c.length) return null;
  let [src, env] = c[0];
  for (const [s, e] of c) if (e.revision > env.revision) { src = s; env = e; }
  return { src, env };
}

export function decide(input, { validPage, validStatus }) {
  const { query = {}, localGlobal, slug, now, remote = {}, cache = {} } = input;
  const on = query.rufi === 'on';
  const r = (load, reason, extra = {}) => ({ load, reason, source: null, cache: { status: 'keep', page: 'keep' }, ...extra });
  if (query.rufi === 'off') return r(false, 'off');
  if (localGlobal && localGlobal.enabled === false && !on) return r(false, 'local-kill', { cache: { status: 'clear', page: 'clear' } });
  if (localGlobal && (localGlobal.disabledPages || []).includes(slug) && !on) return r(false, 'local-disabled', { cache: { status: 'keep', page: 'clear' } });
  if (!localGlobal || !localGlobal.source || !localGlobal.source.static) return r(null, 'legacy', { source: 'legacy' });

  const vPage = (e) => !!e && e.slug === slug && !e.preview && validPage(e, now);
  const vStatus = (e) => !!e && validStatus(e, now);

  if (query.preview) {
    const e = isOk(remote.preview) ? remote.preview.envelope : null;
    if (e && e.preview === true && e.status === 'active' && e.slug === slug && validPage(e, now)) return r(true, 'preview', { source: 'preview' });
    return r(false, 'preview-failed');
  }

  // 6. Estado global
  const st = pick(isOk(remote.status) ? remote.status.envelope : null, cache.status, vStatus);
  const stCache = st && st.src === 'remote' ? 'write' : cache.status && !vStatus(cache.status) ? 'clear' : 'keep';
  if (!st) return r(false, 'status-unknown', { cache: { status: stCache, page: 'keep' } });
  if (st.env.status === 'killed') return r(false, 'killed', { cache: { status: stCache, page: 'keep' }, revision: st.env.revision });

  // 7. Página
  const statusFromRemote = isOk(remote.status);
  if (remote.page && remote.page.kind === 'not-found' && statusFromRemote) return r(false, 'not-found', { cache: { status: stCache, page: 'clear' } });
  const pg = pick(isOk(remote.page) ? remote.page.envelope : null, cache.page, vPage);
  const pgCache = pg && pg.src === 'remote' ? 'write' : cache.page && !vPage(cache.page) ? 'clear' : 'keep';
  if (!pg) return r(false, isOk(remote.page) ? 'page-invalid' : 'unavailable', { cache: { status: stCache, page: pgCache } });
  if (pg.env.status !== 'active') return r(false, pg.env.status, { cache: { status: stCache, page: pgCache }, revision: pg.env.revision });
  return r(true, pg.src === 'remote' ? 'remote' : 'cache', { source: pg.src, cache: { status: stCache, page: pgCache }, revision: pg.env.revision, statusRevision: st.env.revision });
}

/**
 * Página que sigue abierta (motor ≥ 1.1.0): cada `recheckSeconds` con la pestaña visible, al volver
 * a ella y al recuperar la conexión, el cargador vuelve a pedir status.json y su página y llama a
 * esta función. `current` = { pageRevision } de lo que está mostrando.
 *   hide    → Rufi sale y no vuelve hasta recargar (apagado, página apagada, retirada, interruptor local)
 *   refresh → hay una configuración más reciente (se aplica al recargar o al cerrar el panel)
 *   keep    → sin cambios, o no se ha podido saber (un corte de red no oculta a Rufi)
 */
export function decideLive(input, current, fns) {
  const d = decide({ ...input, query: { ...(input.query || {}), preview: null } }, fns);
  if (d.load === false && ['off', 'local-kill', 'local-disabled', 'killed', 'disabled', 'not-found'].includes(d.reason)) return { action: 'hide', reason: d.reason };
  if (d.load === true && d.revision > current.pageRevision) return { action: 'refresh', reason: 'newer', revision: d.revision };
  return { action: 'keep', reason: d.reason };
}
