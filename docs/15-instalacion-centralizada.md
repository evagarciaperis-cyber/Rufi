# 15 · Rufi PRO — instalación centralizada y reutilizable

Rufi se instala **una sola vez** en `https://referencehome.es/rufi/`. Cada página que lo quiera
añade **una línea** y tiene su propia configuración en JSON. El motor (JS) y el modelo (GLB) son
únicos y están versionados.

## 1. Estructura en el servidor

```
/rufi/
├── rufi.js                    ← CARGADOR (~1 KB gzip). Es lo único que incluyen las páginas.
├── .htaccess                  ← tipos MIME, compresión, caché corta (5 min) para cargador y configs
├── index.html                 ← carpeta no listable
├── configs/
│   ├── _global.json           ← interruptor general, versión activa, páginas apagadas
│   ├── _routes.json           ← ruta → configuración (solo instalaciones con fragmento global, p. ej. Joomla)
│   ├── aval-ico-valencia.json ← configuración de la landing del Aval ICO (producción, aún sin usar)
│   └── aval-ico-valencia-test.json ← configuración de la página de pruebas
└── v/
    ├── .htaccess              ← caché de 1 año (immutable): una versión publicada no cambia nunca
    └── 1.0.0/
        ├── rufi-core.js       ← componente (Shadow DOM, panel, burbujas, disparadores) · 6,5 KB gzip
        ├── rufi-3d.js         ← motor 3D (three.js 0.186.1) · 165,8 KB gzip, carga diferida
        ├── rufi-expresivo.web.glb ← el único modelo · 593,7 KB
        └── rufi-poster.webp   ← imagen fija mientras carga el 3D o si no hay WebGL
```

En el repositorio, `npm run build` genera exactamente esa estructura en `dist/` (la versión sale de
`package.json → rufiVersion`; las configuraciones se validan antes de copiarse).

## 2. Activar Rufi en una página

### Landing HTML (recomendado)

Una línea antes de `</body>`. No se toca nada más de la página:

```html
<script src="/rufi/rufi.js" data-rufi-config="aval-ico-valencia" defer></script>
```

`data-rufi-config` es el nombre del archivo `configs/<nombre>.json` (sin `.json`).

### Joomla

Dos opciones:

- **Por página** (sin tocar la plantilla): en el artículo o en un módulo «HTML personalizado»
  asignado solo a esa página, la misma línea con `data-rufi-config`. El editor debe permitir
  `<script>` (desactivar el filtrado de TinyMCE para ese grupo o usar el módulo HTML).
- **Un fragmento global** en la plantilla (`index.php` de la plantilla, antes de `</body>`, o el
  campo «código personalizado» si la plantilla lo tiene):
  ```html
  <script src="/rufi/rufi.js" defer></script>
  ```
  Sin `data-rufi-config`, el cargador mira `configs/_routes.json`. **Una página que no figura en
  `_routes.json` no carga nada más** (ni núcleo, ni 3D, ni modelo: verificado). Formato:
  ```json
  { "routes": [
      { "path": "/ICO/aval-ico-valencia.html", "config": "aval-ico-valencia" },
      { "prefix": "/hipotecas/", "config": "hipotecas" }
  ] }
  ```
  `path` es exacto (sin dominio ni `?…`); `prefix` cubre todas las URL que empiezan así. Gana la
  primera coincidencia. Con URL amigables de Joomla, usar la ruta que se ve en el navegador.

### Configuración dentro de la página (sin archivo)

```html
<script>window.RufiConfig = { "page": "mi-pagina", "panel": { … } }</script>
<script src="/rufi/rufi.js" defer></script>
```

Si se usan a la vez `data-rufi-config` y `window.RufiConfig`, se carga el archivo y la página
**solo ajusta** lo que ponga (por ejemplo `{ "position": "left" }`).

## 3. Cuándo NO se carga Rufi (orden de decisión del cargador)

| Situación | Resultado | Descargas |
|---|---|---|
| `?rufi=off` en la URL | no carga | solo `rufi.js` |
| `_global.json` con `"enabled": false` | no carga en ninguna página (salvo `?rufi=on`) | `rufi.js` + `_global.json` |
| nombre en `disabledPages` de `_global.json` | no carga en esa página (salvo `?rufi=on`) | `rufi.js` + `_global.json` |
| fragmento global y página fuera de `_routes.json` | no carga | `rufi.js` + `_global.json` + `_routes.json` |
| `configs/<nombre>.json` no existe | no carga, sin errores | + la configuración (404) |
| configuración con `"enabled": false` | no carga (salvo `?rufi=on`) | + la configuración |
| todo correcto | carga el núcleo de `v/<versión>/` y, después, el 3D | |

Las páginas sin la línea de Rufi no descargan nada. `?rufi=debug` muestra en la consola por qué
se carga o no (`[Rufi cargador] …`) y activa el modo depuración del componente.

Todo esto está probado en Chromium: `node tests/e2e/loader.e2e.cjs` → 53/53
(`docs/data/e2e-cargador-fase7.txt`).

## 4. Configuración por página

Archivo JSON **sin código**, validado por `spec/rufi-config.schema.json`:

```bash
node tools/validate-config.mjs configs/mi-pagina.json --html copia-de-la-pagina.html
```

Con `--html` comprueba además que los selectores `#id` existen en la página. Campos principales:

