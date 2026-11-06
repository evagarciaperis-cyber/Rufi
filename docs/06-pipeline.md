# 06 · Pipeline de producción

De la imagen oficial a un GLB listo para la web. Cada paso indica si está **verificado** (ejecutado en este repositorio) o **pendiente**.

```
imagen oficial ─► análisis ─► plantilla .blend ─► modelado ─► texturas ─► rig ─► shape keys ─► clips
                  (hecho)      (hecho)              (pendiente: requiere artista 3D)
     ─► exportación GLB ─► compresión ─► validación ─► visor / comparación ─► aprobación ─► web
         (verificado con maqueta)                                              (Reference Home)
```

## 1. Análisis de la referencia — verificado

```bash
python3 tools/analyze_reference.py
```

Genera `spec/reference-analysis.json`, `assets/reference/rufi-regions.png`, `rufi-guides.png` y `rufi-palette.png`. Determinista: con el mismo PNG da el mismo resultado.

## 2. Plantilla de Blender — verificado (Blender 5.2.3)

```bash
blender --background --python blender/scripts/rufi_build_template.py -- --out blender/rufi_rig_template.blend
# Con la maqueta gris (solo para pruebas):
blender --background --python blender/scripts/rufi_build_template.py -- --out build/rufi_proxy.blend --with-proxy
```

Crea `RIG_Rufi` (25 huesos de deformación + `root`), la referencia `REF_Rufi_Frontal` a escala y, con `--with-proxy`, la maqueta `PROXY_*` con las 18 shape keys y los 14 clips de previsualización.

## 3. Modelado, texturas, rig y animación — pendiente

Trabajo de artista 3D sobre la plantilla, siguiendo `02-especificacion-3d.md`, `03-rig-y-shape-keys.md` y `04-expresiones-y-movimientos.md`. Entregables: `blender/rufi.blend` (con texturas empaquetadas o en `blender/textures/`) que pase los pasos 4 a 6.

## 4. Exportación a GLB — verificado

```bash
blender --background blender/rufi.blend --python blender/scripts/rufi_export_glb.py -- --out build/rufi.glb
```

Ajustes y motivos en el propio script: solo huesos de deformación, sin aplicar modificadores (si no, se pierden las shape keys), animaciones por acción, sin normales de morph (ahorra peso).

Hallazgos verificados al exportar la maqueta:

- El nombre de cada acción o pista NLA pasa a ser el nombre del clip glTF.
- Huesos y shape keys en el mismo clip → una acción con dos slots (ver `03-rig-y-shape-keys.md §6`).
- Las shape keys se exportan como *sparse accessors* cuando afectan a pocos vértices (ahorra peso).
- Los nombres de las shape keys llegan a three.js en `morphTargetDictionary`; los de los nodos se sanean (se eliminan los puntos), por eso el contrato usa `_L`/`_R`.

## 5. Compresión — verificado con la maqueta

```bash
npx @gltf-transform/cli@4.5.1 optimize build/rufi.glb build/rufi.min.glb --compress meshopt --texture-compress webp
```

Con la maqueta: **389 KB → 200 KB**, con los 25 huesos, las 18 shape keys y los 14 clips intactos. En three.js (con `MeshoptDecoder`) los pesos de morph y el salto se reproducen igual que en el original.

Notas:

- **Meshopt** (`EXT_meshopt_compression`) en lugar de Draco: su decodificador es pequeño y comprime también las animaciones y los morph targets, no solo la geometría.
- Texturas **WebP**. KTX2 solo si hubiera muchas (su transcodificador añade ~254 KB).
- Las animaciones remuestreadas pesan: conviene `export_optimize_animation_size` (activado) y no añadir claves innecesarias.

## 6. Validación — verificado

```bash
node tools/validate-glb.mjs build/rufi.min.glb
```

Comprueba el contrato (huesos, shape keys, clips), el presupuesto (triángulos, huesos, morph targets, tamaño, texturas), las extensiones permitidas y que no sea la maqueta. Código de salida 1 si hay errores: se puede usar en CI.

## 7. Revisión visual — verificado

```bash
python3 -m http.server 8000      # en la raíz del repositorio
# abrir http://localhost:8000/tools/glb-viewer/?src=../../build/rufi.min.glb
```

- Reproducir cada clip.
- Probar las expresiones del JSON y las shape keys una a una.
- **«Comparar con la imagen oficial» + clip `pose_reference`**: el modelo debe coincidir con la imagen.

## 8. Aprobación

Reference Home aprueba: (1) el modelo en `pose_reference` frente a la imagen oficial, (2) la hoja de expresiones, (3) los clips. Sin aprobación no se publica.

## 9. Pruebas automáticas

```bash
npm test     # 11 pruebas: validador, contrato de nombres y GLB real de la maqueta si existe en build/
```
