# 04 · Expresiones y movimientos para la web

Qué necesita una mascota web interactiva y cómo se traduce en clips, expresiones y lógica del runtime. Nombres exactos en `spec/rufi.character.json`.

## 1. Tres capas de animación

| Capa | Quién la hace | Ejemplos |
|---|---|---|
| **Clips** (animación de autor, en Blender) | Animador | `greet_wave`, `happy_jump`, `peek_in` |
| **Expresiones** (mezcla de shape keys) | Runtime, con valores del JSON | `feliz`, `curioso`, `atento_serio` |
| **Procedural** (en tiempo real) | Runtime | Parpadeo aleatorio, mirada hacia el puntero o el elemento activo, rebote de cresta y puntas del pañuelo, intensidad del rubor |

Mezclar las tres hace que Rufi parezca vivo sin necesitar decenas de clips: el mismo `idle_breathe` con mirada y parpadeos distintos nunca se repite igual.

## 2. Clips obligatorios

| Clip | Bucle | Duración | Estado web | Notas de animación |
|---|---|---|---|---|
| `idle_breathe` | sí | 4,0 s | idle | Respiración muy sutil (pecho +2 %), leve balanceo; debe poder mirarse durante minutos sin cansar |
| `blink` | no | 0,2 s | (aditivo) | Solo shape keys; el runtime lo lanza cada 3–6 s con azar |
| `peek_in` | no | 1,2 s | peek | Asoma desde la esquina inferior: primero cresta, luego ojos |
| `peek_hold` | sí | 3,0 s | peek | Mira con curiosidad, pequeña inclinación |
| `enter` | no | 1,0 s | enter | Saltito de entrada con ligero aplastamiento al aterrizar |
| `greet_wave` | no | 1,6 s | greet | Brazo izquierdo arriba (como en la imagen oficial), 2–3 vaivenes del antebrazo |
| `curious_tilt` | no | 0,8 s | curious | Inclina la cabeza ~12°, ceja arriba, boca pequeña; mantiene la pose final |
| `happy_jump` | no | 0,9 s | happy | Anticipación (aplasta), salto, estira, aterriza; ojos sonrientes |
| `talk_loop` | sí | 0,6 s | talking | Boca que abre y cierra, pequeño cabeceo |
| `sleep_in` | no | 1,2 s | sleep | Párpados bajan, cabeza cae suavemente |
| `sleep_loop` | sí | 4,0 s | sleep | Respiración lenta y profunda |
| `wake_up` | no | 1,0 s | sleep → idle | Se despierta con un pequeño sobresalto amable |
| `exit` | no | 0,8 s | exit | Se agacha y sale por abajo |
| `pose_reference` | — | 1 fotograma | — | **Control de calidad**: idéntico a la imagen oficial |

## 3. Clips recomendados (segunda tanda)

`idea_point` («¡Tengo una idea!»), `point_side` (señalar el test o el simulador), `celebrate` (fin de un proceso), `nod_yes`, `boop` (reacción al pulsar sobre Rufi), `look_around` (variación del idle).

## 4. Principios de animación para Rufi

- **Peso de peluche**: todo con aplastar y estirar suave; nada rígido ni mecánico.
- **Anticipación y asentamiento** en saltos y saludos; ningún movimiento empieza ni termina en seco.
- **Secundarios**: la cresta y las puntas del pañuelo siguen al movimiento con retraso.
- **Contención**: movimientos pequeños. En la web Rufi mide ~100–160 px; un movimiento grande distrae del contenido.
- **Bucles invisibles**: el primer y el último fotograma de los bucles coinciden.
- **Pose de reposo = encanto de la imagen oficial**: el idle debe recordar a esa pose (cabeza ligeramente inclinada), no a la A-pose técnica.

## 5. Mapa estado → animación en el runtime

```
hidden ──► peek (peek_in → peek_hold) ──► enter ──► greet ──► idle
                                                     ▲         │ ├─► curious ─┐
                                                     │         │ ├─► happy ───┤
                                                     └─────────┘ ├─► talking ─┤
                                                                 └─► sleep ───┘ (wake_up)
cualquiera ──► exit ──► hidden
```

- Transiciones con fundido cruzado de 0,15–0,3 s (`AnimationAction.crossFadeTo`).
- Los clips de un solo uso vuelven a `idle` al terminar.
- `blink` y la mirada se superponen a cualquier estado salvo `sleep`.
- Expresión por estado: `greet`→`feliz`, `curious`→`curioso`, `talking`→`hablando` (+ `atento_serio` si el mensaje es financiero o legal), `sleep`→`dormido`.

## 6. Movimiento reducido

Con `prefers-reduced-motion: reduce`: sin saltos, sin bucles ni movimiento procedural. Se muestra una pose fija por estado (o la imagen estática) y los cambios son fundidos de opacidad. El parpadeo también se desactiva.

## 7. Previsualización disponible hoy

`docs/img/previz-maqueta-estados.png`: la maqueta gris ejecutando los clips de previsualización. Sirve para validar tiempos, ejes y exportación, **no** la estética ni la animación final.
