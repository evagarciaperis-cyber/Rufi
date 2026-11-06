# 17 · Rufi Admin en el CRM + API pública mínima — diseño técnico (pendiente de autorización)

Fecha: 6-nov-2026. Estado: **solo diseño**. No hay código, ni SQL ejecutado, ni cambios en el CRM,
ni despliegues. Sustituye al diseño PHP de `16-rufi-admin-ia-diseno.md`, que se conserva como
referencia.

Decisión de Reference Home:
- Rufi Admin pasa a ser un módulo **«Rufi»** dentro del CRM (`crm.referencehome.es`: Next.js
  16.4, Supabase, Vercel).
- Rufi 3D sigue en `referencehome.es/rufi/` (Arsys).
- Los dos sistemas se comunican **solo por una API HTTPS**. No hay FTP compartido ni servidor
  común.
- Los repositorios siguen separados.

---

## 1. Lo analizado

### Repositorio Rufi (`evagarciaperis-cyber/Rufi`, rama `fase-7-centralizado`)

| Pieza | Situación | En el diseño |
|---|---|---|
| Cargador `src/loader.js` → `/rufi/rufi.js` | Lee `configs/_global.json`, `_routes.json` y `configs/<página>.json`, decide si carga y descarga `v/<versión>/rufi-core.js` | Se le **añade** una fuente remota (la API del CRM). Lo que ya existe no cambia: sin la nueva clave en `_global.json` se comporta igual que hoy |
| Núcleo, 3D, GLB y póster en `v/1.0.0/` | Animaciones reales, probado (148/148) | **Intactos.** Idiomas y chat van en `v/1.1.0/`. `rufi-3d.js` y el GLB se copian **idénticos byte a byte** |
| `spec/rufi-config.schema.json` + `tools/validate-config.mjs` | Contrato de configuración sin código | Pasa a ser el **contrato entre los dos repositorios** (versión 1.1, solo con campos nuevos opcionales) |
| `configs/*.json` (Aval ICO, pruebas, plantillas) | Configuraciones válidas | Datos iniciales para Supabase y respaldo estático en Arsys |
| Pruebas: cargador 53, componente 148, paquete 48 | Pasan | Se amplían con «API caída / lenta / inválida» |
| Núcleo: textos con `textContent` | Comprobado | Un texto malicioso no puede ejecutar código. Punto débil detectado: los `href` de acciones `link` se asignan sin filtrar. Se corrige en 1.1.0 |

### Repositorio CRM (`evagarciaperis-cyber/mini-crm-referencehome`)

Solo lo he leído. No he modificado nada.

| Pieza existente | Qué hace | Cómo la aprovecha el módulo Rufi |
|---|---|---|
| `lib/supabase/proxy.ts` (middleware) | Exige sesión salvo en rutas públicas declaradas **una a una con expresiones exactas y método** (visita 3D, informes…) | Se añaden **dos** patrones exactos para la API pública de Rufi. El resto de `/api` sigue cerrado |
| `lib/auth/permission-catalog.ts` + `f_my_access()` + `profile_permissions` | Roles `admin` / `agent` / `consultor`; consultor deniega por defecto | Permisos nuevos `rufi.view`, `rufi.manage`, `rufi.ai.manage`. Al principio solo admin |
| `lib/auth/requireAdmin.ts` (`getRequester`) | Identidad siempre desde la sesión, nunca del cliente | Todas las API internas de Rufi lo usan |
| `lib/security/aiRateLimit.ts` + `consume_ai_quota` (SQL) | Límites de IA por usuario, que fallan cerrados | Mismo patrón, pero en **cubos separados para visitantes anónimos**: el público nunca consume la cuota de IA del equipo |
| `lib/studio3d/ai/budget.ts` | Reserva el coste máximo antes de llamar a la IA y lo liquida después | Mismo patrón para el tope diario/mensual del chat |
| `lib/studio3d/proposals/service.ts` (`clientIp` + `ipKey(sal, ip)` + `store.hit`) | Límites anónimos por IP con hash y sal | Mismo patrón para la API pública |
| SDK `openai` (ya instalado) | Usado con OpenAI | Groq es compatible con la API de OpenAI (`baseURL https://api.groq.com/openai/v1`): **no hace falta otra dependencia** |
| `AdminSidebar.tsx`, `DESIGN.md`, `BRAND.md`, Tailwind 4, `lucide-react` | Interfaz y sistema de diseño | El módulo usa los mismos componentes y el mismo estilo |
| `tests/<módulo>/` | Pruebas por módulo | `tests/rufi/` |
| Supabase | 176 migraciones; ninguna con `rufi` | Tablas nuevas con prefijo `rufi_`, sin tocar ninguna existente |

