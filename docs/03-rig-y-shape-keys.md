# 03 · Rig y shape keys

Esqueleto definido en `spec/rufi.character.json → rig` y construido automáticamente por `blender/scripts/rufi_build_template.py` en `blender/rufi_rig_template.blend`.

## 1. Esqueleto de deformación (se exporta)

```
root (no deforma)
└─ pelvis ─ spine ─ chest ─┬─ neck ─ head ─┬─ crest_base ─┬─ crest_lobe_big
   │                       │               │              └─ crest_lobe_small
   │                       │               ├─ eye_L, eye_R
   │                       │               └─ brow_L, brow_R
   │                       ├─ scarf_knot ─┬─ scarf_tail_a
   │                       │              └─ scarf_tail_b
   │                       ├─ upper_arm_L ─ forearm_L ─ hand_L
   │                       └─ upper_arm_R ─ forearm_R ─ hand_R
   ├─ leg_L ─ foot_L
   └─ leg_R ─ foot_R
```

25 huesos de deformación (límite 40). Posiciones en el JSON: **estimadas** a partir de una sola vista; el riggeador las ajusta al modelo, pero **los nombres y la jerarquía no cambian**.

| Grupo | Para qué |
|---|---|
| `pelvis`, `spine`, `chest` | Saltos, aplastar y estirar, respiración |
| `neck`, `head` | Giro (±35°), cabeceo (±20°), inclinación (±20°). El pivote está bajo el pañuelo para que la cabeza «nazca» del cuerpo |
| `crest_*` | Rebote secundario de la cresta |
| `eye_L/R` | Mirada (ojos con iris en textura, giran dentro de la cuenca) |
| `brow_L/R` | Refuerzo de las cejas además de sus shape keys |
| `scarf_*` | Puntas del pañuelo, secundario |
| Brazos | 3 huesos por brazo para un saludo con curva (no hay dedos) |
| Piernas | Pasitos, saltos y aterrizajes |

## 2. Controles (solo en el .blend)

`CTRL_look_target` (Damped Track a los ojos), `CTRL_head` con límites, IK de manos y pies, `CTRL_body` con conservación de volumen. Se marcan como no deformantes y el exportador los descarta (`export_def_bones=True`).

## 3. Ejes de los huesos (verificado)

Las transformaciones de los pose bones van en **ejes locales del hueso**. Medido en Blender 5.2.3 con la plantilla:

| Hueso | Rotación local | Efecto |
|---|---|---|
| `head` | Y + | La cara gira hacia +X (como en la imagen oficial) |
| `head` | Z + | Sube el ojo izquierdo (inclinación de la imagen oficial) |
| `head` | X | Cabeceo (asentir) |
| `pelvis` | Traslación Y + | Sube (salto) |
| `upper_arm_L` | Giro **del mundo** en Y − | Levanta el brazo hacia fuera (saludo) |

`pose_reference` = cabeza (0°, 20°, 15°) + brazo izquierdo levantado; superpuesto a la imagen oficial coincide en cresta, brazo y dirección de la cabeza (`assets/reference/rufi-proxy-overlay.png`).

## 4. Pesos (skinning)

- Máximo 4 influencias por vértice (límite práctico de glTF/three.js).
- Cabeza casi rígida sobre `head`, con transición suave hacia `neck` bajo el pañuelo.
- Barriga repartida entre `spine` y `pelvis` para que la respiración y el aplastamiento sean blandos, como un peluche.
- Pañuelo pesado a `chest` y `scarf_*`, nunca a `head` (no debe girar con la cara).

## 5. Shape keys (morph targets)

En el mesh `RUFI_Head`. **Basis = la cara de la imagen oficial** (sonrisa abierta).

| Shape key | Uso |
|---|---|
| `blink_L`, `blink_R` | Parpadeo (párpado de piel que baja; el contorno marrón acompaña al párpado) |
| `eye_happy_L/R` | Ojos sonrientes «^ ^» |
| `eye_wide_L/R` | Sorpresa |
| `brow_up_L/R`, `brow_down_L/R`, `brow_worry_L/R` | Cejas |
| `mouth_closed_smile` | Sonrisa cerrada (escucha, tono serio y cercano) |
| `mouth_open` | Abrir/cerrar para `talk_loop` |
| `mouth_o` | Sorpresa / «¡oh!» |
| `mouth_wide` | Alegría grande |
| `mouth_small` | Curiosidad, timidez, sueño |
| `cheek_puff` | Mejillas infladas al sonreír |

Opcionales: `eye_squint_L/R`, `mouth_side_L/R`, `body_squash`, `body_stretch`. Máximo 32.

No hay *visemas* de lip-sync: Rufi no tiene voz. `talk_loop` abre y cierra la boca con ritmo natural mientras se muestra una burbuja.

## 6. Clips con huesos y shape keys a la vez (verificado)

Con Blender 4.4+ las acciones tienen *slots*. Para que un clip como `happy_jump` incluya el salto (huesos) y los ojos sonrientes (shape keys) en **una sola** animación glTF:

1. Crear la acción `happy_jump`.
2. Asignarla al armature con su slot de tipo `OBJECT` y animar los huesos.
3. Asignarla también a las shape keys de `RUFI_Head` con un slot de tipo `KEY` y animar los valores.
4. Guardar ambas en pistas NLA con el nombre del clip.

Si se usan dos acciones con nombres distintos, el exportador crea **dos** animaciones (`blink` y `blink_shapekeys`), lo que rompe el contrato. Comprobado con el exportador glTF de Blender 5.2.3 y con three.js 0.187 (pesos de morph correctos fotograma a fotograma).
