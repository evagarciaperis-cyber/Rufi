#!/usr/bin/env node
/**
 * Mide de verdad cuánto tarda un cambio publicado en verse a través de la CDN (no se promete
 * ningún tiempo sin medirlo). Pide la URL repetidamente, como el cargador (sin caché HTTP del
 * cliente: cada petición revalida), y anota cuándo aparece una `revision` ≥ la esperada.
 *
 * Uso (fase B, contra la cubeta de PRUEBAS, nunca producción sin autorización):
 *   node tools/measure-propagation.mjs <url> --revision <n> [--since <ISO del momento de publicar>]
 *        [--every 2000] [--timeout 600000] [--json]
 * Ejemplo: publicar en el CRM un apagado con revision 128 a las 10:00:00Z y, a la vez:
 *   node tools/measure-propagation.mjs https://<p>.supabase.co/storage/v1/object/public/rufi-public/v1/status.json --revision 128 --since 2026-11-06T10:00:00Z
 * Repetir desde varias redes (otra conexión, móvil con datos): cada punto de la CDN tiene su caché.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export async function measure({ url, revision, since = Date.now(), every = 2000, timeout = 600000, fetchImpl = fetch, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const t0 = typeof since === 'number' ? since : Date.parse(since);
  const samples = [];
  const end = now() + timeout;
  while (now() < end) {
    const at = now();
    let rev = null, status = 0, cdn = null, age = null, err = null;
    try {
      const r = await fetchImpl(`${url}`, { cache: 'no-store', headers: { 'cache-control': 'no-cache' } });
      status = r.status; cdn = r.headers.get('cf-cache-status'); age = r.headers.get('age');
      if (r.ok) rev = (await r.json()).revision;
    } catch (e) { err = String(e.message || e).slice(0, 80); }
    samples.push({ at, rev, status, cdn, age, err });
    if (rev != null && rev >= revision) return { ok: true, seconds: (at - t0) / 1000, attempts: samples.length, samples };
    await sleep(every);
  }
  return { ok: false, seconds: null, attempts: samples.length, samples };
}

async function main() {
  const a = process.argv.slice(2); const opt = (k, d) => (a.includes(k) ? a[a.indexOf(k) + 1] : d);
  const url = a.find((x) => /^https?:\/\//.test(x));
  if (!url || !a.includes('--revision')) { console.error('Uso: node tools/measure-propagation.mjs <url> --revision <n> [--since ISO] [--every ms] [--timeout ms] [--json]'); return 2; }
  const r = await measure({ url, revision: Number(opt('--revision')), since: opt('--since', Date.now()), every: Number(opt('--every', 2000)), timeout: Number(opt('--timeout', 600000)) });
  if (a.includes('--json')) console.log(JSON.stringify(r, null, 2));
  else {
    const hits = r.samples.map((s) => s.cdn).filter(Boolean);
    console.log(r.ok ? `✓ revisión visible a los ${r.seconds.toFixed(1)} s (${r.attempts} peticiones)` : `✗ no se vio la revisión en el tiempo máximo (${r.attempts} peticiones)`);
    if (hits.length) console.log(`  caché CDN: ${[...new Set(hits)].join(', ')}`);
  }
  return r.ok ? 0 : 1;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main().then((c) => { process.exitCode = c; });