Vercel: proyecto en el equipo `eva garcia peris' projects`. La API no me muestra el plan
contratado; ver §7.

---

## 2. Arquitectura

```
          CRM (crm.referencehome.es · Vercel + Supabase)                       referencehome.es (Arsys)
┌──────────────────────────────────────────────────────────┐        ┌─────────────────────────────────────┐
│ Módulo «Rufi» /admin/rufi  (sesión + permisos del CRM)   │        │ /rufi/rufi.js  (cargador)            │
│   páginas · editor · idiomas · plantillas · versiones    │        │   1) ?rufi=off / _global.json local  │
│   · activación · IA (preparada, apagada)                 │        │   2) API del CRM ─────────────┐      │
│        │ API internas /api/admin/rufi/* (sesión)         │        │   3) si falla: configs/*.json │      │
│        ▼                                                 │        │   4) carga v/<versión>/       │      │
│ Supabase: rufi_* (RLS solo admin)                        │        │ /rufi/configs/ (respaldo)     │      │
│   ── función SECURITY DEFINER: solo lo PUBLICADO ──┐     │        │ /rufi/v/1.0.0/ /rufi/v/1.1.0/ │      │
│                                                    ▼     │        └───────────────────────────────┼──────┘
│ API pública /api/public/rufi/v1/* (sin sesión, CORS     │◄──────────── HTTPS, sin cookies ────────┘
│   solo referencehome.es, caché CDN)                      │
│   GET config · POST chat (apagado)                       │──► GroqCloud (solo desde el servidor; apagado)
└──────────────────────────────────────────────────────────┘
```

Principios:

1. **El CRM es el editor; Rufi es el lector.** Rufi no sabe nada del CRM salvo una URL pública y
   un formato de JSON (el esquema). Sin el CRM, Rufi sigue funcionando con el respaldo.
2. **La API pública solo devuelve lo publicado y solo los campos del esquema.** Nunca datos de
   contactos, operaciones ni usuarios. La IA **no tiene acceso a datos del CRM**: se le dan las
   instrucciones y el conocimiento aprobados para Rufi, y nada más.
3. **Publicación controlada:** borrador → vista previa → publicar (crea una versión) →
   restaurar cualquier versión.
4. **Respaldo local en tres niveles:**
   - (a) versiones guardadas en Supabase;
   - (b) exportación JSON desde el CRM, que puede subirse a `/rufi/configs/` como copia
     estática de emergencia;
   - (c) el navegador del visitante guarda la última configuración válida.

---

## 3. Qué se modifica en el repositorio del CRM

Todo en una rama nueva. **Ningún módulo existente cambia de comportamiento.** Los únicos
archivos existentes que se tocan son los tres marcados como **[existente]**, con añadidos
mínimos.

### 3.1 Base de datos: `supabase/migrations/2026xxxx_rufi_module.sql` (nueva; no la ejecuto)

| Tabla | Contenido |
|---|---|
| `rufi_settings` (una fila) | interruptor global, versión del motor por defecto, orígenes permitidos para CORS, `config_revision` |
| `rufi_pages` | `slug` (`^[a-z0-9-]+$`), URL o prefijo, tipo (`landing` / `joomla`), activa sí/no, plantilla, idioma por defecto, versión del motor, id de la versión publicada |
| `rufi_config_versions` | `page_id`, número, estado (`draft` / `published` / `archived`), `config jsonb` (validado con el esquema), autor, fecha, nota. **Las versiones son las copias de seguridad** |
| `rufi_templates` | Genérica, Aval ICO, Hipotecas, Vender vivienda, Comprar vivienda (las tres nuevas con textos de propuesta, pendientes de aprobación) |
| `rufi_ai_settings` (una fila) | chat activado sí/no (por defecto **no**), modelo, instrucciones, conocimiento aprobado, límites, topes de gasto |
| `rufi_public_hits` | contadores anónimos de límites: clave = hash de IP con sal + ventana. Sin IP en claro |
| `rufi_ai_usage` | consumo diario: mensajes, tokens, errores, derivaciones a WhatsApp. **Sin texto de conversaciones** |
| `rufi_audit` | quién publicó, restauró, activó o desactivó qué, y cuándo |

