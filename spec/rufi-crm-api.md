# Especificación · comunicación Rufi ↔ CRM (`rufi-crm/1`, contrato 1.1)

Estado: **especificación (fase A)**. Nada de esto está implementado ni desplegado.
- El CRM la implementa en la fase B/C.
- El cargador y el motor 1.1.0 la implementan en la fase D.

Formas exactas de cada mensaje: `spec/rufi-crm-api.schema.json`. Casos que deben pasar ambos
lados: `spec/vectors/`. Comportamiento de referencia del cargador: `spec/reference/decide.mjs`.
Idiomas: `spec/reference/i18n.mjs`.

## 0. Hechos comprobados que condicionan el diseño (6-nov-2026)

| Hecho | Cómo se ha comprobado | Consecuencia |
|---|---|---|
| Vercel: plan **Hobby** | API de Vercel (`billing.plan: "hobby"`, solo lectura) | Las condiciones de Hobby limitan el uso a fines personales no comerciales y los límites de uso **cortan el servicio** en vez de facturar. El diseño **no puede depender** de que la API esté siempre disponible: de ahí el respaldo y la caducidad (§4, §5). Recomendación independiente de Rufi: valorar pasar el CRM a Pro |
| Joomla en producción: **6.2.0** | `https://referencehome.es/administrator/manifests/files/joomla.xml` (público) | El plugin de la fase F debe ser para Joomla 6. Aviso aparte: ese manifiesto público revela la versión exacta a cualquiera. Conviene bloquear `/administrator/manifests/` desde el `.htaccess` de Joomla. No lo he tocado |
| Base de datos de desarrollo | No se asume que exista | Las pruebas de las fases B/C no dependen de una Supabase; se prueban contra un almacén en memoria, como hace `studio3d` en el CRM |

## 1. Principios

1. **La configuración de Rufi es pública por naturaleza**: cualquiera la ve al abrir la página.
   La API solo sirve lo que ya es público. **Nada del CRM** (contactos, operaciones, usuarios,
   autores, borradores, instrucciones o conocimiento de la IA) puede salir por ella. El esquema
   lo garantiza con `additionalProperties: false` en todos los niveles, y las pruebas lo
   comprueban (casos `fuga-de-datos-*`).
2. **CORS no es una medida de seguridad**, solo una cortesía para los navegadores. Las
   protecciones reales están en el servidor (§3).
3. **El CRM puede caer o cortarse (Hobby) sin que se rompa ninguna página**, y sin que una copia
   antigua vuelva a mostrar a Rufi después de apagarlo.
4. **Compatibilidad:**
   - con el `_global.json` local sin `source`, el cargador funciona exactamente como en 1.0;
   - el motor 1.0.0 publicado acepta configuraciones 1.1 y muestra los textos base (probado);
   - toda configuración 1.0 sigue siendo válida en 1.1 (probado), salvo el endurecimiento de
     enlaces (§6).

## 2. Rutas

Base: `https://crm.referencehome.es/api/public/rufi/v1`. Todas son `GET` o `POST` exactos (más
`OPTIONS` para CORS); cualquier otro método devuelve 405.

| Ruta | Para qué | Respuesta |
|---|---|---|
| `GET /pages/{slug}` | Configuración publicada de una página | `pageEnvelope` (200) · `error not_found` (404) |
| `GET /pages/{slug}?preview={token}` | Borrador, solo con token (§3.4) | `pageEnvelope` con `preview: true` · 401 si el token no vale |
| `GET /routes?path={ruta}` | Solo Joomla con fragmento global: ruta → `slug` | `routeResponse` · 404 |
| `POST /chat/session` | Abre una conversación (IA; **404 mientras esté desactivada**) | `chatSessionResponse` |
| `POST /chat` | Un turno de conversación (IA; **404 mientras esté desactivada**) | `chatResponse` |

No existe ninguna ruta que liste páginas, configuraciones ni rutas.

### 2.1 `pageEnvelope`

```json
{
  "api": "rufi-crm/1",
  "slug": "aval-ico-valencia",
  "status": "active",
  "revision": 128,
  "engine": "1.1.0",
  "contract": "1.1",
  "issuedAt": "2026-11-06T10:00:00Z",
  "expiresAt": "2026-11-13T10:00:00Z",
  "config": { "…configuración publicada (spec/rufi-config.schema.json)…": "" }
}
```

- `status`:
  - `active`: incluye `config`, `engine` y `contract`;
  - `disabled`: la página está apagada;
  - `killed`: Rufi está apagado en todo el sitio.

  En `disabled` y `killed` **no** se envía `config`.
