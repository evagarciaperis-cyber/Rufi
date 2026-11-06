// Fase D · corrección de tools/validate-config.mjs: las claves se comprueban como propiedades
// PROPIAS. Antes, `k in schema.properties` daba por conocidas claves heredadas de Object.prototype
// («__proto__», «constructor», «toString»…) y `r in value` daba por presentes obligatorias heredadas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateConfig, validateSchema, validateEnvelope, validateStatus, validateApi } from '../tools/validate-config.mjs';

const J = (p) => JSON.parse(readFileSync(p, 'utf8'));
const base = () => J('configs/aval-ico-valencia.json');
const INHERITED = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', 'isPrototypeOf', '__defineGetter__'];

test('claves heredadas de Object.prototype se rechazan como propiedades desconocidas (raíz)', () => {
  for (const k of INHERITED) {
    // JSON.parse crea «__proto__» como propiedad propia (no cambia el prototipo): es lo que llega de un archivo.
    const cfg = JSON.parse(JSON.stringify(base()).replace(/^\{/, `{${JSON.stringify(k)}:{"x":1},`));
    assert.ok(Object.prototype.hasOwnProperty.call(cfg, k), k);
    assert.ok(validateConfig(cfg).errors.some((e) => e === `/${k}: propiedad desconocida`), `${k}: ${validateConfig(cfg).errors.join(' | ')}`);
  }
});

test('claves heredadas en objetos anidados (panel, opción, acción) también se rechazan', () => {
  const c = base();
  const txt = JSON.stringify(c).replace('"panel":{', '"panel":{"constructor":1,').replace('"action":{', '"action":{"__proto__":{"type":"link"},');
  const errs = validateConfig(JSON.parse(txt)).errors;
  assert.ok(errs.includes('/panel/constructor: propiedad desconocida'), errs.join(' | '));
  assert.ok(errs.some((e) => /\/panel\/options\/0\/action\/__proto__: propiedad desconocida/.test(e)), errs.join(' | '));
});

test('obligatorios: una propiedad heredada no cuenta como presente', () => {
  const c = base();
  const { panel, ...rest } = c;
  const obj = Object.assign(Object.create({ panel }), rest); // «panel» solo en el prototipo
  assert.ok('panel' in obj);
  assert.ok(validateSchema(obj).includes('/panel: obligatorio'));
});

test('sobres de la API: claves heredadas rechazadas y obligatorios heredados no valen', () => {
  const env = J('spec/vectors/api/valid/estado-activo.json').value;
  const bad = JSON.parse(JSON.stringify(env).replace(/^\{/, '{"__proto__":{"status":"active"},'));
  assert.ok(validateStatus(bad).errors.includes('/__proto__: propiedad desconocida'));
  const { revision, ...noRev } = env;
  assert.ok(validateApi(Object.assign(Object.create({ revision }), noRev), 'statusFile').includes('/revision: obligatorio'));
  const page = J('spec/vectors/api/valid/pagina-activa.json').value;
  const badPage = JSON.parse(JSON.stringify(page).replace('"config":{', '"config":{"constructor":{},'));
  assert.ok(validateEnvelope(badPage).errors.some((e) => e.includes('/config/constructor: propiedad desconocida')));
});

test('formas de la API inexistentes o heredadas se rechazan', () => {
  assert.throws(() => validateApi({}, 'toString'), /forma desconocida/);
  assert.throws(() => validateApi({}, '__proto__'), /forma desconocida/);
});

test('un idioma fuera de la lista con la IA activada da error, no una excepción', () => {
  const c = J('spec/vectors/config/valid/v11-ia-activada.json');
  c.lang = 'pt';
  let r; assert.doesNotThrow(() => { r = validateConfig(c); });
  assert.ok(r.errors.some((e) => e.startsWith('/lang')), r.errors.join(' | '));
  const d = J('spec/vectors/config/valid/v11-ia-activada.json');
  d.i18n.pt = d.i18n[Object.keys(d.i18n)[0]];
  assert.doesNotThrow(() => validateConfig(d));
  assert.ok(validateConfig(d).errors.some((e) => e.includes('/i18n/pt')));
});

test('las configuraciones del repositorio siguen siendo válidas tras la corrección', () => {
  for (const p of ['configs/aval-ico-valencia.json', 'configs/aval-ico-valencia-test.json', 'configs/ejemplos/plantilla-landing.json', 'configs/ejemplos/joomla-articulo.json']) assert.deepEqual(validateConfig(J(p)).errors, [], p);
});
