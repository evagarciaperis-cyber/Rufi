# Especificación · comunicación Rufi ↔ CRM (`rufi-crm/1`, contrato 1.1)

Estado: **especificación (fase A)**. Nada implementado ni desplegado.

Decisión aprobada (opción A, `docs/19`):
- el CRM **publica archivos estáticos** en Supabase Storage;
- Rufi los lee directamente;
- Vercel solo atiende la vista previa y el chat (apagado);
- sin FTP habitual.

Dónde está cada cosa:

| Qué | Archivo |
|---|---|
| Formas exactas | `spec/rufi-crm-api.schema.json` |
| Casos compartidos | `spec/vectors/` |
| Referencias (funciones puras) | `spec/reference/decide.mjs` (cargador), `publish.mjs` (orden de publicación y control de subida), `routes.mjs` (rutas de Joomla), `i18n.mjs` (idiomas) |
| Medición real de tiempos | `tools/measure-propagation.mjs` |

## 0. Hechos que condicionan el diseño

| Hecho | Fuente | Grado |
|---|---|---|
| Vercel en plan **Hobby** | API de Vercel, solo lectura | **Comprobado** |
| Joomla **6.2.0** en producción | manifiesto público de Joomla | **Comprobado** |
| Supabase en plan **Pro**, con *spend cap* | `docs/VIDEO_VALORACION_RENDER_REMOTO.md` del CRM («confirmado en el panel», 04-11-2026) | **Documentado** por el equipo. No lo he podido ver yo: la herramienta de solo lectura no muestra la facturación y no ejecuto SQL |
| En Pro, **Smart CDN** está activo y **invalida la caché al sobrescribir un archivo**, con propagación de **hasta 60 s**. Los parámetros de consulta no saltan la caché. Purga manual disponible (hasta 60 s) | documentación de Supabase (`storage/cdn/smart-cdn`, `purge-cdn-cache`) | **Documentado por Supabase. NO verificado con pruebas** |
| Pro: 250 GB de salida sin caché + 250 GB con caché al mes. Con *spend cap*, si se supera, Supabase puede **restringir el servicio (HTTP 402)** | documentación de Supabase (egress, FAQ de facturación) | Documentado |
| El cargador pide sus JSON con `cache: 'no-cache'`: revalida en cada visita | `src/loader.js:32` | **Comprobado** |

**Ningún tiempo de este documento es una promesa.** Los marcados como «objetivo» se miden en
la fase B con `tools/measure-propagation.mjs` contra una cubeta **de pruebas**, y la
documentación se corrige con lo medido.

## 1. Principios

1. La configuración de Rufi es pública por naturaleza. **En la cubeta pública solo hay archivos
   del contrato**, controlados uno a uno antes de subirlos (§4). Nada del CRM puede salir:
   contactos, operaciones, usuarios, borradores, versiones, ajustes o conocimiento de la IA.
2. Supabase Storage no tiene transacciones entre archivos. Por eso **cada archivo es
   autosuficiente**: lleva su `revision` y su caducidad. El apagado del sitio es **un solo
   archivo**.
3. **Las marcas de apagado ganan**: entre lo que llega y lo que el navegador ya conocía, gana la
   `revision` más alta, y un apagado es también una revisión (§5).
4. **Sin estado, no se carga**: si no se puede saber si el sitio está apagado, Rufi no aparece.
   La página nunca se ve afectada.
5. **Compatibilidad:**
   - el cargador 1.0.0 publicado ignora `source` y sigue con sus archivos estáticos;
   - el motor 1.0.0 acepta configuraciones 1.1 (probado: `tests/e2e/compat-1.1.e2e.cjs`);
   - las configuraciones 1.0 siguen siendo válidas;
   - no se modifica ninguna landing.

## 2. Archivos públicos (Supabase Storage)

Cubeta **`rufi-public`**, nueva y exclusiva para esto. **Nunca** se reutiliza otra cubeta del
CRM. Base:

```
https://<proyecto>.supabase.co/storage/v1/object/public/rufi-public/v1/
```

| Archivo | Forma (esquema) | Contenido |
|---|---|---|
| `status.json` | `statusFile` | Estado global: `active` o `killed`, `revision`, `issuedAt` y `expiresAt` |
| `pages/<slug>.json` | `pageEnvelope` | Página: `active` (con `config`, `engine`, `contract`), `disabled` o `killed` |
| `routes/<sha256>.json` | `routeFile` | Solo Joomla con fragmento global: el nombre es el SHA-256 de la ruta normalizada (`routes.mjs`). Contenido: `slug`, `revision` y caducidad |

