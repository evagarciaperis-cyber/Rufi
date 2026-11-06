# Rufi PRO · mascota digital oficial de Reference Home

Repositorio fuente de **Rufi**: identidad, especificación técnica, pipeline 3D y herramientas. Cualquier web, landing o app que use a Rufi parte de aquí.

![Rufi, imagen oficial](assets/web/rufi-256.webp)

## Estado

**Fase 1 — análisis y preparación del personaje: completada.**

| Hecho y verificado | Pendiente |
|---|---|
| Análisis medido de la imagen oficial (proporciones, paleta, regiones, pose) | **El modelo 3D de Rufi** (modelado, texturas, pesos, animación final) |
| Especificación 3D, rig, shape keys, expresiones y clips (`spec/rufi.character.json`) | Vistas de referencia adicionales o el archivo 3D original |
| Plantilla de Blender con el esqueleto y la imagen a escala | Componente web (fase 2) |
| Pipeline Blender → GLB → Meshopt → validación → three.js probado de extremo a extremo con una **maqueta gris** | Integración en el Aval ICO (no iniciada a propósito) |
| Validador de GLB y visor de revisión | Conexión con ManyChat |
| Evaluación Blender + glTF frente a Rive, con medidas propias | |

> **No existe todavía un modelo 3D animable de Rufi.** La maqueta `PROXY_*` está hecha con primitivas grises y solo sirve para probar el pipeline; el validador la rechaza como modelo final.

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
blender/
  rufi_rig_template.blend   Plantilla: esqueleto RIG_Rufi + referencia a escala
  scripts/                  Construcción de la plantilla y exportación a GLB
tools/
  analyze_reference.py      Análisis reproducible de la imagen
  validate-glb.mjs          Validador del contrato (sin dependencias)
  glb-viewer/               Visor de revisión con comparación frente a la imagen oficial
tests/                      Pruebas (node --test)
docs/                       01 análisis · 02 modelo 3D · 03 rig · 04 expresiones y movimientos ·
                            05 evaluación Blender/Rive · 06 pipeline · 07 recursos pendientes · 08 plan web
```

## Uso rápido

```bash
npm test                                    # validador y contrato
python3 tools/analyze_reference.py          # regenerar el análisis (requiere Pillow)
node tools/validate-glb.mjs archivo.glb     # validar cualquier GLB de Rufi
npm run pipeline:proxy                      # requiere Blender en el PATH: plantilla → maqueta → GLB → validación
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
