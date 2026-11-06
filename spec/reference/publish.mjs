/**
 * Referencia del contrato 1.1 · publicación del CRM en la cubeta pública (Supabase Storage).
 * El CRM (fase B) debe seguir exactamente este orden de escritura y este control de qué se sube.
 *
 * Supabase Storage no tiene escrituras condicionales ni transacciones entre archivos: cada archivo
 * se escribe entero (atómico por archivo), pero una operación de varios archivos puede quedarse a
 * medias. Por eso:
 *   - Cada archivo es autosuficiente (lleva su revision y su caducidad) y el cargador elige por revision.
 *   - Apagar el sitio y volver a encenderlo es UNA escritura (status.json): no hay estados intermedios.
 *   - En operaciones de varios archivos, el orden hace que cualquier corte deje un estado SEGURO:
 *     o lo anterior, o lo nuevo, o Rufi sin mostrarse; nunca contenido que debía estar apagado.
 *       · publicar: primero rutas nuevas (apuntan a una página aún no publicada → 404 → no se ve),
 *         después la página, por último se borran las rutas viejas.
 *       · apagar una página: primero la página (disabled), después se borran sus rutas.
 *   - El CRM serializa las publicaciones (una a la vez por sitio) y guarda un DIARIO de pasos:
 *     la operación queda «incompleta» hasta confirmar todos; se reintenta y se avisa en el panel.
 *     Un apagado incompleto se avisa como URGENTE con las vías alternativas (panel de Supabase, Arsys).
 *   - La revision la da un contador del sitio en la base de datos: nunca se repite ni baja.
 */
const PATH = /^v1\/(status\.json|pages\/[a-z0-9-]{1,64}\.json|routes\/[0-9a-f]{64}\.json)$/;
export const MAX_OBJECT_BYTES = 64 * 1024;
export const pagePath = (slug) => `v1/pages/${slug}.json`;
export const routePath = (hash) => `v1/routes/${hash}.json`;
export const STATUS_PATH = 'v1/status.json';

/**
 * Control previo a CADA subida: solo rutas permitidas, solo JSON del contrato, tamaño máximo.
 * Es la barrera que impide que borradores, copias, ajustes de IA o datos del CRM lleguen a la
 * cubeta pública. `validators`: { page, status, route } → { errors, expired }.
 */
export function guardPublicObject(path, body, validators, { now } = {}) {
  const errors = [];
  if (typeof path !== 'string' || !PATH.test(path)) return { ok: false, errors: [`ruta no permitida en la cubeta pública: «${String(path).slice(0, 80)}»`] };
  let text, obj;
  try { text = typeof body === 'string' ? body : JSON.stringify(body); obj = JSON.parse(text); } catch (e) { return { ok: false, errors: ['no es JSON'] }; }
  if (Buffer.byteLength(text, 'utf8') > MAX_OBJECT_BYTES) errors.push(`demasiado grande (> ${MAX_OBJECT_BYTES} bytes)`);
  const kind = path === STATUS_PATH ? 'status' : path.startsWith('v1/pages/') ? 'page' : 'route';
  const r = validators[kind](obj, { now });
  errors.push(...r.errors);
  if (r.expired) errors.push('ya caducado');
  if (kind === 'page' && obj.slug !== path.slice(9, -5)) errors.push('slug distinto del nombre del archivo');
  if (kind === 'page' && obj.preview) errors.push('una vista previa nunca se publica');
  return { ok: errors.length === 0, kind, errors };
}

/** Pasos ordenados de una operación. Cada paso: { op: 'put'|'delete', path, body? }. */
export function planPublish(op) {
  switch (op.type) {
    case 'kill-site':
    case 'revive-site':
      return [{ op: 'put', path: STATUS_PATH, body: op.status }];
    case 'publish-page':
      return [
        ...(op.routesAdd || []).map((r) => ({ op: 'put', path: routePath(r.hash), body: r.body })),
        { op: 'put', path: pagePath(op.envelope.slug), body: op.envelope },
        ...(op.routesRemove || []).map((h) => ({ op: 'delete', path: routePath(h) })),
      ];
    case 'disable-page':
      return [
        { op: 'put', path: pagePath(op.envelope.slug), body: op.envelope },
        ...(op.routesRemove || []).map((h) => ({ op: 'delete', path: routePath(h) })),
      ];
    case 'refresh':
      // Renovación diaria de caducidad: primero el estado (si está apagado, sigue apagado), luego páginas y rutas.
      return [{ op: 'put', path: STATUS_PATH, body: op.status }, ...op.pages.map((e) => ({ op: 'put', path: pagePath(e.slug), body: e })), ...(op.routes || []).map((r) => ({ op: 'put', path: routePath(r.hash), body: r.body }))];
    default:
      throw new Error(`operación desconocida: ${op.type}`);
  }
}

/**
 * Ejecuta un plan contra un almacén (Map path → body) pasando el control a cada subida.
 * `failAt`: índice del paso que «falla» (simulación de corte). Devuelve el diario.
 */
export function applyPlan(store, steps, validators, { failAt = -1, now } = {}) {
  const journal = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (i === failAt) { journal.push({ ...s, done: false, error: 'fallo de red simulado' }); return { complete: false, journal, pending: steps.slice(i) }; }
    if (s.op === 'put') {
      const g = guardPublicObject(s.path, s.body, validators, { now });
      if (!g.ok) { journal.push({ ...s, done: false, error: g.errors.join('; ') }); return { complete: false, journal, pending: steps.slice(i), rejected: true }; }
      store.set(s.path, JSON.parse(JSON.stringify(s.body)));
    } else store.delete(s.path);
    journal.push({ op: s.op, path: s.path, done: true });
  }
  return { complete: true, journal, pending: [] };
}
