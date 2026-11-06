# 20 · Fase F — plugin de sistema para Joomla 6 (`plg_system_rufi`)

Fecha: 6-nov-2026. Rama: `fase-9f-joomla` (creada desde `fase-8a-contrato-1.1`).

**Estado: código preparado y probado de forma aislada. NO instalado en ningún Joomla.**
- No se ha tocado Arsys, ningún sitio Joomla ni ninguna landing.
- No se ha subido ni desplegado nada.
- No se ha descargado Joomla.

> Numeración: este documento es el **20** porque `docs/17-…` ya existe (propuesta de Rufi Admin en
> el CRM), igual que `18-…` y `19-…`.

## 1. Qué hace

Joomla genera la página y, en el evento `onAfterRender`, el plugin añade **una línea** antes del
último `</body>` real:

```html
<script src="/rufi/rufi.js" data-rufi-config="aval-ico-valencia" defer></script>
```

Es la misma línea que se pone a mano en las landings HTML (`docs/15-instalacion-centralizada.md`).
A partir de ahí manda el cargador central: `_global.json`, `disabledPages`, `?rufi=off|on|debug`,
`enabled:false` de la configuración, etc. Con el plugin:
- no hay que editar plantillas, artículos ni módulos;
- no se guarda nada en el contenido de Joomla: la línea se añade en memoria a cada respuesta;
- fuera del punto de inserción la página no cambia **ni un byte** (se comprueba en cada inserción y
  en las pruebas).

### Cuándo NO inserta

| Situación | Motivo interno |
|---|---|
| Interruptor «Insertar el cargador» en No (valor por defecto al instalar) | `desactivado` |
| Administración, API, CLI o cualquier cliente que no sea el sitio público | `no-es-sitio` |
| Rutas `/administrator`, `/api`, `/installation` (también bajo la subcarpeta de Joomla) y las rutas excluidas configuradas | `ruta-excluida` |
| Petición AJAX (`X-Requested-With`) o `option=com_ajax` | `ajax` |
| `format=` distinto de `html` (json, raw, feed…) | `formato-no-html` |
| `tmpl=component` o `tmpl=raw` (ventanas modales, impresión) | `tmpl-…` |
| Documento de Joomla que no es HTML, o página de error (tipo `error` o estado fuera de 2xx) | `documento-no-html` / `pagina-de-error` |
| `Content-Type` distinto de `text/html`, o cuerpo que empieza por `{` o `[` | `no-html` |
| URL del cargador no permitida | `url-cargador-no-permitida` |
| La página no tiene configuración asignada (y no está activado «Cargador sin nombre») | `sin-configuracion` |
| La página ya incluye el cargador (`…/rufi/rufi.js`, la URL configurada o cualquier `data-rufi-config`) | `cargador-ya-presente` |
| No hay ningún `</body>` real | `sin-body` |

Cualquier excepción dentro del plugin deja la respuesta **intacta**.

## 2. Archivos

| Archivo | Qué es |
|---|---|
| `integrations/joomla/plg_system_rufi/rufi.xml` | Manifiesto: `type="plugin"`, `group="system"`, `method="upgrade"`, `namespace` `ReferenceHome\Plugin\System\Rufi` (`path="src"`), campos de configuración |
| `…/services/provider.php` | Registro en el contenedor de servicios (convención J4/5/6) |
| `…/src/Extension/Rufi.php` | Clase del plugin: `SubscriberInterface`, `onAfterRender`. Solo traduce Joomla → datos |
| `…/src/Helper/Injector.php` | **Inyector puro, sin Joomla.** Toda la lógica de decisión, validación e inserción |
| `…/language/es-ES/`, `…/language/en-GB/` | `plg_system_rufi.ini` y `plg_system_rufi.sys.ini` |
| `tests/php/run.php` | Ejecutor de pruebas con PHP a secas (sin PHPUnit) |
| `tests/php/injector.test.php` | Pruebas del inyector |
| `tests/php/static.test.php` | Manifiesto, idiomas, estructura y `php -l` |
| `tests/php/harness.test.php` + `tests/php/harness/joomla-stubs.php` | **Simulación** del evento con clases falsas de Joomla |
| `tests/joomla-plugin.test.mjs` | Ejecuta las pruebas PHP desde `npm test` (se omite si no hay PHP) |
| `scripts/package-joomla.mjs` | Genera y verifica `build/plg_system_rufi-<versión>.zip` |
| `docs/data/fase-f-*.txt` | Salidas de las pruebas |

## 3. Configuración (Extensiones → Plugins → «Sistema - Rufi»)

Pestaña **Básico**:

| Campo | Por defecto | Notas |
|---|---|---|
| Insertar el cargador | **No** | Interruptor general del plugin. Activar el plugin en el gestor sin encender esto no hace nada |
| URL del cargador | `/rufi/rufi.js` | Ruta desde la raíz o URL `https` del mismo origen o de un origen permitido; debe acabar en `.js`. Sin espacios, comillas, `<`, `>`, `\`, `#`, credenciales, `.` ni `..`. `http` solo si es el mismo origen (pruebas locales). Si no es válida, no se inserta nada |
| Orígenes permitidos | vacío | Solo si el cargador está en otro dominio. Uno por línea (`https://cdn.ejemplo.es`) |
| Páginas sin configuración asignada | No insertar | «Cargador sin nombre» inserta `<script src="/rufi/rufi.js" defer></script>` en todas las páginas públicas y el cargador decide con `configs/_routes.json` (lo que hoy hace el fragmento global, `docs/15`) |

Pestaña **Páginas**:

| Campo | Notas |
|---|---|
| Por URL | Filas «Exacta/Prefijo · ruta · configuración». Ruta como se ve en el navegador, sin dominio ni `?…`. Se normaliza igual que el contrato (`spec/reference/routes.mjs`, mismos 15 vectores de `spec/vectors/routes.json`). El prefijo va **por segmentos**: `/hipotecas` cubre `/hipotecas/fija`, no `/hipotecasx`. Gana la primera fila que coincida. Distingue mayúsculas, como el cargador |
| Por elemento de menú | Filas «elemento de menú · configuración». Se usa el elemento de menú activo (`Itemid`). Las reglas por URL van antes |
| Rutas excluidas | Una por línea, por segmentos. `/administrator`, `/api` e `/installation` están siempre excluidas |

Los nombres de configuración siguen el patrón del contrato: `^[a-z0-9-]+$`, máximo 64
(`page` en `spec/rufi-config.schema.json`, `slug` en `spec/rufi-crm-api.schema.json`). Los nombres
o rutas no válidos se **ignoran** (esa fila no inserta nada). El formulario además lleva un
`pattern`, pero la validación que cuenta es la del inyector.

Si la página usa CSP con *nonce* (plugin «Sistema - Cabeceras HTTP»), el inyector añade
`nonce="…"` con el valor que da Joomla (`csp_nonce`). **No verificado** en un Joomla real (§6).

## 4. Instalación, desinstalación y vuelta atrás (cuando se autorice)

**Antes de nada: copia de seguridad completa (archivos + base de datos)** del sitio, con Akeeba
Backup o la copia del panel de Arsys, y comprobar que se puede restaurar. Primero en un Joomla de
pruebas si existe; en producción solo con la autorización del §7.

### Instalar

1. `npm run package:joomla` → `build/plg_system_rufi-0.1.0.zip` (comprobar el SHA-256 que imprime).
2. Administración → Sistema → Instalar → Extensiones → Subir paquete.
3. Extensiones → Plugins → «Sistema - Rufi»: dejar el interruptor en **No**, rellenar la pestaña
   «Páginas» y guardar.
4. Activar el plugin en el gestor. Con el interruptor en No, todavía no cambia nada.
5. Poner el interruptor en **Sí**. Comprobar en la página asignada (ver código fuente) que hay
   **una** línea antes de `</body>`, y con `?rufi=debug` qué decide el cargador. Comprobar también
   una página no asignada y la administración (no debe haber línea).
6. Si el sitio usa caché de páginas («Sistema - Caché de página» o caché de la plantilla/CDN),
   borrarla para que las páginas se generen de nuevo.

### Apagar (de menos a más)

| Acción | Efecto | Reversible |
|---|---|---|
| `?rufi=off` en la URL | Solo en ese navegador y esa visita | Sí |
| `configs/_global.json` → `"enabled": false` o `disabledPages` | Rufi no aparece; la línea sigue en el HTML pero el cargador no descarga nada más | Sí, al instante |
| Interruptor «Insertar el cargador» en No | La línea deja de insertarse | Sí, al instante |
| Desactivar el plugin en el gestor | Igual; el plugin no se carga | Sí, al instante |
| Desinstalar | Joomla borra los archivos del plugin y su fila (con los ajustes) | Sí, reinstalando el zip (los ajustes hay que volver a ponerlos: anotarlos antes) |

**Desinstalar no deja nada en las páginas**: el plugin nunca escribe en artículos, módulos,
plantillas ni en la base de datos (aparte de sus propios ajustes). La única excepción son las
**copias en caché** generadas mientras estaba activo (caché de página de Joomla, caché del
navegador, CDN): tras desactivar o desinstalar, **borrar la caché** de Joomla (Sistema → Borrar
caché) y, si hay CDN, purgarla.

### Volver a una versión anterior del plugin

Instalar el zip de la versión anterior encima (`method="upgrade"`): conserva los ajustes. O
restaurar la copia de seguridad del paso 0.

## 5. Compatibilidad con Joomla 6.2 (versión de producción comprobada: 6.2.0, ver `docs/18`)

Lo que se ha seguido (convenciones modernas J4/5/6):
- plugin con espacio de nombres propio (`ReferenceHome\…`, no el de Joomla) y `services/provider.php`;
- clase que extiende `CMSPlugin` e implementa `SubscriberInterface` (`getSubscribedEvents`);
- `getApplication()` en lugar de `Factory` dentro de la clase; `getInput()` en lugar de `$app->input`
  (obsoleto); sin `JFactory`, `JPlugin` ni otras clases heredadas (no depende del plugin de
  compatibilidad hacia atrás);
