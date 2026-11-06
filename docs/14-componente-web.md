# 14 · Fase 5: componente web interactivo

Fecha: 6-nov-2026. Rama: `fase-5-web` (sale de `fase-4-expresiones`).

> **Actualizado en la fase 7:** la instalación ya es centralizada. `dist/rufi.js` es ahora el **cargador**; el núcleo está en `dist/v/<versión>/rufi-core.js` y la configuración en `configs/<página>.json` (antes `src/config/aval-ico.js`, eliminado). Las secciones 1, 4 y 5 describen la fase 5; lo vigente está en [`15-instalacion-centralizada.md`](15-instalacion-centralizada.md).

## 1. Qué hay

| Archivo | Qué es | Peso |
|---|---|---|
| `dist/rufi.js` | Núcleo: Shadow DOM, póster, burbujas, panel, contexto, memoria de sesión. **Sin three.js** | 17,3 KB (**6,3 KB gzip**) |
| `dist/rufi-3d.js` | Motor 3D: three.js 0.186.1 + GLTFLoader + Meshopt, empaquetado. Se carga **diferido** | 645,9 KB (**165,8 KB gzip**) |
| `dist/rufi-expresivo.web.glb` | Modelo de la fase 4 (sin cambios) | 593,7 KB |
| `dist/rufi-poster.webp` | Póster: render del propio motor 3D en reposo (mismo encuadre) | 20,2 KB |
| `dist/config/aval-ico.js` | Configuración de la landing del Aval ICO (plantilla para otras) | — |
| `src/` | Código fuente (`rufi.js`, `rufi-3d.js`, `adapter.js`, `config/`) | — |
| `examples/demo-aval-ico/` | Entorno de pruebas con la estructura de la landing | — |
| `tests/e2e/rufi.e2e.cjs` | Pruebas de extremo a extremo (escritorio, iPhone 13, Pixel 7, movimiento reducido, landing real) | — |

Construir: `npm run build` (y `node scripts/make-poster.cjs` si cambia el modelo).

## 2. Funcionamiento

1. **Carga sin coste para la página.** `rufi.js` (6 KB) crea un contenedor fijo en la esquina inferior derecha dentro de un **Shadow DOM** y muestra el póster. Tras el evento `load`, y cuando el navegador está libre, importa `rufi-3d.js` y el GLB. Con el 3D listo, el póster se funde con el lienzo; como ambos tienen el mismo encuadre, no hay salto. Sin WebGL o con `prefers-reduced-motion`, se queda el póster y todo lo demás funciona igual.
2. **Entrada (una vez por sesión).** Asoma desde la esquina con el movimiento `curious`: el modelo sube desde debajo del borde, inclinado. Después entra, saluda con `wave` (con su sonrisa integrada) y muestra la bienvenida. En las siguientes páginas de la misma sesión entra sin saludar ni hablar.
3. **Reposo.** Se queda en `idle` (respiración y dos parpadeos cada 4 s). Tras 45 s sin actividad se duerme: ojos cerrados, respiración a media velocidad y el render se detiene. Despierta con cualquier movimiento.
4. **Panel.** Al pulsar (o con Enter/Espacio) abre un diálogo con tres acciones y Rufi sonríe con `smile`. Se cierra con Esc, con la ✕ o pulsando fuera, y el foco vuelve a Rufi.
5. **Contexto.** Detecta en la landing la llegada al test y al simulador, el final del test y el resultado del simulador. Reacciona con `curious` o `smile` y un mensaje prudente.
6. **Respeto al visitante:**
   - Bienvenida una sola vez por sesión.
   - Si el visitante cierra una burbuja, Rufi no vuelve a hablar por iniciativa propia en la sesión.
   - Espera 2 s después de la última tecla antes de hablar.
   - Deja al menos 20 s entre mensajes.
   - Como máximo 4 mensajes por página.
   - El resultado de un proceso tiene prioridad y sustituye a un mensaje menor.
7. **No es un chat.** Los mensajes están escritos de antemano y no hay ningún texto generado ni simulación de inteligencia artificial.

### Rendimiento