- **RLS:** lectura y escritura solo para admin (y para quien tenga `rufi.*`), con el mismo
  criterio de rol efectivo que el resto del CRM. `anon` no tiene acceso a ninguna tabla.
- **Funciones públicas** (`SECURITY DEFINER`, `search_path` fijo, `EXECUTE` solo para `anon`):
  - `rufi_public_config(p_slug)`: devuelve `{enabled, version, config}` **de la versión
    publicada**, o nada;
  - `rufi_public_route(p_path)`: para Joomla, resuelve la ruta a un `slug`;
  - `rufi_public_hit(p_key, p_window, p_max)`: límite atómico.

  La API pública usa la clave `anon` y estas tres funciones: **no usa `service_role`**.

### 3.2 Código nuevo

```
lib/rufi/
  contract/rufi-config.schema.json    ← copia FIJADA del esquema del repo Rufi (con versión y hash)
  validate.ts                         ← validador: misma lógica que tools/validate-config.mjs (paridad probada)
  public-shape.ts                     ← construye la respuesta pública con lista blanca de campos
  publish.ts                          ← borrador → publicado, versiones, restauración, auditoría
  preview.ts                          ← token de vista previa firmado (HMAC, 10 min, una página)
  cors.ts                             ← orígenes exactos (https://referencehome.es, https://www.referencehome.es)
  ai/groq.ts                          ← cliente con el SDK openai + baseURL de Groq (no se activa)
  ai/policy.ts                        ← instrucciones fijas, limpieza de datos personales, derivación a WhatsApp
  ai/budget.ts                        ← tope diario/mensual (patrón de studio3d)
app/(app)/admin/rufi/                 ← páginas del módulo (§5)
app/api/admin/rufi/**                 ← API internas: getRequester + permisos + comprobación de Origin
app/api/public/rufi/v1/config/[slug]/route.ts   ← GET + OPTIONS
app/api/public/rufi/v1/route/route.ts           ← GET ?path=  (solo Joomla) + OPTIONS
app/api/public/rufi/v1/chat/route.ts            ← POST + OPTIONS (responde 404 mientras la IA esté apagada)
tests/rufi/**                          ← pruebas (§8)
```

### 3.3 Archivos existentes que se tocan (añadidos mínimos)

| Archivo | Cambio |
|---|---|
| `lib/supabase/proxy.ts` **[existente]** | Dos patrones públicos exactos, como los de la visita 3D: `GET/OPTIONS ^/api/public/rufi/v1/(config/[a-z0-9-]+|route)$` y `POST/OPTIONS ^/api/public/rufi/v1/chat$`. No se abre ningún prefijo |
| `lib/auth/permission-catalog.ts` **[existente]** | Módulo `rufi`: `rufi.view` (leer), `rufi.manage` (editar y publicar), `rufi.ai.manage` (IA). Consultor sin acceso por defecto |
| `app/(app)/AdminSidebar.tsx` **[existente]** | Una entrada «Rufi» en el menú |

### 3.4 Variables de entorno en Vercel

**No las creo ahora.** Todas solo de servidor (ninguna `NEXT_PUBLIC_`), marcadas como
sensibles:
- `RUFI_IP_SALT`;
- `RUFI_PREVIEW_SECRET`;
- `GROQ_API_KEY`, solo cuando se autorice la IA.

---

## 4. Qué se modifica en el repositorio de Rufi

