# 01 · Análisis visual de la imagen oficial

Fuente: `assets/original/mascota.png` (descargada de <https://referencehome.es/images/mascota.png>, 1254 × 1254 px, RGBA, SHA-256 `1937f615…2cf`).
Herramienta reproducible: `python3 tools/analyze_reference.py` → `spec/reference-analysis.json` y las imágenes de `assets/reference/`.

> **Limitación principal:** es **una sola vista**, frontal, con la cabeza girada e inclinada y un brazo levantado. Todo lo que dependa de profundidad (perfil, espalda, grosor de la cresta, forma de la nuca) **no se puede medir** y aparece como *estimado*.

## 1. Lectura del personaje

| Zona | Observación | Detalle |
|---|---|---|
| Superficie | Fieltro o terciopelo fino, mate, con microfibras visibles a corta distancia; aspecto de muñeco de peluche renderizado | `detalles/textura-fieltro-x4.png` |
| Cabeza | Bollo achatado muy ancho, se funde con el cuerpo sin cuello; la unión queda oculta por el pañuelo | `rufi-guides.png` |
| Cresta | Dos lóbulos en gota: grande hacia arriba, pequeño hacia el lado derecho del personaje; unión con sombra de contacto | `detalles/cresta.png` |
| Ojos | Hundidos en cuencas suaves; iris marrón, pupila oscura, esclerótica visible hacia fuera, brillo especular blanco + brillo pequeño; contorno superior marrón con rabillo exterior | `detalles/cara.png` |
| Cejas | Arcos finos marrón oscuro, en relieve, separados del ojo | `detalles/cara.png` |
| Boca | Sonrisa abierta hundida, interior rojo oscuro, lengua rosa, sin dientes | `detalles/cara.png` |
| Mejillas | Rubor rosa con degradado muy suave | `rufi-regions.png` |
| Pañuelo | Tela verde salvia mate con pliegues; nudo en el lado izquierdo del personaje; dos puntas en forma de hoja | `detalles/panuelo-brazo.png` |
| Brazos | Manoplas cortas sin dedos. Izquierdo levantado (saludo), derecho pegado al costado | `detalles/panuelo-brazo.png` |
| Cuerpo | Pera/huevo, más ancho a la altura de la barriga | `rufi-guides.png` |
| Pies | Dos muñones redondeados con suela granate gruesa que envuelve el borde inferior | `detalles/pies-suelas.png` |
| Iluminación | Luz de estudio suave desde arriba-izquierda, sombras muy difusas, sin sombra proyectada | — |

**Convención de lados:** «izquierdo del personaje» = derecha del espectador = **+X** en Blender (sufijo `_L`).

## 2. Proporciones medidas

Valores relativos a la altura total de la figura (cresta → suela = 1232 px = 1,0 en el modelo).

| Medida | Valor | Tipo |
|---|---|---|
| Altura de la cresta | 0,199 | medido |
| Inicio de la cabeza (bajo la cresta) | 0,161 desde arriba → z = 0,839 | medido |
| Anchura máxima de la cabeza (sin brazo) | 0,563 a z = 0,599 | medido |
| Pañuelo (con puntas) | z 0,305 – 0,470 | medido |
| Anchura máxima del cuerpo | 0,459 a z = 0,238 (incluye el brazo derecho pegado; tronco ≈ 0,40) | medido / estimado |
| Suelas | z 0,000 – 0,050 | medido |
| Ojo más cercano | 0,14 × 0,10 | medido |
| Boca | 0,112 de ancho, z = 0,589 | medido |
| Cabeza (con cresta) / altura total | ≈ 53 % | medido |
| Profundidad de la cabeza | ≈ 0,46 (0,82 × anchura) | **estimado** |
| Profundidad del cuerpo | ≈ 0,34 | **estimado** |

Proporción tipo *chibi*: cabeza ≈ 1,4 veces más ancha que el tronco.

## 3. La imagen es una pose, no la posición de reposo

Hallazgos que condicionan el rig:

- **Inclinación (roll) ≈ 15°**: el ojo izquierdo del personaje está 0,067 más alto que el derecho.
- **Giro (yaw) ≈ 15–25° hacia +X**: el ojo izquierdo aparece escorzado (0,109 frente a 0,14 de ancho) y la boca está desplazada +0,042 hacia ese lado.
- **Cresta casi centrada en reposo**: su desplazamiento hacia −X en la imagen se explica por la inclinación de la cabeza (0,35 m × sen 15° ≈ 0,09 m). Verificado superponiendo la maqueta en `pose_reference` (`assets/reference/rufi-proxy-overlay.png`).
- Brazo izquierdo levantado y antebrazo doblado hacia arriba.

Por eso el rig tiene una **pose de reposo neutra y simétrica** (A-pose) y un clip **`pose_reference`** que debe reproducir exactamente la imagen oficial. Es el control de calidad principal del modelo.

## 4. Paleta

Colores **renderizados** (con luz y sombra), no albedo. Mediana por canal y percentiles 10/90 de luminancia (`assets/reference/rufi-palette.png`):

| Zona | Sombra | Medio | Luz |
|---|---|---|---|
| Cuerpo | `#DA9E7D` | `#E5C7AD` | `#F1D8C0` |
| Cresta | `#66121A` | `#962436` | `#AF3448` |
| Suelas | `#5A0F17` | `#731824` | `#922835` |
| Pañuelo | `#736A3F` | `#939364` | `#ACAA7A` |
| Rasgos oscuros (cejas, contorno, iris) | `#2A170F` | `#3F2115` | `#683A23` |
| Esclerótica | `#CABFBB` | `#DBCFCC` | `#F1E3DF` |
| Rubor | `#E4B193` | `#F1C0A4` | `#F5D0B9` |
| Interior de la boca | `#560C01` | `#933628` | `#CF6C5D` |

Para las texturas, el albedo se ajusta comparando el render del modelo con la referencia en las mismas condiciones de luz (ver `06-pipeline.md`), no copiando estos valores.

## 5. Calidad del archivo original

- La figura tiene alfa **≈ 253** (≈ 1 % translúcida) y un halo de alfa 1–2 alrededor. Es un artefacto de exportación. Al usarla como póster o textura se puede forzar alfa 255 dentro de la silueta **sin tocar el color**.
- Solo 1254 px: suficiente como referencia frontal, insuficiente para texturas de detalle (fibras).
- Una única vista: imposible reconstruir con fidelidad la espalda, el perfil ni el interior de la boca.

## 6. Precisión de la segmentación

Segmentación por color HSV + componentes conexas (Python puro). Comprobada visualmente en `rufi-regions.png`: cresta, suelas, pañuelo, boca, rubor, brillos y rasgos oscuros quedan bien separados. Se incluye en «rasgos oscuros» una mancha pequeña en la unión de la cresta con la cabeza (sombra de contacto). Son medidas de ayuda al modelado, no valores de precisión.