- Render limitado a 60 fps en escritorio y **30 fps en móvil**, con densidad de píxeles máxima de 2 (escritorio) y **1,5 (móvil)**.
- El render se **detiene** con la pestaña oculta, con Rufi fuera de la vista o dormido.
- Posición fija y póster con tamaño reservado: **CLS = 0** (medido).

## 3. Adaptador de nombres (contrato de la fase 1 → modelo real)

`src/adapter.js` es el único punto donde se resuelve la diferencia de nombres. El componente siempre habla con los estados del contrato (`RUFI.md §6`).

| Estado del contrato | Cómo se representa con el modelo real |
|---|---|
| `hidden` | Modelo fuera del lienzo (debajo del borde) |
| `peek` | Clip **`curious`** + modelo asomado desde abajo e inclinado (desplazamiento del modelo completo en la escena 3D; el GLB no tiene clip `peek_in`) |
| `enter` | Clip **`idle`** + el modelo sube a su sitio (desplazamiento amortiguado) |
| `greet` (`greet_wave`) | Clip **`wave`**, una vez, luego `idle` |
| `idle` (`idle_breathe`) | Clip **`idle`** en bucle |
| `curious` (`curious_tilt`) | Clip **`curious`**, una vez, luego `idle` |
| `happy` (`happy_jump`) | `idle` + expresión aditiva **`smile`** durante 1,8 s (no hay salto en el modelo) |
| `talking` (`talk_loop`) | `idle` (el modelo no tiene bocas de habla) |
| `sleep` | `idle` sin sus expresiones, a 0,6× + morph `blink` sostenido a 1 (ojos cerrados) |
| `exit` | Modelo fuera del lienzo |
| `blink` (morph `blink_L`/`blink_R`) | Expresión **`blink`** (un control para los dos ojos) |
| `eye_happy` / `mouth_wide` | Expresión **`smile`** |

Los movimientos se encadenan con **fundido cruzado de 0,35 s**. `blink` y `smile` se reproducen como **animaciones aditivas** encima del movimiento, de modo que se suman sin cortarlo. `smile` no se suma durante `wave`, que ya sonríe. Huesos: `BONE_MAP` en el mismo archivo (Mixamo, sin `:` en three.js).

## 4. Configuración para nuevas landings

(Fase 7: ahora es un JSON en `configs/`, mismos campos; ver `15-instalacion-centralizada.md` §4.) En la fase 5 se copiaba `src/config/aval-ico.js` y se cambiaba:

```js
window.RufiConfig = {
  page: 'nombre-de-la-landing',          // clave de la memoria de sesión
  replaceSelector: null,                 // elemento existente que Rufi sustituye (se oculta sin editar el HTML)
  welcome: { text: '…' },
  whatsapp: { number: '34674612272', message: '…' },
  panel: { title, subtitle, footnote, options: [
    { id, label, hint, icon: 'check' | 'calculator' | 'whatsapp', action: { type: 'scroll', target: '#id', focus: '#titulo' } },
    { id, label, hint, icon: 'whatsapp', action: { type: 'whatsapp' } },   // o { type: 'link', href }
  ] },
  triggers: [
    { id, on: 'visible', selector: '#seccion', threshold: 0.35, dwell: 1400, state: 'curious', say: '…' },
    { id, on: 'complete', selector: '#contenedor', match: '.resultado', state: 'happy', say: '…', bubbleAction: { … } },
    { id, on: 'shown', selector: '#elemento-oculto', state: 'happy', say: '…' },
  ],
  // opcionales: size, offset, zIndex, breakpoint, sleepAfter, bubbles: { minGap, autoHide, maxPerPage, typingPause }
};
```

Eventos para analítica o automatizaciones (por ejemplo ManyChat): `rufi:ready`, `rufi:state`, `rufi:bubble`, `rufi:bubble-dismiss`, `rufi:open`, `rufi:close` y `rufi:action` en `document`, con `detail.page`. El componente **no envía datos a ningún servicio**.

## 5. Instalación en aval-ico-valencia.html (paso posterior, no aplicado)

(Fase 7: sustituido por una sola línea, `<script src="/rufi/rufi.js" data-rufi-config="aval-ico-valencia" defer></script>`; ver `15-instalacion-centralizada.md`.)