| Archivo | Cambio | Compatibilidad |
|---|---|---|
| `spec/rufi-config.schema.json` | v1.1, solo campos **opcionales** nuevos: `i18n` (textos por idioma), `ai` (`enabled`, mensaje de aviso), `link.href` limitado a `https:`, rutas relativas, `wa.me`, `m.me` e `ig.me` | Las configuraciones 1.0 siguen siendo válidas |
| `spec/rufi-public-api.md` (nuevo) | Contrato de la API pública (§6): rutas, campos, códigos y caché | — |
| `src/loader.js` | Fuente remota opcional, configurada en `_global.json` (`"source": {"api": "https://crm.referencehome.es/api/public/rufi/v1", "timeoutMs": 2500}`) y respaldo (§6.3). Vista previa con `?rufi-preview=<token>` | **Sin `source`, funciona igual que ahora**; se prueba con los mismos 53 casos |
| `src/rufi.js` → `v/1.1.0/rufi-core.js` | Idiomas (`<html lang>` → navegador → idioma por defecto), filtro de enlaces y opción «Chatear con Rufi» solo si `ai.enabled` | `v/1.0.0/` no se toca |
| `src/rufi-chat.js` → `v/1.1.0/rufi-chat.js` (nuevo) | Ventana de chat en Shadow DOM, carga diferida, aviso visible permanente «Asistente con IA», botón de WhatsApp | Solo se descarga si el chat está activo |
| `src/rufi-3d.js`, `src/adapter.js`, `models/`, animaciones | **Sin cambios** | `rufi-3d.js` y el GLB de 1.1.0 son idénticos a los de 1.0.0 (se comprueba el hash) |
| `integrations/joomla/plg_system_rufi/` (nuevo) | Plugin de sistema para Joomla 4/5. Inserta la línea del cargador en las páginas públicas (nunca en `/administrator`); con opción de activarlo o no | Se instala desde el administrador de Joomla. No hay que editar la plantilla |
| `tests/e2e/loader.e2e.cjs` y otras pruebas | Casos: API correcta, caída, lenta, JSON inválido, configuración que no cumple el esquema, vista previa, chat apagado/encendido/sin servicio | Las pruebas actuales siguen igual |
| `docs/17-…` (este), `docs/16-…` (marcado como sustituido), `CLAUDE.md` | Cambio de la regla «Rufi no simula IA», solo con vuestra autorización: los mensajes proactivos siguen predefinidos y el chat es IA **identificada como tal** | — |

**Landings y producción:** no se toca ninguna landing. La del Aval ICO publicada sigue sin
cargador.

---

## 5. Módulo «Rufi» en el CRM (interfaz)

Una sola entrada de menú, `/admin/rufi`, compacta y con el estilo del CRM (`DESIGN.md`):

| Pestaña | Qué hace |
|---|---|
| **Páginas** | Tabla compacta: nombre, URL, tipo, idioma, interruptor activo/apagado, estado (Publicada / Borrador pendiente / Sin cargador), última publicación. Arriba, el **interruptor global** y el estado de la API. Botón «Añadir página» (URL + plantilla) |
| **Editor** | Dos columnas: formulario a la izquierda (bienvenida, botones y acciones, mensajes de contexto, WhatsApp, posición, idioma) y **vista previa en vivo** a la derecha. Límites de texto del esquema en vivo. Botones «Guardar borrador», «Vista previa en la página real» y «Publicar» |
| **Idiomas** | Textos por idioma con indicador de lo que falta por traducir |
| **Plantillas** | Las cinco plantillas; «Crear página desde plantilla» |
| **Versiones** | Historial por página, diferencias, restaurar y exportar JSON (respaldo local) |
| **IA** | «Preparada, no activa». Instrucciones, conocimiento, límites y botón «Probar conexión». Se habilita solo cuando lo autoricéis |

Vista previa:
- **en el CRM**: el CRM carga el motor publicado desde `referencehome.es/rufi/v/<versión>/`
  sobre una maqueta, con el borrador;
- **en la página real**: se abre `https://referencehome.es/<página>?rufi-preview=<token>`. El
  token está firmado, dura 10 minutos y sirve para una sola página. Solo quien tiene el token ve
  el borrador.

