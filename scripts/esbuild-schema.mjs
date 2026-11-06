/**
 * Plugin de esbuild: incluye los esquemas JSON del contrato en el cargador SIN las descripciones
 * (description, title y $comment de texto). No cambia ninguna regla de validación: solo quita
 * documentación para que el cargador pese menos. tests/loader-decision.test.mjs ejecuta los
 * vectores contra el paquete construido con este mismo plugin para comprobarlo.
 */
import { readFileSync } from 'node:fs';

const DOC_KEYS = new Set(['description', 'title', '$comment']);
export function stripDocs(node) {
  if (Array.isArray(node)) return node.map(stripDocs);
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (DOC_KEYS.has(k) && typeof v === 'string') continue; // «description» como nombre de propiedad (objeto) se conserva
    out[k] = stripDocs(v);
  }
  return out;
}
export const schemaPlugin = {
  name: 'rufi-schema-sin-documentacion',
  setup(b) {
    b.onLoad({ filter: /\.schema\.json$/ }, (args) => ({ contents: JSON.stringify(stripDocs(JSON.parse(readFileSync(args.path, 'utf8')))), loader: 'json' }));
  },
};