- Son las **únicas** rutas que se pueden escribir: `publicObjectPath`, comprobado en cada subida.
- Subida con `contentType: application/json`, `upsert: true` y `cacheControl: "30"` (para el
  navegador; el cargador revalida igualmente).
- La `revision` sale de un contador **del sitio** en la base de datos del CRM: sube con cada
  publicación, apagado o encendido, nunca se repite ni baja.
- `expiresAt`: **7 días**, renovada a diario por una tarea programada del CRM (§6.4). Máximo
  según el esquema: 30 días.
- El sobre `pageEnvelope` es el mismo que en la versión anterior de esta especificación. Se
  añaden `statusFile` y `routeFile`; `routeResponse` desaparece.

### 2.1 API dinámica de Vercel (sin tráfico de visitantes)

Base: `https://crm.referencehome.es/api/public/rufi/v1`.

| Ruta | Para qué |
|---|---|
| `GET /pages/{slug}?preview={token}` | Vista previa de un borrador para un administrador. Token HMAC de ≤ 10 min, una página. Respuesta `no-store` |
| `POST /chat/session` · `POST /chat` | Chat de IA. **404 mientras esté desactivado.** Controles de abuso en §7 |

La configuración pública **no** pasa por Vercel: si Vercel se cae o corta el servicio por los
límites de Hobby, Rufi no se ve afectado.

### 2.2 `_global.json` local (Arsys)

```json
{ "enabled": true, "version": "1.1.0", "disabledPages": [],
  "source": { "static": "https://<proyecto>.supabase.co/storage/v1/object/public/rufi-public/v1",
              "api": "https://crm.referencehome.es/api/public/rufi/v1",
              "timeoutMs": 2500, "recheckSeconds": 300 } }
```

- Sin `source.static`, el comportamiento es el de 1.0.
- `recheckSeconds` (entre 60 y 3600) es el intervalo de revisión de las páginas abiertas (§5.3).

## 3. Orden de publicación y fallos a medias

Referencia: `publish.mjs`. Probado en
`tests/contract.test.mjs › publicación a medias`, cortando en cada paso posible.

| Operación | Escrituras, en este orden | Si se corta a medias |
|---|---|---|
| Apagar el sitio | `status.json` (`killed`) | Es **una** escritura: o se apaga o no cambia nada |
| Encender el sitio | `status.json` (`active`, revisión mayor) | Igual |
| Publicar una página | 1) rutas nuevas, 2) `pages/<slug>.json`, 3) borrar rutas antiguas | Tras 1: la ruta nueva apunta a una página aún sin publicar → 404 → Rufi no aparece, o se ve la versión anterior completa. Tras 2: versión nueva completa, quedan rutas antiguas sin borrar |
| Apagar una página | 1) `pages/<slug>.json` (`disabled`), 2) borrar sus rutas | Tras 1 ya está apagada aunque queden rutas |
| Renovación diaria | `status.json` y después cada página y ruta, con la misma revisión y nueva caducidad | Cada archivo queda renovado o como estaba. Si el sitio está apagado, sigue apagado |

Garantía probada: **en ningún punto de corte se muestra algo distinto de la versión anterior
completa, la nueva completa o nada**. Nunca se muestra contenido que debía estar apagado.

Lo que debe hacer el CRM:
- **Una publicación a la vez** por sitio, con un bloqueo en la base de datos.
- **Diario de pasos**: la operación queda «incompleta» hasta confirmar todas las escrituras.
- **Confirmación por lectura**: tras subir, vuelve a leer cada archivo con la clave de
  servicio, sin pasar por la CDN, y compara la `revision`.
- **Reintentos** automáticos y botón «Reintentar».
- Un **apagado incompleto** se avisa como **URGENTE**, con las vías alternativas (§6.2).
- Si el control de subida rechaza un archivo, la operación se para y no se escribe nada más.

## 4. Nada privado en la cubeta pública

| Medida | Dónde |
|---|---|
| Cubeta exclusiva `rufi-public`. Los borradores, versiones, copias, ajustes e instrucciones de la IA viven **solo en tablas** del CRM con RLS de administrador, nunca en archivos públicos | Diseño (fase B) |
| **Control de subida** `guardPublicObject` antes de cada escritura: ruta en la lista permitida, JSON del contrato válido (sin campos de más en ningún nivel), sin caducar, `slug` igual al nombre del archivo, nunca una vista previa, tamaño ≤ 64 KB | `publish.mjs`. Probado con 14 rutas prohibidas (borradores, copias, IA, `..`, mayúsculas, `v2`…) y con contenidos inválidos (datos del CRM, instrucciones de IA, vista previa, caducado) |
| Solo el servidor del CRM escribe, con `service_role`. **Sin políticas** de `insert`, `update` o `delete` para `anon` ni para usuarios autenticados en `rufi-public` | Fase B (migración, sin ejecutar) |
| **Sin listado público**: en una cubeta pública se pueden leer archivos sueltos, pero listarlos depende de una política `select`, y no se crea | Fase B. Se verifica de verdad (fila siguiente) |
| **Pruebas reales en la fase B** contra la cubeta de pruebas: listar como anónimo → vacío o denegado; subir, sobrescribir y borrar como anónimo y como usuario autenticado sin rol → denegado; pedir una ruta no permitida → 404 | Fase B (pendiente de autorización) |
| **Auditoría diaria**: la tarea del CRM lista la cubeta con la clave de servicio y pasa cada archivo por `guardPublicObject`. Si sobra algo, se borra y se avisa | Fase B |