Solo hay que **subir archivos** y **añadir dos líneas** antes de `</body>`. No se toca ningún texto, sección, calculadora, estilo ni metadato SEO.

1. Subir la carpeta `dist/` a `https://referencehome.es/rufi/`:
   ```
   /rufi/rufi.js  /rufi/rufi-3d.js  /rufi/rufi-expresivo.web.glb  /rufi/rufi-poster.webp  /rufi/config/aval-ico.js
   ```
2. Servidor (Apache): `AddType model/gltf-binary .glb`, `AddType image/webp .webp`; caché larga para `/rufi/` y un nombre nuevo de archivo en cada versión.
3. Añadir al final de `aval-ico-valencia.html`, justo antes de `</body>`:
   ```html
   <script src="/rufi/config/aval-ico.js"></script>
   <script src="/rufi/rufi.js" defer></script>
   ```
4. La mascota anterior (`#masc`, con su `RH_MASCOTA_CONFIG`) se oculta automáticamente gracias a `replaceSelector: '#masc'`. Más adelante se puede borrar del HTML con calma; mientras tanto, nada cambia en la página.
5. Comprobar en la página real: aparición, panel, las tres acciones y las reacciones al test y al simulador.

**Vuelta atrás:** quitar las dos líneas. La mascota anterior vuelve a aparecer tal cual.

## 6. Pruebas realizadas

`node tests/e2e/rufi.e2e.cjs --landing build/aval-ico-valencia.html`: **148/148 comprobaciones superadas**.

| Escenario | Dispositivo |
|---|---|
| Demo, escritorio | 1280 × 800 |
| Demo, iPhone 13 | Emulado: 390 × 664, DPR 3, táctil |
| Demo, Pixel 7 | Emulado: 412 × 839, DPR 2,6, táctil |
| Demo, movimiento reducido | `prefers-reduced-motion: reduce` |
| **Copia local de la landing real** + las 2 líneas de instalación | Escritorio e iPhone 13 |

Comprobaciones por escenario:

- **Montaje:** Shadow DOM; `#masc` oculto; estilos de la página idénticos antes y después.
- **Disposición:** sin scroll horizontal; esquina inferior derecha; no tapa el botón de WhatsApp de la página.
- **Entrada:** secuencia hidden → peek → enter → greet → idle y bienvenida.
- **Panel:** tres acciones; enlace `wa.me/34674612272`; foco en la primera opción; Esc cierra y devuelve el foco; «Comprobar requisitos» lleva al test (también en la landing real con sus animaciones `.reveal`).
- **Contexto:** reacciones al test, al final del test, al simulador y al resultado; espera ≥ 2 s tras la última tecla.
- **Respeto al visitante:** silencio tras cerrar una burbuja; se duerme y despierta; la bienvenida no se repite al recargar.
- **Calidad técnica:** CLS = 0 y sin errores en consola.
- **Movimiento reducido:** no carga el 3D, muestra el póster y el panel funciona.

Rendimiento medido (render por software SwiftShader, sin GPU):

- Escritorio: 26–34 fps de la página.
- Móvil emulado: 35–40 fps.
- Motor y modelo listos en 230–270 ms (servidor local).

### Pendiente: pruebas en dispositivos reales

Las pruebas de móvil son **emulaciones en Chromium** (tamaño, densidad y eventos táctiles), con render por software. **No sustituyen a un iPhone ni a un Android reales**: falta comprobar la GPU real, Safari en iOS, la batería, el calor y el teclado virtual. La fase no debe darse por cerrada hasta pasar esta lista en al menos un iPhone (Safari) y un Android de gama media (Chrome):

1. Abrir la demo publicada y la copia de pruebas con las dos líneas de instalación.
2. Comprobar que Rufi aparece, saluda, parpadea, sonríe, y que se ve nítido y sin cortes.
3. Abrir el panel con el dedo y probar las tres acciones (WhatsApp abre la app).
4. Llegar al test y al simulador, y escribir en el simulador con el teclado virtual: Rufi no debe tapar los campos ni el botón de WhatsApp.
5. Dejar el móvil 1 minuto: Rufi se duerme y la animación se detiene (el móvil no se calienta).
6. Activar «Reducir movimiento» en el sistema: Rufi aparece quieto y el panel funciona.