- `revision`: contador **del sitio**, siempre creciente. Lo incrementa cada publicación, cada
  apagado y cada encendido, de cualquier página. Sirve para elegir siempre la información más
  reciente (§5).
- `expiresAt`: caducidad dura, entre 1 hora y **30 días** después de `issuedAt`. Por defecto el
  CRM pone 7 días. Pasada esa fecha, nadie puede usar esa copia.
- `config.page` es igual a `slug`. Una configuración con `enabled: false` no se envía: se
  responde `status: disabled`.
- Si la configuración usa campos 1.1, `engine` debe ser ≥ 1.1.0 y `contract` debe ser `1.1`.

### 2.2 Errores

Siempre `{"error": {"code", "message", "retryAfter?"}}`:
- sin trazas, ni detalles de SQL, ni identificadores internos;
- mensajes cortos y genéricos;
- códigos: `bad_request` 400, `unauthorized` 401, `forbidden` 403, `not_found` 404,
  `payload_too_large` 413, `rate_limited` 429 (con `Retry-After`), `unavailable` 503,
  `disabled` 404 en las rutas del chat.

## 3. Autorización y protección frente a abuso

### 3.1 Lectura de configuración (`/pages`, `/routes`)

Los datos son públicos. Lo que se protege es **qué** sale, **cuánto** cuesta servirlo y que no
se pueda descubrir nada.

| Control | Detalle |
|---|---|
| Lista blanca de datos | El CRM construye la respuesta campo a campo a partir del esquema; no copia la fila de la base de datos. La valida con este contrato **antes de responder**; si no pasa, devuelve 503 y lo registra |
| Acceso a datos mínimo | La ruta pública no usa `service_role`. Llama a funciones SQL `SECURITY DEFINER` que solo leen la versión publicada de las tablas `rufi_*` y solo tienen permiso para `anon` |
| Entradas | `slug` con `^[a-z0-9-]{1,64}$`; `path` de hasta 512 caracteres, normalizado (sin `..`, sin dominio, sin `?`/`#`). Lo demás → 400 sin consultar la base de datos |
| Sin enumeración | Una página que no existe y una nunca publicada responden igual (404, mismo cuerpo y mismo tiempo de caché). Una apagada responde `disabled`. Esto no es secreto: se ve en la página |
| Coste acotado | Caché de CDN (§4): la función se ejecuta como mucho una vez por minuto y página, haya el tráfico que haya. Límite por IP (hash con sal) para las peticiones que no salen de la caché (`?preview`, `slug` aleatorios): 120/min |
| Cortafuegos | Regla de Vercel Firewall para `/api/public/rufi/*`, si el plan lo permite (a comprobar en la fase C) |

### 3.2 Chat (`/chat/session`, `/chat`)

Desactivado hasta autorización expresa. Con **doble llave**:
- interruptor de IA del CRM (`rufi_ai_settings.enabled`);
- `ai.enabled` en la configuración publicada de la página.

Si falta cualquiera de las dos → 404 `disabled`.

1. **Billete de conversación.** `POST /chat/session {slug, lang}` devuelve un `ticket`
   `v1.<datos>.<HMAC-SHA256>` firmado con un secreto que solo conoce el servidor. Contiene: id
   aleatorio de sesión, `slug`, hash de la IP, hash del navegador, caducidad de 30 min y máximo
   de mensajes (15). El servidor lleva la cuenta de mensajes por billete. Sin billete válido →
   401.
2. **Límites atómicos en SQL**, separados de la cuota de IA del equipo del CRM. Los visitantes
   nunca consumen la del equipo:
   - por billete: 15 mensajes;
   - por hash de IP: 3 billetes/hora y 40 mensajes/hora;
   - global: tope diario de mensajes;
   - gasto: tope mensual con reserva previa del coste máximo de cada llamada, como
     `studio3d/ai/budget.ts`.

   Al llegar al tope global, el chat se apaga solo hasta el día siguiente.
3. **Entradas acotadas** (esquema `chatRequest`):
   - 6 mensajes de historial como máximo, de 500 caracteres cada uno;
   - solo los roles `user` y `assistant`: el cliente **nunca** puede mandar instrucciones de
     sistema;
   - cuerpo de 8 KB como máximo (413).
4. **Señales de origen** (ayudan, pero no autentican):
   - `Origin` exacto (`https://referencehome.es` o `https://www.referencehome.es`);
   - `Sec-Fetch-Site: same-site`;
   - si faltan o no coinciden → 403.
