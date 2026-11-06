# Rufi — identidad oficial

> Documento de referencia del personaje. Todo proyecto que use a Rufi (web, landing, app, vídeo, redes) parte de aquí. Si algo no está definido en este archivo o en `spec/rufi.character.json`, se pregunta antes de inventarlo.

## 1. Quién es

| | |
|---|---|
| **Nombre** | Rufi |
| **Empresa** | Reference Home, inmobiliaria en Valencia |
| **Papel** | Mascota digital y guía: ayuda a entender y a dar el siguiente paso, nunca presiona |
| **Imagen oficial** | <https://referencehome.es/images/mascota.png> · copia sin modificar en `assets/original/mascota.png` · SHA-256 `1937f6152d2de22c8ae2f30e7e488045c3414acac15532c0d2d82a95ddd3e2cf` |

## 2. Rasgos visuales que no se pueden cambiar

Medidos en `docs/01-analisis-visual.md`. Ninguna versión (2D, 3D, ilustración, sticker) puede alterarlos:

- **Cuerpo** de fieltro/terciopelo color crema (`#E5C7AD` medio), en forma de bollo: cabeza muy grande (≈53 % de la altura con la cresta) que se funde con el cuerpo sin cuello visible.
- **Cresta granate** (`#962436`) de **dos lóbulos** en forma de gota: uno grande hacia arriba y uno pequeño hacia el lado derecho del personaje. Misma textura de fieltro.
- **Pañuelo verde salvia** (`#939364`) al cuello, con **nudo en el lado izquierdo del personaje** y **dos puntas en forma de hoja** hacia abajo.
- **Ojos** grandes y brillantes, hundidos en la cara: iris marrón con pupila más oscura, blanco visible, **un brillo blanco redondo** grande y otro pequeño, contorno marrón oscuro con un **rabillo hacia fuera** en cada ojo.
- **Cejas** marrón oscuro, finas y en relieve, separadas del ojo.
- **Boca** abierta en sonrisa, cavidad roja oscura y lengua rosa, **sin dientes**.
- **Rubor** rosa suave en ambas mejillas. **Sin nariz.**
- **Brazos** cortos con **manos de dedos pequeños y redondeados** (decisión oficial de Reference Home, 6-nov-2026, al adoptar el modelo 3D A-pose como base). Sustituye a la manopla sin dedos de la imagen 2D original.
- **Pies** cortos y redondeados con **suela granate** gruesa (`#731824`).

Prohibido: cambiar colores, proporciones, número de lóbulos de la cresta, color o posición del pañuelo, cambiar la forma de las manos aprobada, añadir dientes, nariz, ropa, accesorios o logotipos sobre el personaje, o sustituirlo por otro personaje "parecido".

## 3. Personalidad

- Tierno, simpático y cercano.
- Un poquito travieso y curioso.
- Alegre, expresivo y juguetón.
- Inteligente y profesional cuando da información inmobiliaria.
- **Nunca** insistente, pesado ni invasivo.

Rufi debe parecer un pequeño personaje vivo, no un botón de chatbot.

## 4. Cómo habla

Natural, cercano y ligeramente divertido. Frases cortas. Tuteo.

Ejemplos aprobados:

- «¡Holaaa! 👋 Soy Rufi.»
- «¿Te echo una patita? 🏡»
- «¡Tengo una idea! ¿Lo comprobamos juntos?»
- «¡Vamos a verlo!»

Reglas:

- Nada de lenguaje infantil exagerado ni de expresiones comerciales agresivas («¡Última oportunidad!», «¡No te lo pierdas!»).
- **Hipotecas, avales, impuestos y temas legales: prudente y riguroso.** Siempre «orientativo», nunca promete aprobaciones ni cifras exactas, y remite a un asesor para el caso concreto. Ejemplo: «Es una estimación orientativa: la decisión final es siempre del banco. ¿Lo revisamos con un asesor?».
- No simula una inteligencia artificial que no existe: sus mensajes son textos preparados, no conversación libre. No aparece «escribiendo…» ni finge pensar.
- Emojis con moderación (uno por mensaje como máximo).

## 5. Expresiones

Definidas como combinaciones de shape keys en `spec/rufi.character.json → expresiones`.

| Expresión | Cuándo |
|---|---|
| `neutral_sonrisa` | Por defecto. Es la cara de la imagen oficial |
| `feliz` | Saludo, logros, fin de un proceso |
| `curioso` | El visitante interactúa o llega a una sección |
| `sorprendido` | Reacción breve a un clic |
| `idea` | «¡Tengo una idea!» |
| `hablando` | Mientras se muestra una burbuja |
| `atento_serio` | Información financiera o legal: calmado y cercano |
| `timido` | Cuando el visitante cierra una burbuja (se retira con educación) |
| `adormilado` / `dormido` | Inactividad prolongada |

**Prohibidas por marca:** enfado, llanto, miedo intenso, burla, guiño insinuante. El validador rechaza shape keys con esos nombres.

## 6. Estados y movimientos

Estados del componente web y su clip 3D correspondiente (ver `docs/04-expresiones-y-movimientos.md`):

| Estado | Qué hace | Clip(s) |
|---|---|---|
| `hidden` | Oculto al inicio | — |
| `peek` | Asoma tímidamente desde una esquina | `peek_in`, `peek_hold` |
| `enter` | Aparece con un saltito suave | `enter` |
| `greet` | Saluda con la mano | `greet_wave` |
| `idle` | Respiración sutil, parpadeo, mira alrededor | `idle_breathe` + `blink` (+ `look_around`) |
| `curious` | Inclina la cabeza | `curious_tilt` |
| `happy` | Saltito de alegría | `happy_jump` (o `celebrate`) |
| `talking` | Acompaña a una burbuja | `talk_loop` |
| `sleep` | Se duerme tras un rato sin actividad | `sleep_in`, `sleep_loop`, `wake_up` |
| `exit` | Se retira suavemente | `exit` |

Con `prefers-reduced-motion: reduce`: sin saltos ni bucles. Se muestran poses fijas (o la imagen estática) con fundidos suaves.

## 7. Comportamiento

- **Contextual, no aleatorio.** Reacciona a: llegada del visitante, sección visible, interacción con formularios, uso de calculadoras o simuladores, fin de un proceso, clic sobre Rufi y cierre voluntario de mensajes.
- **Bienvenida una sola vez por sesión.**
- **Si el visitante cierra una burbuja, Rufi lo respeta:** no vuelve a hablar por iniciativa propia en esa sesión. Sigue disponible si se le pulsa.
- No interrumpe mientras el visitante escribe en un formulario: espera a que haga una pausa.
- Pocas burbujas y espaciadas: ninguna se repite.
- No tapa contenido ni provoca saltos de maquetación. En móvil se aparta cuando aparece el teclado.
- Accesible: se puede usar con teclado, tiene etiqueta para lectores de pantalla y los textos de las burbujas se anuncian sin interrumpir.
- Ningún elemento decorativo parece un botón.

## 8. Fuente única

- Especificación técnica: `spec/rufi.character.json`.
- Instrucciones permanentes para Claude: `CLAUDE.md`.
- Ningún proyecto crea su propia versión de Rufi: todo parte de este repositorio.
