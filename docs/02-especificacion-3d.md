# 02 · Especificación del modelo 3D

Objetivo: reconstruir a Rufi como personaje 3D fiel a la imagen oficial, ligero para la web y preparado para animarse. El contrato de nombres y cifras está en `spec/rufi.character.json`; este documento explica el porqué.

> Estado: **especificación**. El modelo todavía no existe. Ver `07-recursos-pendientes.md`.

## 1. Escala y orientación

- Blender en metros, **altura total 1,0 m** (cresta incluida), origen en el suelo entre los pies.
- Blender: Z arriba, el personaje mira a **−Y**. glTF (tras exportar): +Y arriba, mira a +Z.
- `_L` = lado izquierdo del personaje = +X. Nunca `.L` (ver `CLAUDE.md`).
- `blender/rufi_rig_template.blend` ya trae la imagen oficial colocada a escala real detrás del personaje (`REF_Rufi_Frontal`) y el esqueleto `RIG_Rufi`.

## 2. Mallas (objetos separados)

| Objeto | Contenido | Por qué separado |
|---|---|---|
| `RUFI_Body` | Cabeza + cuerpo + brazos + piernas en una sola malla continua | El fieltro no tiene costuras visibles; una malla evita grietas al deformar |
| `RUFI_Head` | La zona facial con todas las shape keys (puede ser la misma malla que `RUFI_Body`; si se separa, la unión debe quedar oculta) | El contrato busca las shape keys en el mesh `RUFI_Head` |
| `RUFI_Crest` | Dos lóbulos | Movimiento secundario propio |
| `RUFI_Eye_L/R` | Globo ocular con iris/pupila en textura | Giran con los huesos `eye_*` |
| `RUFI_EyeHighlight_L/R` | Brillos como geometría *unlit* | Emparentados a `head`, **no** al ojo: el brillo no se mueve cuando el ojo mira a otro lado (truco clásico de animación) |
| `RUFI_Brows` | Cejas en relieve | Shape keys `brow_*` y huesos `brow_*` |
| `RUFI_Mouth` | Cavidad + lengua | Debe verse bien con todas las formas de boca |
| `RUFI_Scarf` | Pañuelo, nudo y puntas | Material y movimiento propios |
| `RUFI_Soles` | Suelas | Pueden ir en `RUFI_Body` con otro material |
| `RUFI_Blush` | Decal del rubor | Su intensidad la controla el runtime |

Para la web es preferible acabar con **pocas mallas y pocos materiales** (≈5–7 *draw calls*). Se pueden unir en la exportación final si no hacen falta por separado.

## 3. Topología

- Cuadriláteros, flujo de aristas en anillos alrededor de ojos y boca (necesario para parpadeo y sonrisas limpias).
- Bucles extra en articulaciones (hombros, codos, base de la cabeza, tobillos) y en la línea del pañuelo.
- Simetría en X durante el modelado; la asimetría (nudo del pañuelo) va en una malla aparte.
- Presupuesto final para la web: **objetivo 15 000 triángulos, máximo 30 000** (todas las mallas). Para render de vídeo se puede usar Subdivision Surface sobre la misma malla.
- Sin agujeros ocultos innecesarios: el interior de la boca se modela solo hasta donde se ve.

## 4. Materiales y aspecto «peluche»

El reto estético es el fieltro. Estrategia por niveles de calidad:

1. **Base (todos los dispositivos):** `MeshStandardMaterial` (glTF PBR metallic-roughness), metallic 0, roughness 0,85–0,95. Albedo con oclusión ambiental y una luz suave **horneadas** en la textura, que es lo que da el volumen del render original con un coste mínimo.
2. **Detalle de fibra:** mapa de normales de fieltro tileable pequeño (256–512 px) con `KHR_texture_transform` para repetirlo.
3. **Gama alta (opcional):** `KHR_materials_sheen` para el brillo aterciopelado en los bordes. Se activa solo si el dispositivo va sobrado.
4. Ojos: roughness baja (~0,15) para el brillo húmedo; brillos `KHR_materials_unlit`.

Texturas: un atlas de **1024 × 1024** como máximo (base color) + normal tileable; formato **WebP** (`EXT_texture_webp`).

**No se usa pelo/partículas** (hair curves): no existe en glTF y sería inviable en móvil. El aspecto de fieltro se logra con textura + normal + sheen.

## 5. Ajuste del color (albedo)

Los colores medidos en `01-analisis-visual.md` incluyen luz. El albedo se ajusta así:

1. Iluminar en Blender de forma parecida a la referencia (luz principal suave arriba-izquierda, relleno amplio).
2. Renderizar `pose_reference` con cámara ortográfica frontal a la escala de la referencia.
3. Comparar zona por zona (cuerpo, cresta, pañuelo, suelas) con la paleta y corregir el albedo hasta que la diferencia sea imperceptible.

## 6. Criterios de aceptación del modelo

- `pose_reference` superpuesto a la imagen oficial (visor GLB → «Comparar con la imagen oficial») coincide en silueta, cresta, ojos, boca, pañuelo y pies.
- Revisión visual y aprobación escrita de Reference Home.
- `node tools/validate-glb.mjs rufi.glb` sin errores (sin `--allow-proxy`).
- Se ve bien a 96–160 px de alto en pantalla (tamaño real en la web): ojos y brillos legibles.
