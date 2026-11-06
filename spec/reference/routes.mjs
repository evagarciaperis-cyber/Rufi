/**
 * Referencia del contrato 1.1 · rutas de Joomla con fragmento global.
 * El archivo público es v1/routes/<sha256(ruta normalizada)>.json: con el hash no se pueden listar
 * ni adivinar las páginas con Rufi, y la búsqueda es un único GET estático.
 * Casos en spec/vectors/routes.json.
 */

/** Ruta normalizada: solo la parte del camino, sin dominio, sin ?consulta ni #ancla, sin barra final
 *  (salvo «/»), sin segmentos vacíos, «.» ni «..». null si no es una ruta aceptable. */
export function normalizePath(input) {
  if (typeof input !== 'string' || input.length === 0 || input.length > 512) return null;
  let p = input.split('#')[0].split('?')[0];
  if (!p.startsWith('/') || p.startsWith('//')) return null;
  let dec;
  try { dec = decodeURIComponent(p); } catch (e) { return null; }
  if (/[\u0000-\u001f\\]/.test(dec)) return null;
  const segs = dec.split('/').filter((s) => s !== '');
  if (segs.some((s) => s === '.' || s === '..')) return null;
  return '/' + segs.join('/');
}

/** Nombre del archivo de una ruta, con la función de hash del entorno (Node: crypto; navegador: crypto.subtle). */
export async function routeObjectName(path, sha256hex) {
  const n = normalizePath(path);
  return n == null ? null : `${await sha256hex(n)}.json`;
}
