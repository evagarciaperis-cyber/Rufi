# 05 · Evaluación: Blender + glTF/GLB frente a Rive

**Pregunta:** ¿qué tecnología conserva mejor la estética 3D de Rufi siendo viable en móvil?

**Recomendación:** **Blender como fuente única + GLB en tiempo real con three.js**, cargado de forma diferida, con la imagen oficial como póster y alternativa. Rive no se recomienda para este personaje.

## 1. Mediciones propias (6-nov-2026)

Tamaños medidos sobre los paquetes npm, minificados y comprimidos con `gzip -9`. Brotli en servidor los reduce algo más. Son cifras de transferencia, no de memoria.

| Runtime | Qué incluye | gzip |
|---|---|---|
| three.js 0.187.0 (subconjunto, empaquetado con esbuild) | WebGLRenderer, escena, cámaras, luces, AnimationMixer, GLTFLoader, decodificador Meshopt | **≈ 163 KB** |
| + transcodificador KTX2/Basis (opcional) | `basis_transcoder.js` + `.wasm` | + ≈ 254 KB |
| Rive `@rive-app/canvas-lite` 2.49.4 | `rive.js` + `rive.wasm` | ≈ 118 + 341 = **≈ 459 KB** |
| Rive `@rive-app/canvas` 2.49.4 | `rive.js` + `rive.wasm` | ≈ 147 + 909 = **≈ 1 056 KB** |

Además, con la maqueta (3 648 triángulos, 25 huesos, 18 shape keys, 14 clips) se verificó en Chromium (WebGL 2) que three.js carga el GLB exportado por Blender, reproduce los clips con sus duraciones y aplica los pesos de las shape keys fotograma a fotograma.

> Conclusión de las medidas: la idea habitual de que «Rive es más ligero que 3D» **no se cumple aquí**. Un subconjunto de three.js pesa menos que el runtime de Rive (incluso que su versión reducida). El peso del modelo (GLB, objetivo ≤ 800 KB) se suma en ambos casos: en Rive, las texturas de peluche también serían imágenes.

## 2. Comparativa

| Criterio | Blender → GLB (three.js) | Rive |
|---|---|---|
| **Fidelidad al volumen 3D** | Alta: es un modelo 3D real; gira la cabeza, mira, inclina | Media–baja: Rive es 2D. El volumen se imita con capas de imagen deformadas; los giros de cabeza son falsos (paralaje de ±10–15° como mucho) |
| **Aspecto de fieltro** | Textura + normal de fibra + iluminación horneada (+ sheen opcional). Muy cercano al render original | Bitmaps recortados de renders: aspecto fiel *en la pose de origen*, pero la luz no cambia al moverse |
| **Expresiones** | Shape keys reales (párpados, boca, cejas) | Deformación de malla 2D sobre imágenes; muy buena para caras planas, limitada con ojos hundidos y volumen |
| **Interactividad** | Mirada procedural, mezcla de clips y expresiones en código | Excelente: state machine visual integrada (punto fuerte de Rive) |
| **Runtime (medido)** | ≈ 163 KB gzip | ≈ 459 KB – 1 MB gzip |
| **Coste en móvil** | WebGL: hay que controlarlo (lienzo pequeño, DPR ≤ 2, pausar fuera de pantalla, sin sombras en tiempo real). Con ~15k triángulos y 5–7 draw calls es asumible en móviles de gama media | Canvas/WebGL 2D con WASM: fluido y eficiente |
| **Arte de partida** | Un modelo 3D (crearlo o conseguir el original) | **También** necesita material nuevo: capas separadas (cabeza, ojos, párpados, brazos, pañuelo…) que el PNG no tiene, porque está aplanado y tiene partes ocultas. En la práctica, se renderizarían desde un modelo 3D: doble trabajo |
| **Otros usos** | El mismo modelo sirve para vídeo, redes, impresión, poses nuevas y AR | Solo animación 2D |
| **Herramientas** | Blender (libre, GPL); three.js (MIT); formato estándar abierto (Khronos) | Runtimes MIT; editor propio de Rive (planes gratuitos y de pago, condiciones a revisar) |
| **Dependencia de proveedor** | Ninguna | El archivo `.riv` se edita en el editor de Rive |
| **Riesgo de "cambiar a Rufi"** | Bajo si `pose_reference` se valida contra la imagen | Alto: pasar a 2D obliga a reinterpretar el volumen, lo que va contra la regla de no modificar sus rasgos |

## 3. Otras opciones consideradas

| Opción | Valoración |
|---|---|
| **Secuencias prerenderizadas desde Blender** (WebP/WebM con alfa) | Máxima fidelidad (el render es como el original), pero sin mirada ni mezcla en tiempo real, y cada estado pesa (estimado 150–400 KB por segundo a 256 px, sin medir). **Útil como complemento** para momentos concretos o como alternativa en equipos sin WebGL, generado desde el mismo rig |
| `<model-viewer>` (Google) | Usa three.js pero ofrece menos control sobre la mezcla de clips y shape keys, y añade su propio peso. Bueno para visores de producto, no para un personaje con lógica |
| Babylon.js | Muy completo, pero más pesado que el subconjunto de three.js para este caso |
| Spline | Editor cómodo, pero runtime pesado y formato propietario |
| Lottie | Vectorial 2D: no puede mantener el aspecto de peluche |
| CSS sobre el PNG | Ligero, pero solo mueve la imagen entera. **No cumple** el objetivo de una mascota realmente animada. Sirve como alternativa estática |

## 4. Arquitectura recomendada

```
Blender (.blend, fuente única)
   ├─► GLB optimizado (web, tiempo real)  ──► three.js diferido + lógica de estados
   ├─► Póster estático (imagen oficial)   ──► se ve al instante; alternativa sin WebGL / movimiento reducido
   └─► Renders y secuencias (opcional)     ──► vídeo, redes, alternativas de alta fidelidad
```

Condiciones para que funcione en móvil (detalle en `08-runtime-web-plan.md`):

1. Primero se ve la imagen oficial (sin coste de LCP ni CLS). three.js y el GLB se cargan después del `load` y cuando el navegador está libre, o al primer gesto del usuario.
2. Lienzo pequeño (≈ 120–160 px CSS), `devicePixelRatio` limitado a 2, sin sombras en tiempo real (sombra de contacto falsa).
3. Se renderiza solo cuando hace falta: pausa con la pestaña oculta, fuera de pantalla o en `sleep`; 30 fps en reposo y 60 fps en acciones.
4. Niveles de calidad: sheen y antialiasing solo en equipos potentes; sin WebGL o con movimiento reducido, se queda la imagen estática.

## 5. Cuándo cambiaría la recomendación

- Si Reference Home decidiera un **estilo 2D plano** para Rufi (un cambio de identidad que hoy está prohibido), Rive sería la mejor opción.
- Si el presupuesto obligara a no usar WebGL, la alternativa sería el póster con secuencias prerenderizadas, no Rive.