## 5. Caché, revisión y visitantes

### 5.1 Capas

| Capa | Comportamiento |
|---|---|
| CDN de Supabase (Smart CDN) | Guarda los archivos e invalida al sobrescribir. **Objetivo ≤ 60 s** según Supabase; **por medir** |
| Purga manual (opcional) | El CRM puede purgar `status.json` y la página tras un apagado. Supabase también indica hasta 60 s; por medir si mejora algo |
| Navegador, HTTP | El cargador revalida en cada visita (`no-cache`): no usa copias sin preguntar |
| Navegador, `localStorage` | Último `status` y última página válidos, **incluidas las marcas de apagado**. Solo se usan si Storage no responde en `timeoutMs` (2,5 s), y siempre respetando `revision` y `expiresAt` |

### 5.2 Reglas del cargador

Referencia: `decide.mjs`. 30 casos en `decision.json`, más una prueba exhaustiva de 625
combinaciones.

1. `?rufi=off`.
2. `_global.json` local apagado o `disabledPages`. `?rufi=on` solo salta estos interruptores
   locales.
3. Sin `source.static` → comportamiento 1.0.
4. Vista previa: solo con la API dinámica, sin copias; si falla, no carga.
5. **Estado global**: entre el remoto y la copia, válidos y sin caducar, gana la revisión más
   alta. `killed` → no carga. **Sin ningún estado válido → no carga.**
6. **Página**:
   - un 404 con el estado remoto obtenido → no carga y borra la copia;
   - entre la remota y la copia gana la revisión más alta;
   - `disabled` o `killed` → no carga.
7. `?rufi=on` nunca salta un apagado del CRM.

**Prioridad de las marcas de apagado (probada de forma exhaustiva):** en las 625 combinaciones
de estado y página, remotos y en copia, si la información más reciente es un apagado o no hay
estado, el cargador **nunca** muestra a Rufi.

### 5.3 Los tres tipos de visitante

| | Visitante **nuevo** | Visitante **que vuelve** (recarga o entra otro día) | **Página que sigue abierta** |
|---|---|---|---|
| Qué lee | `status.json` + su página (en paralelo) | Lo mismo. Su copia solo si Storage no responde | Motor ≥ 1.1.0: vuelve a leer `status.json` y su página cada `recheckSeconds` (300 s) con la pestaña visible, al volver a la pestaña y al recuperar la conexión. Motor 1.0.0: **no vuelve a mirar** hasta recargar |
| Tras un apagado | Lo ve cuando la CDN lo sirve: **objetivo ≤ 60 s, por medir** | Igual. Su copia no lo contradice, porque gana la revisión más alta | 1.1.0: **≤ 300 s + propagación de la CDN** (objetivo ≤ 6 min, por medir). Rufi sale y no vuelve hasta recargar. 1.0.0: **hasta que recargue la página** |
| Si Storage no responde | **No ve a Rufi** (sin estado no se carga). La página no se ve afectada | Usa su copia si es válida. Si su copia era un apagado, sigue apagado | Se queda como está: un corte no oculta a Rufi, y tampoco puede enterarse de un apagado. Si su copia ya conocía un apagado, sale |
| Si Vercel no responde | Sin efecto | Sin efecto | Sin efecto (solo afecta a vista previa y chat) |

## 6. Apagado

### 6.1 Ordinario

En el CRM: «Apagar página» o «Apagar Rufi en todo el sitio».
- Escribe la página con `disabled` o `status.json` con `killed`, con una revisión nueva.
- Visitantes nuevos y que vuelven: **objetivo ≤ 60 s** (Smart CDN; por medir).
- Páginas abiertas: **objetivo ≤ 6 min** con el motor 1.1.0; hasta recargar con el 1.0.0.

### 6.2 Urgente