Limitación que no cambia: una landing HTML sin la línea del cargador **no puede** mostrar Rufi.
Solo se podría reescribiendo el HTML en el servidor o editándolo, y las dos cosas modifican la
landing publicada. El módulo la marca como «Sin cargador» (lo comprueba visitando la URL; solo se
admiten URL de `referencehome.es`) y muestra la línea que hay que añadir una vez. En Joomla lo
resuelve el plugin.

---

## 6. API pública mínima

### 6.1 Rutas

| Ruta | Respuesta |
|---|---|
| `GET /api/public/rufi/v1/config/{slug}` | `{ "enabled": bool, "version": "1.1.0", "revision": n, "config": {…publicada, solo campos del esquema…} }` · 404 si no existe o no está publicada · con `?preview=<token>` devuelve el borrador (sin caché) |
| `GET /api/public/rufi/v1/route?path=/ruta` | `{ "slug": "…" }` o 404. Solo para el fragmento global de Joomla. Sin listado de rutas |
| `POST /api/public/rufi/v1/chat` | `{ slug, lang, messages[≤6, ≤500 car.] }` → `{ reply, handoff: { whatsapp } }` · **404 mientras la IA esté apagada** |

No hay ruta que liste páginas, ni identificadores internos, ni autores, ni fechas de edición.

### 6.2 Seguridad

- **CORS exacto** (`https://referencehome.es` y `www`), sin `credentials`; en el navegador no
  viajan cookies.
- Solo funciones `SECURITY DEFINER` con `anon`, sin `service_role`.
- Validación con el esquema **dos veces**: al publicar en el CRM y al servir. El cargador lo
  comprueba de nuevo y, si algo no cuadra, usa el respaldo.
- **Límites:** `config` y `route` van servidas desde la caché de Vercel (casi no llegan a la
  función). `chat` tiene límite por IP con hash y sal (por ejemplo, 15 mensajes cada 10 min),
  tope diario global y tope de gasto. Si se alcanzan, el chat se apaga solo hasta el día
  siguiente.
- Cabeceras: `X-Content-Type-Options`, `Cache-Control` y `X-Robots-Tag: noindex`.

### 6.3 Qué pasa cuando algo falla

| Fallo | Qué ve el visitante |
|---|---|
| CRM o Vercel caídos, o tardan más de 2,5 s | El cargador usa `/rufi/configs/<página>.json` en Arsys o, si no existe, la última configuración válida guardada en el navegador. Si no hay ninguna, no se muestra Rufi. **La página no se ve afectada nunca** (todo es diferido) |
| Supabase caído | La API responde 503; la CDN sirve la última respuesta válida (`stale-if-error`) y, si tampoco hay, el cargador usa el respaldo |
| Respuesta inválida o que no cumple el esquema | Se ignora y se usa el respaldo |
| Interruptor global apagado en el CRM | Rufi desaparece en un máximo de 5 min (caché) |
| Apagado de emergencia sin el CRM | `"enabled": false` en `/rufi/configs/_global.json` (Arsys) o `?rufi=off`. Tienen prioridad sobre la API |
| Groq caído, límite gratuito (429) o tope alcanzado | Mensaje «Ahora mismo no puedo contestar; te atiende el equipo por WhatsApp». Botones y mensajes predefinidos siguen funcionando |
| Cuenta del CRM comprometida | Solo podría cambiar textos de Rufi: no pueden ejecutar código (`textContent`, enlaces filtrados, esquema). La auditoría y las versiones permiten deshacerlo |

---

## 7. Costes (estimación)

Comprobar con las tarifas vigentes antes de activar.

| Servicio | Uso de Rufi | Coste adicional estimado |
|---|---|---|
| Supabase | Pocas filas (KB) y lecturas de la API, casi todas absorbidas por la caché | Despreciable dentro del plan actual |
| Vercel | `config`: con `s-maxage=300` + `stale-while-revalidate`, cerca de 12 ejecuciones por hora y página, **independientemente del tráfico**. `chat`: 1 ejecución por mensaje, con tope diario | Despreciable con el chat apagado. Con chat, proporcional al tope que fijéis |
| GroqCloud | Plan gratuito con límites de peticiones y tokens que pueden cambiar. Si no basta, pago por uso | 0 € con plan gratuito. Gasto máximo acotado por nuestro tope mensual, que reserva el coste antes de cada llamada (patrón de studio3d) |
| Arsys | Nada nuevo | 0 € |