| Campo | Para qué |
|---|---|
| `page` | identificador (memoria de sesión: bienvenida, mensajes vistos, silencio) |
| `enabled` | `false` = apagado sin borrar el archivo |
| `version` | fijar esta página a una versión concreta del motor (si no, la de `_global.json`) |
| `test` | página de pruebas: eventos con `test: true` y registro `[Rufi PRUEBA]` |
| `replaceSelector` | elemento existente que Rufi oculta (p. ej. la mascota anterior `#masc`) |
| `position`, `size`, `offset`, `zIndex`, `breakpoint` | colocación (sin CLS: `position: fixed`) |
| `welcome.text` | bienvenida (una vez por sesión; máx. 160 caracteres) |
| `whatsapp` | número (`34674612272`) y mensaje por defecto |
| `panel` | título, subtítulo, nota al pie y 1–5 opciones |
| `triggers` | mensajes según el contexto: `visible` (sección en pantalla), `complete` (aparece un elemento, p. ej. el resultado del test), `shown` (un elemento deja de estar oculto) |
| `automation` | códigos `ref` para WhatsApp/ManyChat (ver §6) |

Acciones (en opciones del panel y en `bubbleAction` de los disparadores):
`scroll` (`target`, `focus`), `whatsapp` (`number`, `message`), `link` (`href`), `panel` (abre el
panel), `event` (solo emite `rufi:action`, para que la página o una automatización decidan).

Plantillas: `configs/ejemplos/plantilla-landing.json` y `configs/ejemplos/joomla-articulo.json`
(ambas con `enabled: false`).

Los textos son siempre **predefinidos**: Rufi no simula un chat ni una IA. Mantener el tono de
`RUFI.md` (mensajes financieros prudentes: «orientativo», «decide el banco», «habla con un asesor»).

## 5. Actualizaciones, caché y vuelta atrás

- **Configuraciones**: se piden con `?v=<configVersion>` de `_global.json` y revalidando
  (`cache: no-cache`). Cambiar un JSON se ve en la siguiente visita; si un proxy intermedio
  cachea, cambiar `configVersion` (por ejemplo, a la fecha) fuerza la descarga.
- **Cargador** (`/rufi/rufi.js`): caché de 5 minutos. Cambia muy poco.
- **Motor y modelo** (`/rufi/v/<versión>/`): caché de un año, `immutable`. **Nunca se modifica
  una carpeta publicada.** Para actualizar:
  1. `npm run build` con la nueva `rufiVersion` en `package.json` (p. ej. `1.1.0`).
  2. Subir **solo** la carpeta nueva `/rufi/v/1.1.0/` (la `1.0.0` se queda).
  3. Probar en una página con su configuración fijada a `"version": "1.1.0"`.
  4. Cambiar `"version": "1.1.0"` en `_global.json` → todas las páginas pasan a la nueva.
- **Vuelta atrás**: volver a poner `"version": "1.0.0"` en `_global.json` (efecto inmediato).
- **Apagado de emergencia**: `"enabled": false` en `_global.json`. Para quitarlo de una sola
  página: añadirla a `disabledPages` o poner `enabled: false` en su configuración.

## 6. WhatsApp y ManyChat (sin el chat web de ManyChat)

Rufi no carga el widget de ManyChat ni ningún script externo. La integración es por datos:

- Cada opción y acción puede llevar un código `ref` (`RUFI_AVALICO_ASESOR`, …).
- Con `"automation": { "appendRef": true }`, el mensaje de WhatsApp termina en `[RUFI_AVALICO_ASESOR]`.
  Una automatización de WhatsApp (ManyChat, WhatsApp Business API…) puede disparar un flujo por
  palabra clave con ese código. Por defecto está desactivado (`false`) en el Aval ICO: el mensaje
  es exactamente el de siempre.
- Para Instagram/Messenger: acción `link` con `href` `https://ig.me/m/<cuenta>?ref=RUFI_…` o
  `https://m.me/<página>?ref=RUFI_…` (ManyChat recibe el `ref` como disparador).
- Eventos en `document` para conectar lo que se quiera más adelante (analítica propia, píxel,
  etc.), sin que Rufi envíe nada a ningún servicio:
  ```js
  document.addEventListener('rufi:action', (e) => console.log(e.detail)); // { page, id, type, ref, test? }
  ```
  Otros: `rufi:ready`, `rufi:engine`, `rufi:state`, `rufi:bubble`, `rufi:open`, `rufi:close`,
  `rufi:bubble-dismiss`. En páginas de pruebas todos llevan `test: true`.

## 7. Configurador visual (preparado, no construido)

Todo lo que cambia entre páginas está en JSON, sin código, y descrito por un esquema
(`spec/rufi-config.schema.json`, JSON Schema 2020-12, con descripciones en español, límites de
longitud y enumeraciones). Un configurador sencillo puede:

1. Generar el formulario a partir del esquema (campos, desplegables de `icon`, `state`, `on`, tipos de acción).
2. Cargar la página real en un `<iframe>` con `?rufi=off` para que se elijan los selectores con el ratón.
3. Previsualizar con `window.RufiConfig = <borrador>` (modo «configuración en la página»).
4. Validar con la misma lógica de `tools/validate-config.mjs` (`validateSchema` / `validateConfig`, sin dependencias; para el navegador solo hay que cambiar la lectura del esquema, que hoy usa `node:fs`).
5. Descargar `<nombre>.json` para subirlo a `/rufi/configs/` y, si es Joomla, la línea para `_routes.json`.

## 8. Comprobaciones antes de publicar una configuración nueva

```bash
node tools/validate-config.mjs configs/<nombre>.json --html copia-de-la-pagina.html
npm run build
node tests/e2e/loader.e2e.cjs
```

Y en la web real: abrir la página con `?rufi=debug` y mirar la consola.
