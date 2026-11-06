# 16 · Fase D — cargador 1.1 (Supabase Storage), motor 1.1.0 con idiomas y carpeta `v/1.1.0`

Fecha: 6-nov-2026. Rama: `fase-9d-loader-1.1`, creada desde `fase-8a-contrato-1.1` (PR #4).
**Sin PR, sin fusionar, sin tocar `main`.**

Qué **no** se ha hecho:
- no se ha subido nada a Arsys ni a Supabase;
- no se ha tocado Joomla, ninguna landing ni el CRM;
- no hay ninguna llamada a Supabase real: las pruebas usan servidores HTTP locales;
- la ruta pública de vista previa **no existe** y no se ha creado.

> Nota sobre el número: ya existe `docs/16-rufi-admin-ia-diseno.md`. Este archivo usa el nombre
> pedido para la fase D; los dos conviven.

## 1. Resumen

| Entrega | Estado | Grado |
|---|---|---|
| Cargador 1.1 con `source.static` (Supabase Storage) y `decide`/`decideLive` de `spec/reference` **sin copiar ni reescribir** (se importan tal cual) | Hecho | **Verificado** (vectores en Node y Chromium) |
| Compatibilidad total con 1.0.0 (`_global.json` sin `source`, `data-rufi-config`, `_routes.json`, configuración en la página) | Hecho | **Verificado** (53/53 del cargador, 94/94 del componente, 24/24 de compatibilidad) |
| Motor 1.1.0 con cinco idiomas (`pickLang`/`resolveTexts` de `spec/reference/i18n.mjs`, tal cual) | Hecho | **Verificado** (es/en/fr/it/de en Chromium) |
| Carpeta `dist/v/1.1.0/` con `rufi-3d.js`, GLB y póster idénticos byte a byte a los de 1.0.0; `dist/v/1.0.0/` sin cambios | Hecho | **Verificado** (SHA-256, §4) |
| Pruebas unitarias con los vectores compartidos, contra el código del cargador y contra su paquete | Hecho | **Verificado** |
| Pruebas e2e con Storage falso local | Hecho | **Verificado** |
| Diseño de la vista previa real + demostración local | Hecho | `docs/20-vista-previa-real.md` |
| Corrección de `tools/validate-config.mjs` (claves heredadas) | Hecho | **Verificado** (y prueba de mutación) |

## 2. Cargador 1.1 (`src/loader.js` + `src/loader-core.js`)

### 2.1 De dónde sale cada decisión

| Pieza | Origen | Cómo se garantiza la paridad |
|---|---|---|
| `decide()`, `decideLive()` | `spec/reference/decide.mjs`, **importado** por `src/loader-core.js` y empaquetado por esbuild en `dist/rufi.js` | Es el mismo archivo. Además, `tests/loader-decision.test.mjs` pasa los 30 casos de `decision.json`, los 8 de `live.json` y las 625 combinaciones de apagado **dos veces**: contra `src/loader-core.js` y contra el mismo módulo empaquetado y minificado como en producción |
| Validación de `status.json`, sobres de página y rutas (`validPage`, `validStatus`) | `tools/contract-core.mjs` (nuevo): el núcleo puro que **también** usa `tools/validate-config.mjs`. Antes solo existía dentro del validador, que lee los esquemas con `node:fs` y no funciona en el navegador | Una sola implementación para el validador, el CRM (por los vectores) y el cargador |
| Esquemas | `spec/rufi-config.schema.json` y `spec/rufi-crm-api.schema.json` incluidos en el paquete **sin descripciones** (`scripts/esbuild-schema.mjs`: solo se quitan `description`, `title` y `$comment` de texto) | Los vectores pasan también contra el paquete construido con ese plugin |
| Normalización de rutas de Joomla | `spec/reference/routes.mjs › normalizePath`, importada | 15 casos de `routes.json` |
| Patrón de `source.static` y `source.api` | `localGlobal` de `spec/rufi-crm-api.schema.json` | `sourceOf()` valida con `validateApi(global, 'localGlobal')`. Probado con los casos `source-*` |

### 2.2 Modos según `configs/_global.json` (Arsys)

| `_global.json` | Modo | Comportamiento |
|---|---|---|
| Sin `source` o sin `source.static` (el de hoy) | **1.0** | Exactamente el del cargador 1.0.0: el mismo código, movido a `legacy()`. `configs/<nombre>.json` de Arsys, `?v=configVersion`, `_routes.json`, `disabledPages`, `enabled:false`, `?rufi=on/off/debug` |
| `source.static` válido según el contrato | **Storage** | Ver §2.3 |
| `source` presente pero no válido (p. ej. `http://`, otra cubeta, `recheckSeconds` < 60, campo de más) | **Falla cerrado** | Rufi no se carga y no se pide nada a Storage. Nunca vuelve en silencio al modo 1.0 por un error de escritura. Es más estricto que la referencia, que trataría la URL como buena y fallaría al leerla |

### 2.3 Modo Storage: orden

1. `?rufi=off` → no carga y no pide nada.
2. `_global.json` `enabled:false` → no carga y **borra todas las copias** `rufi:v1:*` de
   `localStorage`. Es `local-kill` de `decide()`; `?rufi=on` lo salta.
3. Página:
   - con `data-rufi-config="<slug>"`, el *slug* es ese nombre;
   - con el fragmento global de Joomla, se usa `v1/routes/<sha256(ruta normalizada)>.json`, que
     debe ser válido y no estar caducado. Si no hay, se mira el `_routes.json` local, y la
     página sigue pasando por el estado y su sobre de Storage, así que un apagado del CRM vale
     igual.
4. Los interruptores locales (`disabledPages`) se evalúan con `decide()` **antes** de pedir nada
   a Storage.
5. Se piden **a la vez** `v1/status.json` y `v1/pages/<slug>.json`. Cada petición:
   - tiene un límite de `timeoutMs` (2,5 s por defecto);
   - va con `credentials: 'omit'`, `cache: 'no-cache'`, `redirect: 'error'` y como mucho
     64 KB.
6. `decide()` con la copia de `localStorage`.
   - Se aplica lo que indica (`write`/`clear`/`keep`) sobre `rufi:v1:status` y
     `rufi:v1:page:<slug>`.
   - Si `load` es `true`, se carga `v/<engine del sobre>/rufi-core.js` con la `config` del sobre.
   - Si no, se emite `rufi:off` con el motivo y no se descarga ni el núcleo, ni el 3D, ni el
     modelo.
7. **Página abierta** (`decideLive()`), cada `recheckSeconds` con la pestaña visible, al volver
   a la pestaña y al recuperar la conexión (`online`):
   - se vuelven a leer `_global.json`, `status.json` y la página;
   - `hide` → Rufi sale: `Rufi.destroy()` con el motor 1.1.0, o se quita `#rufi-root` con el
     1.0.0. No vuelve sin recargar;
   - `refresh` → `rufi:update` y la copia nueva se usa en la siguiente carga;
   - un corte de red **no** oculta a Rufi.

Resultados HTTP:
- **404** → `not-found`.
- **400** con cuerpo `{"statusCode":"404"…}` → también `not-found`. Supabase responde así a un
  objeto inexistente en algunas versiones. **Por verificar en la fase B.**
- **200** que no es JSON o pasa de 64 KB → sobre inválido.
- Otros códigos → `error`.
- Corte de red → `error`.
- Espera agotada → `timeout`.

### 2.4 Ampliación sin caso en la referencia: configuración en la propia página

Caso: `window.RufiConfig` sin `data-rufi-config`, con `source.static`.
- No hay sobre de página en el CRM.
- Aun así, **el apagado del sitio debe valer**.
- `decideInline()` llama a `decide()` **tal cual** con una página sintética siempre activa. Así
  solo cuentan los interruptores locales y el estado global: `killed` o sin estado válido → no
  carga.
- Probado en Node (7 casos) y en Chromium (2).

### 2.5 Tamaño

| Archivo | 1.0.0 | 1.1 |
|---|---|---|
| `dist/rufi.js` (cargador) | 1,0 KB gzip | **9,6 KB gzip** (29 KB) |
| `rufi-core.js` | 6,5 KB gzip | 7,9 KB gzip |

- El cargador crece porque lleva la validación completa del contrato y sus dos esquemas. Así no
  se usa ninguna configuración que el CRM no habría podido publicar.
- Va con `defer`: no bloquea la página.
- Si se quiere reducir, la opción es cargar esa parte solo en modo Storage desde
  `v/<versión>/`. No lo he hecho para no añadir otra petición antes de decidir.

## 3. Motor 1.1.0 (`src/rufi.js`)

- **Idiomas** (contrato §8): `pickLang()` y `resolveTexts()` de `spec/reference/i18n.mjs`,
  importados tal cual.
  - Orden: `<html lang>` de la página → idiomas del navegador → idioma base de la configuración,
    entre los disponibles (base + `i18n`).
  - Una configuración 1.0 sale igual que con el motor 1.0.0: en español, con los mismos textos
    (verificado).
  - Nota: la petición decía «`<html lang>` y después el idioma base». El contrato y la
    referencia incluyen en medio los idiomas del navegador, y manda el contrato.
- **Textos de la interfaz** en los cinco idiomas: botones «cerrar», etiqueta por defecto, título
  por defecto y aviso de vista previa. El componente lleva `lang` y `rufi:ready` lo incluye.
  **Las traducciones de la interfaz son mías y están pendientes de revisión por Reference
  Home.**
- **`Rufi.destroy()`**:
  - retira el componente;
  - libera el 3D con `dispose()` de `rufi-3d.js`, que no cambia;
  - para temporizadores y mensajes;
  - vuelve a mostrar lo que ocultaba `replaceSelector`, con su estado anterior;
  - con el motor 1.0.0, el cargador solo quita `#rufi-root`.
- `ai` se **ignora**: el chat es la fase E. Rufi no simula IA y sus mensajes siguen siendo textos
  predefinidos.
- El 3D **no cambia**. No hay movimientos CSS del personaje y la imagen oficial está intacta.

## 4. Carpeta `v/1.1.0` y huellas

`package.json → rufiVersion` pasa a **1.1.0**. `configs/_global.json` **sigue en 1.0.0**:
cambiarlo necesita autorización.

`scripts/build.mjs` ahora:
- no borra `dist/v/<publicada>/`;
- comprueba sus huellas (`scripts/published-versions.json`) antes y después de construir;
- se niega a construir una versión ya publicada;
- **falla si `rufi-3d.js`, el GLB o el póster de 1.1.0 no son idénticos a los de 1.0.0**.

| Archivo | `v/1.0.0` (sin cambios) | `v/1.1.0` |
|---|---|---|
| `rufi-3d.js` | `f708835b7d159873424ad467e69c55ca3d8397a9ef9b76127b67a8dc50ef6c15` | **idéntico** |
| `rufi-expresivo.web.glb` | `a72185cbe3ef132ec33a2b6961db1b16865bedd020b5dd662ffea9f675d66547` | **idéntico** |
| `rufi-poster.webp` | `c37b400d532e56a099ecf705f9462636448a472e3cda52c1dc8b0f7d4bdedd96` | **idéntico** |
| `rufi-core.js` | `09685a892d2750655e5c24286a74010955b03b2d5a1e172f0e8ee092aa550d0e` | `d288fd055f4a85f94e5d43f3d6a28e65aa67a6fde718383c3a4743da5a4ed181` (nuevo) |

`rufi-3d.js` de 1.1.0 se **compila** desde `src/rufi-3d.js`, que no cambia, y sale idéntico byte
a byte. No es una copia. `git diff` de `dist/v/1.0.0/`: **vacío**.

## 5. Corrección del validador

- **Fallo:** `k in schema.properties` y `r in value` aceptaban claves heredadas de
  `Object.prototype`.
  - Un `__proto__`, un `constructor` o un `toString` en una configuración o en un sobre pasaban
    como propiedades conocidas, así que no se rechazaban.
  - Un obligatorio heredado contaba como presente.
- **Corrección** (en `tools/contract-core.mjs`, que usa `tools/validate-config.mjs`):
  - `Object.prototype.hasOwnProperty.call` en `properties`, `required`, `const`, `$defs`
    (`validateApi`), el idioma base en `i18n`, `features11` y la detección de tipo de la CLI.
  - De paso: un `lang` fuera de la lista con la IA activada lanzaba
    `TypeError (AI_WORD[lang] undefined)`; ahora da el error de esquema.
- **Prueba:** `tests/validate-config.test.mjs`, 7 pruebas.
  - Con el validador anterior: **6 fallan** (prueba de mutación).
  - Con la corrección: 7/7.
- **Contrato:** no cambia ningún archivo cubierto por `spec/contract/1.1.sha256` (esquemas,
  `spec/reference`, `spec/vectors`). **No hace falta `npm run contract:hash`** y el CRM no tiene
  que actualizar su copia fijada.
  - Si se quiere que el CRM pruebe lo mismo, se puede añadir un vector
    `config/invalid/clave-heredada.json`. Eso sí cambiaría las huellas.

## 6. Resultados de las pruebas

Salidas completas en `docs/data/fase-d-*.txt`.

| Prueba | Resultado |
|---|---|
| `npm test` | **67 superadas, 0 fallos, 1 omitida** (la omitida necesita Blender; es anterior). Antes: 43 |
| `npm run validate:configs` | 4/4 válidas (las dos plantillas con su aviso `enabled: false`) |
| `npm run build` | Correcto. Versiones publicadas intactas: 1.0.0. 3D, GLB y póster de 1.1.0 idénticos. Aviso: `_global.json` sigue en 1.0.0 |
| `node tests/e2e/loader.e2e.cjs` (cargador en modo 1.0) | **53/53** |
| `node tests/e2e/compat-1.1.e2e.cjs` (motor publicado 1.0.0 con configuraciones 1.1) | **24/24** |
| `node tests/e2e/rufi.e2e.cjs` (componente, escritorio y móvil) | **94/94** |
| `node tests/e2e/storage-1.1.e2e.cjs` (nuevo: Storage falso local) | **116/116** |
| Prueba de mutación del e2e nuevo (validación desactivada y `hide` anulado) | 14 fallos: se detecta |

`storage-1.1.e2e.cjs` cubre:

- **1.0:** una página 1.0 sigue igual (motor 1.0.0, sin peticiones a Storage). La configuración
  1.0 con el motor 1.1.0 sale en español.
- **1.1:**
  - estado activo;
  - sitio apagado;
  - `?rufi=on` no salta el apagado;
  - página `disabled`;
  - página retirada (404) con copia;
  - apagado local con borrado de copias;
  - `source` no válido.
- **Apagado urgente con la página abierta:** sale, emite `rufi:off` y `rufi:destroy` y no vuelve
  sin recargar. También página apagada, apagado local de Arsys, corte de red (se queda),
  configuración nueva (`rufi:update`) y apagado con el motor 1.0.0.
- **Caducidad:** página caducada, estado caducado y copia caducada con Storage caído.
- **JSON manipulado o no válido:** no es JSON, campo de más, datos del CRM, revisión en texto,
  enlace `javascript:`, otro *slug*, más de 64 KB, vista previa servida como página.
- **Red:**
  - corte de conexión;
  - espera mayor que `timeoutMs`;
  - 503;
  - visitante que vuelve con copia válida, que sí carga;
  - visitante que vuelve con marca de apagado, que no carga;
  - CDN con estado viejo frente a un apagado ya visto.
- **Joomla:** ruta por hash y ruta desconocida. Configuración en la página con el sitio activo y
  apagado.
- **Idiomas es/en/fr/it/de:**
  - bienvenida, título, opciones, mensaje de WhatsApp y botón cerrar;
  - `lang` y `rufi:ready`;
  - idioma no disponible → español.
- **Vista previa local:** válida, firma manipulada, caducada, de otra página, otro secreto,
  forma no válida.

## 7. Pendiente y qué necesita autorización

Necesita **vuestra autorización expresa**, y no lo he hecho:

1. **Subir `dist/v/1.1.0/` a Arsys** (`/rufi/v/1.1.0/`). Es una carpeta nueva: la `1.0.0` no se
   toca. Después, añadir `"1.1.0"` con sus huellas a `scripts/published-versions.json`.
2. **Subir el cargador nuevo** `dist/rufi.js` a `/rufi/rufi.js`.
   - Con el `_global.json` actual (sin `source`) se comporta como el 1.0.0. Probado: 53/53 y
     94/94.
   - Aun así, es el archivo que cargan todas las páginas.
   - Su caché es de 5 minutos.
3. **Cambiar `configs/_global.json`**, en dos pasos que se pueden autorizar por separado:
   - `"version": "1.1.0"`. Antes, probar una página fijada con `"version": "1.1.0"`.
   - Añadir `source.static`, y `source.api` si hay vista previa, cuando exista la cubeta
     `rufi-public` (fase B). Sin la cubeta, con `source.static` Rufi **no se mostraría**: falla
     cerrado.
4. **Paquete FTP**: `scripts/package-ftp.mjs` exige que `_global.json` y `rufiVersion` coincidan.
   Hoy falla a propósito: 1.0.0 frente a 1.1.0. Se ajustará cuando se autorice el paso 3.

Pendiente técnico:

- **Fase B:**
  - verificar con la cubeta de pruebas las respuestas reales de Supabase a objetos inexistentes
    (400 o 404) y las cabeceras CORS;
  - medir los tiempos (`tools/measure-propagation.mjs`).
- **Vista previa:**
  - las decisiones abiertas de `docs/20-vista-previa-real.md` §3 (respetar o no el apagado,
    entrada firmada de `preview-token.ts`, CSP);
  - la ruta en el CRM.
- Revisión por Reference Home de los textos de interfaz en en/fr/it/de (`src/rufi.js › UI`).
- `refresh` en páginas abiertas: hoy la configuración nueva se aplica en la siguiente carga, no
  al cerrar el panel.
- Copias de rutas de Joomla en `localStorage`: no se guardan. Si Storage no responde, se usa el
  `_routes.json` local.