| Vía | Cuándo | Cómo | Llega a nuevos y a los que vuelven | Depende de |
|---|---|---|---|---|
| U1 | El CRM funciona | CRM → «Apagado urgente»: escribe `status.json` `killed`, **purga la CDN** de `status.json`, lo confirma leyendo el archivo y avisa a todos los administradores | objetivo ≤ 60 s (por medir) | Vercel + Supabase |
| U2 | El CRM (Vercel) no abre | Panel web de Supabase → Storage → `rufi-public/v1/status.json` → subir el archivo «apagado» preparado (procedimiento en la documentación del panel, fase B). Sin FTP | objetivo ≤ 60 s (por medir) | Supabase |
| U3 | Último recurso, no depende de nada más | FTP a Arsys: `/rufi/configs/_global.json` → `"enabled": false` | **en la siguiente carga de página** (el cargador revalida). A medir también en el Arsys real, por si el hosting tiene una caché intermedia | Arsys |

Para volver a encender:
- tras U1 o U2, «Encender» en el CRM (revisión nueva);
- tras U3, volver a poner `true` por FTP. U3 manda sobre el CRM a propósito.

Ninguna vía saca a Rufi de una página **abierta con el motor 1.0.0**: hace falta recargar. Con
el 1.1.0, se aplica el tiempo de revisión de §5.3.

### 6.3 Fallos durante un apagado

| Caso | Resultado | Qué hacer |
|---|---|---|
| Falla la escritura de `status.json` (U1) | Nada cambia. El CRM lo marca como incompleto y urgente | Reintentar, o usar U2 o U3 |
| Supabase restringido (por ejemplo, HTTP 402 por *spend cap*) o caído | Los visitantes nuevos no ven a Rufi; los que vuelven usan su copia (un apagado ya visto se respeta) | U3 si hace falta garantizarlo |
| La CDN tarda en invalidar | Se ve el estado anterior hasta que se invalida | Medir en la fase B; U1 añade purga |
| La copia del navegador está «activa» y Storage no responde | Ese visitante ve a Rufi hasta que caduque la copia (≤ 7 días) o hasta U3 | U3 |

### 6.4 Caducidad

- Todos los archivos caducan a los **7 días** y la tarea diaria del CRM los renueva. Vercel
  Hobby permite tareas diarias; el CRM ya tiene varias.
- Si la renovación se para, Rufi desaparece solo como mucho en 7 días: el diseño falla cerrado.
  El CRM muestra un aviso en cuanto falta una renovación.
- Las copias del navegador caducadas se borran y no se usan.

## 7. Chat de IA (desactivado)

Sin cambios respecto a la versión anterior. Solo funciona con **doble llave**: activado en el
CRM y `ai.enabled` en la página publicada.

- Billete de conversación firmado (HMAC), de 30 min y como máximo 15 mensajes.
- Límites atómicos por billete y por IP (guardada con hash y sal), separados de la cuota de IA
  del equipo del CRM.
- Tope diario y tope de gasto con reserva previa del coste.
- Entradas acotadas: máximo 6 mensajes de 500 caracteres, solo los roles `user` y `assistant`,
  cuerpo de 8 KB como máximo.
- `Origin` y `Sec-Fetch-Site` como señales, **no** como autenticación.
- Se quitan teléfonos, correos, DNI/NIE e IBAN antes de enviar a Groq.
- No se guardan conversaciones.
- Derivación solo a `wa.me`.
- CORS con orígenes exactos, sin credenciales.
- **CORS no es autenticación.**

## 8. Contrato de configuración 1.1 (sin cambios en esta revisión)

| Campo nuevo | Para qué |
|---|---|
| `contract`, `lang` | Versión del contrato e idioma base |
| `i18n` | Textos en es, en, fr, it y de |
| `ai` | Aviso de IA obligatorio en cada idioma y `whatsapp.number` para derivar. Nunca instrucciones |

- Endurecimientos: enlaces solo `https://`, `/…` o `#id`; mensajes de 1000 caracteres como
  máximo.
- Compatibilidad: toda configuración 1.0 es válida en 1.1. El motor 1.0.0 muestra los textos
  base de una configuración 1.1 (probado).
- Idioma: el de la página (`<html lang>`), después el del navegador y después el base. El chat
  responde en el idioma del visitante.

## 9. Versionado

- `rufi-crm/1` solo se amplía con campos opcionales. Para romper algo hace falta `rufi-crm/2`
  con rutas `v2/` y convivencia de las dos.
- El CRM fija la copia del contrato: `spec/contract/1.1.sha256`.
- El esquema 1.0 está congelado en `spec/contract/1.0/`.
- Si cambia el contrato: `npm run contract:hash` y avisar de que hay que actualizar la copia
  del CRM.