**A confirmar:** la API de Vercel no me muestra el plan del equipo. Si fuera **Hobby**, sus
condiciones lo limitan a uso personal no comercial. Para un CRM de empresa conviene confirmar que
está en Pro, independientemente de Rufi.

---

## 8. Fases y pruebas

Todas sin desplegar, cada una en su rama y con revisión antes de la siguiente.

| Fase | Repo | Contenido | Pruebas |
|---|---|---|---|
| **A. Contrato** | Rufi | Esquema 1.1 + `rufi-public-api.md` + paquete de casos de prueba compartidos (válidos e inválidos) | Validador JS con los casos |
| **B. Datos y panel** | CRM | Migración (sin ejecutar en producción; solo en una Supabase local o de pruebas si la autorizáis), permisos, Páginas, Editor, Plantillas, Versiones, Idiomas | Paridad del validador TS con los casos de Rufi; RLS (anon no lee nada; consultor sin permiso, 403); flujo borrador → publicar → restaurar |
| **C. API pública** | CRM | `config`, `route` y vista previa; CORS y caché | Lista blanca de campos (nada fuera del esquema), CORS, 404 sin filtrar información, token de vista previa caducado o manipulado |
| **D. Cargador y motor 1.1.0** | Rufi | Fuente remota con respaldo, idiomas y enlaces seguros. `rufi-3d.js` y GLB idénticos | Los 53 + 148 actuales sin cambios, más API caída/lenta/inválida |
| **E. IA (apagada)** | CRM + Rufi | `chat` con Groq **simulado**, límites, topes, limpieza de datos personales, derivación; ventana de chat en 1.1.0 | 429, 5xx, tiempo agotado, topes, intentos de saltarse las instrucciones. Prueba real solo cuando autoricéis la cuenta de Groq |
| **F. Joomla** | Rufi | `plg_system_rufi` | HTML generado; instalación en Joomla de pruebas si hay uno |

---

## 9. Riesgos

| Riesgo | Mitigación |
|---|---|
| Abrir rutas públicas en un CRM con datos sensibles | Dos patrones exactos en el middleware, solo `anon` + funciones `SECURITY DEFINER` sobre tablas `rufi_*`, sin `service_role`, lista blanca de campos y pruebas que lo comprueban |
| El esquema cambia en un repo y no en el otro | Copia fijada con versión y hash en el CRM; prueba que falla si no coinciden con los casos compartidos |
| Rufi depende de la disponibilidad del CRM | Respaldo en tres niveles; tiempo máximo de 2,5 s; apagado de emergencia local |
| La IA inventa condiciones o requisitos | Conocimiento cerrado y aprobado, temperatura baja, derivación forzada por palabras clave y aviso fijo. Reduce el riesgo, **no lo elimina** |
| Abuso del chat y coste | Límites anónimos separados de la IA del equipo, tope de gasto con reserva y Vercel Firewall disponible |
| Privacidad (Groq en EE. UU., RGPD, transparencia de chatbots del Reglamento europeo de IA) | Sin conversaciones guardadas, limpieza de datos personales y aviso visible. La política de privacidad y la aceptación de las condiciones de Groq las decide Reference Home antes de activar |
| Middleware del CRM: en esta versión de Next la convención de `middleware.ts` puede haber cambiado (`AGENTS.md` del CRM lo advierte) | Antes de programar leo la guía de `node_modules/next/dist/docs/` y sigo exactamente el patrón actual de `proxy.ts` |

---

## 10. Pendiente de vuestra decisión

1. Autorizar este diseño y el orden de las fases (A → F).
2. Plan de Vercel (Pro / Hobby) y si hay una Supabase de pruebas o local para la migración.
3. Quién usa el módulo: ¿solo admin, o también consultores con `rufi.manage`?
4. Idiomas iniciales.
5. Versión de Joomla.
6. Aceptar el cambio de regla sobre la IA (§4) y la revisión de privacidad antes de activar Groq.
