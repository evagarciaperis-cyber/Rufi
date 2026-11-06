# Rufi PRO · mascota digital oficial de Reference Home

Repositorio fuente de **Rufi**: identidad, especificación técnica, pipeline 3D y herramientas. Cualquier web, landing o app que use a Rufi parte de aquí.

![Rufi, imagen oficial](assets/web/rufi-256.webp)

## Estado

**Fase 4 — expresiones faciales (rama `fase-4-expresiones`).** `models/rufi-expresivo.web.glb` (**593,7 KB**): párpados de geometría real (`blink`) y sonrisa (`smile`) como morph targets, integrados en `idle`, `wave` y `curious`. Con los ojos abiertos la cara es idéntica al original (0 píxeles distintos). Pendiente en Blender: correctiva de la axila. Ver [`docs/13-expresiones-fase-4.md`](docs/13-expresiones-fase-4.md) y `examples/visor-expresiones/`.

**Fase 3 — rig corregido y animaciones (rama `fase-3-rigging`).** `models/rufi-animado.web.glb` (**556,2 KB**): modelo A-pose con los pesos corregidos y las animaciones de esqueleto `idle`, `wave` y `curious`. Cara, ojos, pañuelo, barriga y piernas verificados sin deformación. Pendiente en Blender: pliegue de la axila en `wave`, expresiones faciales. Ver [`docs/12-rigging-fase-3.md`](docs/12-rigging-fase-3.md) y `examples/visor-animaciones/`.

**Fase 2 — modelo 3D real (Meshy): incorporado, analizado y optimizado.** Ver [`docs/09-modelo-3d-meshy.md`](docs/09-modelo-3d-meshy.md).

| Fase 2 | |
|---|---|
| Modelo real | `models/original/rufianimado.glb` (33 MB, Git LFS) → `models/rufi.web.glb` (**697,7 KB**, 27 040 triángulos, WebP + Meshopt) |
| Animaciones presentes | Idle_11, Idle_15, Walking, Running (verificado) |
| Problema | Las 4 animaciones **deforman** la malla (rig automático en pose de saludo, pesos defectuosos). El reposo es correcto |
| Contrato | No lo cumple aún: esqueleto Mixamo, sin shape keys, sin clips propios |
| Visor | `examples/visor-rufi/` |
| Siguiente paso | Re-rig con pesos limpios + shape keys + clips del contrato |
| **Candidato A-pose** | `models/candidatos/apose/` (Meshy, A-pose): **mucho mejor** en brazos, hombros y cabeza; algo peor en piernas; **manos con dedos** (pendiente de decisión). No sustituye aún al vigente. Ver [`docs/11-validacion-modelo-apose.md`](docs/11-validacion-modelo-apose.md) y `examples/visor-rig/` |

**Fase 1 — análisis y preparación del personaje: completada.**

| Hecho y verificado | Pendiente |
|---|---|
| Análisis medido de la imagen oficial (proporciones, paleta, regiones, pose) | **El modelo 3D de Rufi** (modelado, texturas, pesos, animación final) |
| Especificación 3D, rig, shape keys, expresiones y clips (`spec/rufi.character.json`) | Vistas de referencia adicionales o el archivo 3D original |
| Plantilla de Blender con el esqueleto y la imagen a escala | Componente web (fase 2) |
| Pipeline Blender → GLB → Meshopt → validación → three.js probado de extremo a extremo con una **maqueta gris** | Integración en el Aval ICO (no iniciada a propósito) |
| Validador de GLB y visor de revisión | Conexión con ManyChat |
| Evaluación Blender + glTF frente a Rive, con medidas propias | |

> **Ya existe el modelo 3D real de Rufi, pero todavía no es animable según el contrato** (ver arriba). La maqueta `PROXY_*` de la fase 1 sigue sirviendo solo para probar el pipeline.

## Estructura

```
RUFI.md                     Identidad, personalidad, voz, expresiones, estados y comportamiento
CLAUDE.md                   Instrucciones permanentes para Claude
spec/
  rufi.character.json       Contrato técnico: proporciones, paleta, materiales, huesos, shape keys, clips, presupuesto
  reference-analysis.json   Medidas generadas a partir de la imagen oficial
assets/
  original/mascota.png      Imagen oficial SIN MODIFICAR (fuente de verdad)
  reference/                Guías, regiones, paleta, superposición de la maqueta y primeros planos
  web/                      Copias redimensionadas (WebP/PNG) para póster y documentación
models/
  original/rufianimado.glb  Modelo real de Meshy, intacto (Git LFS)
  rufi.web.glb              Versión optimizada para la web
examples/visor-rufi/        Visor de pruebas: reproduce cada animación
blender/
  rufi_rig_template.blend   Plantilla: esqueleto RIG_Rufi + referencia a escala
  scripts/                  Construcción de la plantilla y exportación a GLB
tools/
  analyze_reference.py      Análisis reproducible de la imagen
  validate-glb.mjs          Validador del contrato (sin dependencias)
  inspect-model.mjs         Informe de lo que contiene un GLB
  optimize-model.mjs        Optimización para la web (glTF-Transform + meshoptimizer + sharp)
  glb-viewer/               Visor de revisión con comparación frente a la imagen oficial
tests/                      Pruebas (node --test)
docs/                       01 análisis · 02 modelo 3D · 03 rig · 04 expresiones y movimientos ·
                            05 evaluación Blender/Rive · 06 pipeline · 07 recursos pendientes · 08 plan web ·
                            09 modelo 3D de Meshy · 10 reutilizar en landings
```

## Uso rápido

```bash
npm test                                    # validador y contrato
python3 tools/analyze_reference.py          # regenerar el análisis (requiere Pillow)
node tools/validate-glb.mjs archivo.glb     # validar cualquier GLB de Rufi
npm run pipeline:proxy                      # requiere Blender en el PATH: plantilla → maqueta → GLB → validación
npm install && npm run optimize             # regenerar models/rufi.web.glb desde el original (requiere el archivo LFS)
```

Visor: `python3 -m http.server` en la raíz y abrir `http://localhost:8000/tools/glb-viewer/?src=../../build/rufi_proxy.glb`.

## Decisión tecnológica

**Blender como fuente única + GLB en tiempo real con three.js**, cargado de forma diferida después de mostrar la imagen oficial. Motivos y medidas en [`docs/05-evaluacion-blender-gltf-vs-rive.md`](docs/05-evaluacion-blender-gltf-vs-rive.md): conserva el volumen 3D y el fieltro, y su runtime (≈163 KB gzip) pesa menos que el de Rive (≈459 KB – 1 MB gzip, medido).

## Repositorio

Repositorio oficial: <https://github.com/evagarciaperis-cyber/Rufi> (privado).

```bash
git clone https://github.com/evagarciaperis-cyber/Rufi.git
```

## Reglas

- No modificar `assets/original/mascota.png` ni los rasgos de Rufi.
- No afirmar que existe un modelo animable hasta que un GLB real pase el validador sin `--allow-proxy`.
- No modificar la landing del Aval ICO, el CRM ni otros proyectos sin una indicación expresa.
