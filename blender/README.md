# blender/

| Archivo | Qué es |
|---|---|
| `rufi_rig_template.blend` | **Plantilla de trabajo.** Esqueleto `RIG_Rufi` con los nombres del contrato + imagen oficial `REF_Rufi_Frontal` a escala real (1,0 m, suelo en Z=0), detrás del personaje. Incluye las acciones de previsualización (solo huesos). **No contiene el modelo de Rufi.** |
| `scripts/rufi_build_template.py` | Regenera la plantilla desde `spec/rufi.character.json`. `--with-proxy` añade la maqueta gris |
| `scripts/rufi_export_glb.py` | Exporta un .blend a GLB con los ajustes del contrato |

Probado con Blender **5.2.3 LTS** (módulo `bpy`). Requiere Blender 4.4+ por los *slots* de acción.

## Para el artista 3D

1. Abre `rufi_rig_template.blend` y guárdalo como `rufi.blend`.
2. Vista frontal (numpad 1): la imagen oficial está detrás. Modela encima respetando `docs/02-especificacion-3d.md`.
3. Ajusta las posiciones de los huesos al modelo **sin cambiar nombres ni jerarquía**.
4. Pesos, shape keys y clips según `docs/03` y `docs/04`. Un clip que anime huesos y shape keys = una acción con dos slots.
5. Exporta, valida y compara:

```bash
blender --background blender/rufi.blend --python blender/scripts/rufi_export_glb.py -- --out build/rufi.glb
node tools/validate-glb.mjs build/rufi.glb
```

Y en el visor (`tools/glb-viewer/`): clip `pose_reference` + «Comparar con la imagen oficial».

## Convenciones

- Lados: `_L` = izquierda del personaje (+X); `_R` = derecha (−X). Nunca `.L` (three.js elimina los puntos).
- Prefijos: `RUFI_` (mallas finales), `M_Rufi_` (materiales), `T_Rufi_` (texturas), `CTRL_`/`MCH_` (controles, no se exportan), `REF_` (referencias, no se exportan), `PROXY_` (maqueta: el validador la rechaza).
