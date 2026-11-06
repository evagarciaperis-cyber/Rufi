# 07 · Recursos que faltan para el modelo animado definitivo

Lo que **no** se puede producir desde este repositorio con lo disponible, por orden de importancia.

## 1. Pregunta crítica: ¿existe el archivo 3D original?

La imagen oficial tiene todas las señales de ser un **render 3D** (iluminación de estudio, oclusión ambiental, fieltro con microfibra, profundidad de los ojos). Si existe el archivo fuente (`.blend`, `.c4d`, `.max`, `.ma`, `.fbx`, `.obj`, `.ztl`, `.usd`…), es **el recurso más valioso**:

- garantiza fidelidad total a Rufi (es literalmente el mismo personaje);
- ahorra la mayor parte del modelado y del texturizado;
- permite retopologizar, riggear y animar sin interpretar.

**Acción:** preguntar a quien hizo la imagen (agencia, ilustrador 3D o herramienta de IA).

- Si se hizo con IA generativa, **no habrá modelo** y además hay que revisar la titularidad de derechos del diseño antes de invertir en él.
- Si la hizo un artista, pedir el archivo y la licencia de uso y de modificación.

## 2. Si no existe el original: referencias que faltan

| Recurso | Por qué |
|---|---|
| **Vistas ortográficas en pose neutra** (frontal, lateral, trasera; ideal también 3/4 y superior) | Hoy la profundidad de cabeza, cuerpo, cresta y pañuelo es una estimación |
| Primer plano de **ojos cerrados** | Forma del párpado y del contorno al parpadear |
| **Boca cerrada** y otras bocas aprobadas | Base de las shape keys |
| **Hoja de expresiones** aprobada por Reference Home | Que nadie invente gestos |
| Espalda de la **cresta**, del **pañuelo** y del **nudo** | Ocultas en la imagen |
| **Suelas** vistas desde abajo | Forma y grosor |
| Brazo izquierdo **en reposo** | Hoy solo se ve levantado |
| Imagen en mayor resolución (≥ 2048 px) o sin comprimir | Detalle de la fibra para las texturas |

Estas vistas debe dibujarlas o renderizarlas **el autor original o un artista bajo supervisión de Reference Home**. No se deben generar con IA a partir de la imagen: es el camino más rápido para que aparezca «otro Rufi».

## 3. Personas

| Perfil | Tareas | Estimación orientativa* |
|---|---|---|
| Artista 3D de personajes (Blender) | Modelado sobre la plantilla, UV, texturas de fieltro, retopología web | 25–45 h |
| Rigger (puede ser la misma persona) | Pesos, controles, 18+ shape keys | 15–25 h |
| Animador | 14 clips obligatorios + 6 recomendados | 25–45 h |
| Desarrollo web | Componente con three.js, estados, accesibilidad, rendimiento, integración | 15–25 h |

\*Orden de magnitud para planificar, no un presupuesto. Si existe el archivo original, el modelado baja mucho.

## 4. Decisiones de Reference Home

1. Aprobar la **hoja de expresiones** y la lista de expresiones prohibidas (`RUFI.md §5`).
2. Confirmar el **tamaño en pantalla** (propuesta: 96 px en móvil, 120–160 px en escritorio).
3. Aceptar la arquitectura: **imagen estática primero y 3D diferido**, con la imagen como alternativa permanente.
4. **Dispositivo de referencia de gama baja** para las pruebas de rendimiento (por ejemplo, un Android de gama media de hace 3–4 años).
5. **Alojamiento** del GLB y de three.js: en `referencehome.es` (recomendado) o CDN, y su política de seguridad de contenidos (CSP).
6. Derechos y licencia del personaje (ver §1).

## 5. Pasos operativos pendientes

- [ ] **Crear el repositorio** `evagarciaperis-cyber/referencehome-rufi` (privado) y subir este trabajo. No se pudo crear desde la sesión: requiere un paso manual (ver `README.md`).
- [ ] Encargar el modelo, o recuperar el original.
- [ ] Implementar el componente web (`08-runtime-web-plan.md`) cuando exista un GLB válido, o antes con la maqueta para avanzar en paralelo.
- [ ] Integración en la landing del Aval ICO: **no iniciada por indicación expresa**.
- [ ] Conexión con ManyChat: pendiente de definir los flujos y los enlaces (`ig.me`/`m.me`/WhatsApp con `ref`). La landing ya tiene preparado un hueco de configuración (`RH_MASCOTA_CONFIG.manychat`).

## 6. Lo que ya está listo para el artista

- `blender/rufi_rig_template.blend`: esqueleto con nombres y jerarquía del contrato + imagen oficial a escala real.
- `spec/rufi.character.json`: proporciones, paleta, materiales, huesos, shape keys, expresiones, clips y presupuesto.
- `assets/reference/`: guías de proporción, regiones, paleta y primeros planos.
- `blender/scripts/rufi_export_glb.py` + `tools/validate-glb.mjs` + `tools/glb-viewer/`: exportar, validar y comparar con la imagen oficial.
