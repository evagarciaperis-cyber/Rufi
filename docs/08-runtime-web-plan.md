# 08 · Plan del componente web (fase 2, no implementado)

Diseño del componente que mostrará a Rufi en las webs. **No hay código de runtime todavía**: este documento fija la arquitectura para que la fase 2 no improvise.

## 1. Instalación prevista

```html
<script>
  window.RufiConfig = { page: 'aval-ico-valencia', /* contexto, panel, disparadores… */ };
</script>
<script src="https://referencehome.es/rufi/rufi.js" defer></script>
```

Un solo archivo JS ligero (sin three.js) que:

1. Crea un `<div>` con **Shadow DOM** (cero estilos globales) en `position: fixed` (sin desplazar contenido, CLS = 0).
2. Muestra al instante la **imagen oficial** (`assets/web/rufi-*.webp`) como póster.
3. Tras `load` + `requestIdleCallback`, o al primer gesto, y solo si hay WebGL y no está activado el movimiento reducido, carga `rufi-3d.js` (subconjunto de three.js, ~163 KB gzip) y `rufi.glb`, y sustituye el póster por el lienzo con un fundido.
4. Si algo falla, se queda con el póster: Rufi siempre se ve.

## 2. Módulos

| Módulo | Responsabilidad |
|---|---|
| `core/states` | Máquina de estados (`hidden`, `peek`, `enter`, `greet`, `idle`, `curious`, `happy`, `talking`, `sleep`, `exit`) con transiciones permitidas |
| `render/poster` | Representación con la imagen estática (alternativa y movimiento reducido) |
| `render/three` | Escena, mezcla de clips (`AnimationMixer`), expresiones (shape keys), parpadeo, mirada, secundarios, pausa fuera de pantalla |
| `ui/bubble` | Burbujas: cola, prioridad, intervalo mínimo, una vez por sesión, respeto al cierre |
| `ui/panel` | Panel de opciones accesible (diálogo no modal, Esc, foco) |
| `context/triggers` | Llegada, sección visible (IntersectionObserver), formularios, calculadoras, fin de procesos (MutationObserver), eventos propios |
| `actions` | Ir a una sección, WhatsApp, enlace, evento; puente con ManyChat |
| `storage` | `sessionStorage` con espacio de nombres y alternativa en memoria |

Interfaz común de renderizado: `setState(nombre)`, `setExpression(nombre, peso)`, `lookAt(x, y)`, `pause()`, `resume()`, `destroy()`. El póster y el 3D la implementan igual, así la lógica no depende de cómo se dibuje.

## 3. Rendimiento

- Lienzo de 96–160 px CSS; `setPixelRatio(min(dpr, 2))`.
- Renderizado bajo demanda: se para con `visibilitychange`, fuera de la vista y en `sleep`; 30 fps en reposo y 60 fps en acciones.
- Sin sombras en tiempo real (sombra de contacto como textura). Una luz direccional + hemisférica, o luz horneada.
- Presupuesto: GLB ≤ 800 KB (máximo 1,5 MB) ya comprimido; nada de esto bloquea la carga inicial.
- Medir en el dispositivo de referencia: fps, tiempo hasta interactivo e INP con Rufi activo.

## 4. Accesibilidad

- Botón con `aria-label` («Rufi, asistente de Reference Home: abrir opciones de ayuda»), `aria-expanded` y `aria-controls`.
- Burbujas en una región `role="status"` (`aria-live="polite"`); botón de cerrar etiquetado.
- El lienzo es decorativo (`aria-hidden`); toda la información está en texto.
- Teclado completo, foco visible, Esc cierra.
- `prefers-reduced-motion`: póster o poses fijas, sin bucles.

## 5. Comportamiento (de `RUFI.md`)

Bienvenida una vez por sesión; tras cerrar una burbuja, silencio proactivo el resto de la sesión; no interrumpir mientras se escribe; pocas burbujas espaciadas y nunca repetidas; mensajes financieros prudentes.

## 6. Configuración para el Aval ICO (borrador, sin aplicar)

Elementos reales detectados en <https://referencehome.es/ICO/aval-ico-valencia.html> (solo lectura):

| Elemento | Selector |
|---|---|
| Test de requisitos | `#test`, resultado en `#q-body .q-res` |
| Simulador | `#simulador`, campos `#precio`, `#tasacion`, `#gastos`; resultado `#sim-figures` (deja de estar oculto) |
| Barra de WhatsApp | `#wa-dock` (en móvil reserva 106 px a la derecha para la mascota) |
| Mascota actual (v0) | `#masc`, configuración `RH_MASCOTA_CONFIG` (se retiraría al integrar Rufi) |

Panel: (1) «¿Puedo solicitar el aval?» → `#test` · (2) «¿Cuánto ahorro necesito?» → `#simulador` · (3) «Quiero hablar con un asesor» → WhatsApp +34 674 61 22 72.

**La landing no se ha modificado.**