- idiomas en la carpeta del plugin, sin prefijo de idioma en el nombre del archivo;
- PHP 8.3 (el mínimo de Joomla 6), `declare(strict_types=1)`, `\defined('_JEXEC') or die;`.

Puntos a confirmar en un Joomla 6.2 real (**no verificados**):
- **Constructor del plugin.** `provider.php` usa la forma de los plugins del núcleo de 4.2–5.x
  (`new Rufi($dispatcher, (array) PluginHelper::getPlugin('system', 'rufi'))` +
  `setApplication()`). Es posible que Joomla 6 la marque como obsoleta o prefiera otra; si al
  instalar sale un aviso o error, ajustar solo `provider.php`.
- **Firma del manejador.** `onAfterRender(?EventInterface $event = null)` acepta tanto el objeto
  de evento de Joomla 5/6 (`AfterRenderEvent`) como una llamada sin argumentos.
- Campos `subform` (repetible en tabla), `menuitem`, `note` y el interruptor `radio.switcher`:
  forma estándar, sin probar su presentación.
- Cabecera de estado en `getHeaders()` y `csp_nonce` del plugin de cabeceras HTTP.
- Orden con otros plugins de `onAfterRender` (por ejemplo, optimizadores que reescriben el HTML):
  si uno reescribe `</body>` después, Rufi podría quedar duplicado o fuera; la idempotencia evita
  duplicados en una segunda pasada del propio plugin.

## 6. Qué se ha verificado y qué no

**Verificado** (solo comprobaciones estáticas y pruebas aisladas, en esta máquina con PHP 8.3.6
CLI):

| Prueba | Resultado |
|---|---|
| `php tests/php/run.php` (inyector + estáticas + simulación) | **256/256** (`docs/data/fase-f-php.txt`) |
| `php -l` de los 8 archivos PHP (3 del plugin + 5 de pruebas) | Sin errores |
| `npm test` | **44 superadas, 0 fallos, 1 omitida** (la omitida es anterior: necesita Blender). Incluye la nueva prueba que ejecuta las pruebas PHP |
| `npm run package:joomla` | Zip de 8 archivos, mismos que la carpeta, `rufi.xml` en la raíz, SHA-256 de cada archivo idéntico, `php -l` de los PHP extraídos |
| Prueba de mutación (romper a propósito el salto de comentarios, la regla «solo sitio» del inyector, la de la clase y la idempotencia) | Las pruebas fallan en cada caso |

Casos cubiertos por las pruebas del inyector: inserción con igualdad byte a byte fuera del punto
de inserción (también con bytes no UTF-8, `\r\n`, BOM y `</BODY >`); idempotencia (segunda pasada
y siete formas de línea ya presente); sin `</body>`; varios `</body>` en scripts, comentarios,
`<style>`, `<textarea>`, `<template>`, `<noscript>`, atributos y CDATA; correspondencia por URL
(exacta, prefijo por segmentos, orden) y por menú; los 15 vectores de rutas del contrato (con su
SHA-256); rutas excluidas (incluida la subcarpeta y `%61dministrator`); XSS en nombres (11 casos) y
en URL (21 casos: `javascript:`, `data:`, `//host`, otro dominio, credenciales, comillas, `..`
codificado…); escape de atributos; respuestas no HTML (19 casos); administración y otros clientes.

La **simulación** (`tests/php/harness/`) usa clases **falsas** con los nombres de las de Joomla:
comprueba que `provider.php` registra la clase, que `onAfterRender` llama al inyector y aplica su
resultado, que la administración ni siquiera lee la respuesta y que una excepción no rompe la
página. **No demuestra** que el plugin funcione en Joomla.

**No verificado:**
- instalación, configuración y funcionamiento en un Joomla real (6.2 ni ninguna otra versión);
- todo lo de §5 «Puntos a confirmar»;
- comportamiento con la plantilla, la caché y los plugins concretos del sitio de producción;
- PHPUnit no está instalado (Composer sí, pero no se ha usado para no descargar nada).

## 7. Autorización necesaria

Esta fase solo autoriza **preparar** el código. Para cada uno de estos pasos hace falta una orden
expresa de Reference Home:
1. Instalar el plugin en un Joomla **de pruebas** (si lo hay) para verificar §5.
2. Instalar el plugin en el Joomla **de producción** (`referencehome.es`), con copia de seguridad
   previa, y qué páginas asignar.
3. Encender el interruptor para cada página concreta.

El plugin solo actúa sobre las respuestas que genera Joomla. La landing del Aval ICO es un HTML
subido por FTP (fase 7); si el servidor la sirve como archivo estático, Joomla no la procesa y el
plugin no la toca. En cualquier caso no se le asigna configuración sin una orden expresa.