5. **Datos personales:**
   - antes de enviar a Groq se quitan teléfonos, correos, DNI/NIE e IBAN;
   - no se guarda el texto de las conversaciones, solo contadores;
   - la IP nunca se guarda en claro.
6. **Respuesta acotada** (`chatResponse`):
   - 1200 caracteres como máximo;
   - la derivación solo puede ser `https://wa.me/<número>`.
7. **Escalada opcional**, solo con autorización: verificación anti-bots sin datos personales
   (por ejemplo, Cloudflare Turnstile, gratuita). Es un tercero, así que no va por defecto.

### 3.3 CORS

- `Access-Control-Allow-Origin`: el `Origin` recibido **solo si** es uno de los dos permitidos;
  si no, la cabecera no se envía.
- `Vary: Origin`.
- Sin `Allow-Credentials`: no viajan cookies.
- `Access-Control-Allow-Methods: GET` en `/pages` y `/routes`, `POST` en `/chat*`.
- `Access-Control-Max-Age: 600`.

### 3.4 Vista previa

- Token `v1.<claims base64url>.<HMAC-SHA256 base64url>`. Los claims están en el esquema
  `previewClaims`: `{v:1, slug, draft, exp, nonce}`, con `exp` ≤ 10 min.
- Solo lo emite el CRM para un administrador con sesión, y sirve para un único borrador y una
  única página.
- El servidor comprueba la firma con `timingSafeEqual`, la caducidad y que `slug` coincide.
- Respuesta con `Cache-Control: no-store`.
- El cargador:
  - no guarda nunca una vista previa;
  - no usa respaldo si falla;
  - quita el token de la URL (`history.replaceState`).

## 4. Caché

| Dónde | Qué | Valor |
|---|---|---|
| CDN de Vercel | `/pages/*` y `/routes` | `Cache-Control: public, max-age=0, s-maxage=60, stale-while-revalidate=300, stale-if-error=86400` + `ETag: "r<revision>"` |
| CDN | 404 | `public, max-age=0, s-maxage=60` |
| CDN | vista previa, chat y errores 4xx/5xx del chat | `no-store` |
| Navegador (HTTP) | `/pages/*` | `max-age=0`: se revalida en cada visita con el `ETag` (304 barato desde la CDN) |
| Navegador (`localStorage`) | último sobre válido por página (`rufi:env:<slug>`), **incluidas las marcas de apagado** | Hasta su `expiresAt` |
| Arsys `/rufi/configs/<slug>.json` | respaldo estático, exportado desde el CRM con el mismo formato de sobre | Hasta su `expiresAt` (≤ 30 días) |
| Arsys `/rufi/configs/_global.json` | interruptor local | 5 min (`.htaccess` de la fase 7) |
| Arsys `/rufi/v/<versión>/` | motor | 1 año, `immutable` (no cambia) |

- **Al publicar o apagar**, el CRM incrementa `revision` y, si Vercel lo permite en el plan,
  purga la caché de `/pages/{slug}` (o de todas en un apagado global). Sin purga, el cambio
  llega en **≤ 1 min** con tráfico. En el peor caso (una página sin visitas que recibe una
  visita justo después) llega en **≤ 6 min**: la primera visita recibe la copia antigua mientras
  la CDN se actualiza.
- `stale-if-error=86400`: si la función o Supabase fallan, la CDN puede seguir sirviendo la
  última respuesta buena hasta 24 h. Así las páginas siguen funcionando, pero **un apagado hecho
  durante una caída del CRM no llega**. Para eso existe el apagado local (§5.1).

## 5. Apagado de emergencia y caducidad

### 5.1 Interruptores, de mayor a menor prioridad

| # | Interruptor | Dónde | Llega en | Depende del CRM |
|---|---|---|---|---|
| 1 | `?rufi=off` | URL | inmediato (solo esa visita) | No |
| 2 | `_global.json` → `"enabled": false` (o `disabledPages`) | **Arsys** | ≤ 5 min | **No** |
| 3 | Apagado global en el CRM (`status: killed`) | CRM | ≤ 1 min (≤ 6 min en el peor caso) | Sí |
| 4 | Página apagada en el CRM (`status: disabled`) | CRM | igual que el 3 | Sí |
| 5 | Caducidad (`expiresAt`) | en cada sobre | automática | No |

- `?rufi=on` solo salta los interruptores **locales** (2). Nunca salta un apagado del CRM (3, 4).
- **Procedimiento ante un problema grave:**
  - primero el 3 (CRM);
  - si el CRM no responde o hay que garantizarlo, el 2 por FTP, que no depende de nada;
  - además, quitar `"source"` de `_global.json` vuelve al modo 1.0 con los archivos estáticos.

