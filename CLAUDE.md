# CLAUDE.md — instrucciones permanentes para trabajar con Rufi

Este repositorio (`evagarciaperis-cyber/Rufi`, <https://github.com/evagarciaperis-cyber/Rufi>) es la **fuente oficial y única** de Rufi, la mascota de Reference Home. Léelo entero antes de tocar nada relacionado con Rufi en cualquier proyecto.

## Antes de empezar

1. Lee `RUFI.md` (identidad, personalidad, voz, estados, comportamiento).
2. Lee `spec/rufi.character.json` (contrato técnico: huesos, shape keys, expresiones, clips, presupuesto).
3. Revisa el estado del proyecto en `README.md → Estado` y `docs/07-recursos-pendientes.md`.

## Reglas de identidad (no negociables)

- La imagen oficial es `assets/original/mascota.png` (SHA-256 en `RUFI.md`). **No la modifiques, no la regeneres y no la sustituyas.** Para la web usa las copias redimensionadas de `assets/web/`.
- No cambies cara, colores, proporciones, cresta de dos lóbulos granate, pañuelo verde con nudo a la izquierda del personaje, manos sin dedos ni suelas granate.
- No generes con IA "otra versión" de Rufi ni un personaje parecido. Si hace falta arte nuevo (vistas, expresiones), se encarga y lo aprueba Reference Home.
- Expresiones prohibidas: enfado, llanto, miedo intenso, burla, guiño insinuante.

## Reglas de honestidad

- **No afirmes que existe un modelo 3D animable de Rufi mientras no haya un GLB del modelo real que pase `node tools/validate-glb.mjs` sin `--allow-proxy`.** Hoy solo existen el esqueleto, la maqueta gris `PROXY_*` y la especificación.
- Distingue siempre entre **medido** (calculado sobre la imagen), **estimado** (propuesta) y **verificado** (probado en Blender/navegador).
- No digas que el PNG tiene articulaciones: es una imagen plana.
- Rufi no simula IA: sus mensajes son textos predefinidos.

## Reglas de alcance

- Trabaja solo en este repositorio salvo petición explícita.
- **No modifiques la landing del Aval ICO, el CRM de Reference Home ni otros repositorios** sin una orden expresa para ese cambio concreto.
- No toques textos, calculadoras, estructura ni SEO de las landings donde se instale Rufi.

## Reglas técnicas

- Nombres del contrato con sufijo **`_L` / `_R`** (lado del personaje; `_L` = +X en Blender). **Nunca `.L`**: el `GLTFLoader` de three.js elimina los puntos de los nombres de nodo (`eye.L` → `eyeL`). Verificado.
- Blender 4.4+: cuando un clip anima huesos y shape keys a la vez, usa **una sola acción con dos slots** (armature + shape keys). Si son acciones distintas, el exportador crea dos animaciones glTF separadas. Verificado con Blender 5.2.3.
- En los pose bones, rotación/traslación/escala van en **ejes locales del hueso**. En huesos verticales: Y local = arriba/yaw, X = cabeceo, Z = inclinación lateral. Para brazos usa giros alrededor de ejes del mundo (ver `_key_bone` en `blender/scripts/rufi_build_template.py`).
- Texturas en WebP (`EXT_texture_webp`). KTX2 solo si hay muchas: su transcodificador pesa ~254 KB gzip.
- Runtime previsto: three.js (subconjunto ~163 KB gzip), cargado de forma diferida, con la imagen estática como póster y alternativa. Ver `docs/05-evaluacion-blender-gltf-vs-rive.md` y `docs/08-runtime-web-plan.md`.
- Versiones fijadas y con al menos dos semanas de antigüedad (ej. `three@0.186.1`). Nada de `latest`.
- Web: sin estilos globales (Shadow DOM), `position: fixed` (sin CLS), respeta `prefers-reduced-motion`, accesible con teclado y lector de pantalla, sin dependencias pesadas en la carga inicial.

## Comprobaciones antes de entregar

```bash
npm test                                         # validador y contrato
python3 tools/analyze_reference.py               # si cambia la imagen de referencia (no debería)
node tools/validate-glb.mjs ruta/rufi.glb        # cualquier GLB nuevo
```

Si hay Blender disponible: `npm run pipeline:proxy` (plantilla → maqueta → GLB → validación).

Revisión visual: sirve el repo por HTTP y abre `tools/glb-viewer/?src=ruta.glb`; usa «Comparar con la imagen oficial» con el clip `pose_reference`.

## Comportamiento en las webs (resumen de `RUFI.md`)

Bienvenida una vez por sesión · si cierran una burbuja, silencio proactivo el resto de la sesión · no interrumpir mientras escriben · mensajes financieros prudentes («orientativo», «decide el banco», «habla con un asesor») · WhatsApp de Reference Home: +34 674 61 22 72.