### 5.2 Reglas de decisión del cargador (modo API)

Implementación de referencia en `spec/reference/decide.mjs`; 26 casos en
`spec/vectors/decision.json`.

1. Los interruptores 1 y 2 van primero.
2. Sin `source` en `_global.json` → comportamiento 1.0.
3. Vista previa → solo la API; si falla, no carga.
4. La API responde 404 → no carga y borra la copia del navegador. Es una respuesta firme, no un
   fallo.
5. Entre la respuesta de la API, la copia del navegador y el respaldo estático, se descarta todo
   lo que no sea **válido** (esquema), **de esta página** y **sin caducar**. De lo que queda,
   **gana la `revision` más alta**. A igual revisión, el orden es API, copia, respaldo.
6. Si gana un `killed` o `disabled`, no se carga. Si venía de la API, se guarda como marca en el
   navegador.

Consecuencias, probadas en los casos:
- un respaldo antiguo **no resucita** a Rufi después de un apagado;
- una respuesta antigua de la CDN no pisa una más reciente que el navegador ya conocía;
- un respaldo exportado **después** del apagado sí se usa;
- con el CRM caído, la página funciona con la copia o el respaldo hasta su caducidad, y después
  Rufi deja de mostrarse. La página nunca se rompe: todo es diferido, con un tiempo máximo de
  2,5 s (`timeoutMs`, configurable entre 500 y 5000).

Limitación conocida: un visitante que nunca ha pasado por el sitio, con el CRM caído y un
respaldo estático anterior al apagado, verá a Rufi hasta que caduque el respaldo. Se evita con el
interruptor local o con un respaldo de caducidad corta.

### 5.3 Respaldo estático

- Lo genera el CRM («Exportar respaldo») con el mismo formato de sobre (`fallbackFile`).
- Se sube **a mano** por FTP a `/rufi/configs/<slug>.json`. No hay conexión automática entre el
  CRM y Arsys, por decisión de arquitectura.
- En modo API **no se usan** los archivos de configuración 1.0 (sin sobre). Solo se usan sobres
  válidos y sin caducar.

## 6. Contrato de configuración 1.1 (resumen)

Todos los cambios son **opcionales**. Ninguno pasa a ser obligatorio (comprobado).

| Campo nuevo | Para qué |
|---|---|
| `contract` | `"1.0"` o `"1.1"`. Si se pone `1.0`, no se admiten campos 1.1 |
| `lang` | Idioma de los textos base: `es` (por defecto), `en`, `fr`, `it` o `de` |
| `i18n` | Traducciones por idioma. Lo que falte se ve en el idioma base. Las acciones (destinos, enlaces, números) no se traducen; solo los textos y los mensajes de WhatsApp |
| `ai` | `{enabled, notice, greeting}`. Con `enabled: true`, `notice` es obligatorio en **todos** los idiomas y debe decir «IA» / «AI» / «KI». También hace falta `whatsapp.number` para derivar a una persona. Las instrucciones y el conocimiento de la IA **nunca** van aquí: el esquema los rechaza |

Endurecimientos (seguridad): `href` solo `https://…`, rutas del mismo sitio (`/…`) o anclas
(`#id`). Prohibidos `javascript:`, `data:`, `http:` y `//host`. Mensajes de WhatsApp de 1000
caracteres como máximo. Ninguna configuración del repositorio se ve afectada (comprobado).

Idioma que usa Rufi: el de la página (`<html lang>`), después el del navegador y después el
base, siempre entre los disponibles. Rufi habla el idioma de la página para que sus botones
coincidan con lo que se ve. El chat de IA responde en el idioma de cada mensaje del visitante.

Compatibilidad de motor: una configuración con campos 1.1 necesita el motor ≥ 1.1.0. El
validador lo marca como error si `version` es menor y como aviso si no se indica versión. Con el
motor 1.0.0 la configuración no rompe nada: se ven los textos base y no aparece el chat (probado
en el navegador con el motor publicado).

## 7. Versionado de este contrato

- `rufi-crm/1` y el contrato 1.1 solo pueden **ampliarse** con campos opcionales. Quitar o
  cambiar algo exige `rufi-crm/2` y una ruta `/v2`, y las dos conviven durante la transición.
- El CRM **fija** una copia de `spec/rufi-config.schema.json`, `spec/rufi-crm-api.schema.json` y
  `spec/vectors/`, con su huella SHA-256, y una prueba en el CRM falla si no coinciden. Se
  actualizan a la vez en los dos repositorios.
- El esquema 1.0 queda congelado en `spec/contract/1.0/` (huella comprobada en las pruebas).
