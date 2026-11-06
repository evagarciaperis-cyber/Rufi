# 16 · Rufi Admin + Rufi IA — diseño PHP en Arsys (SUSTITUIDO, no se desarrolla)

> **Sustituido el 6-nov-2026 por decisión de Reference Home:** el panel irá integrado en el CRM (Next.js + Supabase + Vercel). Ver `docs/17-rufi-admin-en-crm-propuesta.md`. Se conserva como referencia: las secciones de seguridad, reglas de la IA (§5.2–5.5), cambios del motor 1.1.0 (§6) y limitaciones de las landings (§3.4) siguen siendo válidas. No se escribió código PHP del panel.

Fecha: 6-nov-2026. Rama: `fase-8-admin-ia` (sale de `fase-7-centralizado`).
Estado: **solo diseño**. No hay código del panel ni de la IA, no se ha desplegado nada y no se ha
tocado producción. Este documento es para revisarlo y aprobarlo antes de empezar.

Entorno confirmado por Reference Home: Arsys, PHP 8.3 ejecutándose en `/html/rufi/`, web principal
Joomla, landings HTML independientes, Rufi 1.0.0 instalado.

---

## 1. Punto de partida: lo que ya existe y se reutiliza

| Pieza (fase 7) | Qué hace hoy | En el diseño |
|---|---|---|
| `/rufi/rufi.js` (cargador, `src/loader.js`) | lee `configs/_global.json`, `_routes.json` y `configs/<página>.json`, y carga `v/<versión>/rufi-core.js` | **No cambia.** El panel escribe los mismos JSON que hoy se editan a mano |
| `configs/*.json` + `spec/rufi-config.schema.json` | configuración pública por página, solo datos | El panel es un **editor visual de estos archivos**. El esquema pasa a ser la única definición, usada por JS y por PHP |
| `/rufi/v/1.0.0/` (núcleo, 3D, GLB, póster) | motor y animaciones reales | **Intacto.** Idiomas y chat van en una versión nueva `v/1.1.0/`. Cada página puede seguir en 1.0.0 |
| `tools/validate-config.mjs` | valida configuraciones | Se porta a PHP con las mismas reglas y las mismas pruebas |
| `_global.json` (`enabled`, `disabledPages`, `configVersion`) | interruptores | Son los interruptores del panel. Al publicar, el panel cambia `configVersion` para saltarse la caché |
| `rufi:action` y códigos `ref` | eventos sin enviar datos | Se mantienen. El chat añade `rufi:chat-open` y `rufi:chat-handoff`, sin contenido de la conversación |

Comprobado en el código: el núcleo pinta los textos con `textContent`, nunca con HTML. Un texto
malicioso en una configuración no puede inyectar código. Hay un punto débil: `href` de las
acciones `link` se asigna tal cual, así que un `javascript:` en una configuración funcionaría. Se
corrige por partida doble: el panel solo acepta `https:`, rutas relativas y `wa.me`/`m.me`/`ig.me`,
y el núcleo 1.1.0 lo vuelve a comprobar.

**Principio de integración:** el panel no es un segundo Rufi. Es una forma segura de escribir los
archivos que el Rufi actual ya sabe leer. Si el panel se borra, Rufi sigue funcionando con los
últimos archivos publicados.

---

## 2. Arquitectura propuesta

```
FUERA de la raíz web (si Arsys lo permite; se comprueba en la fase 8.0)
/rufi-privado/
├── secretos.php          ← clave de Groq y sal de sesiones (permisos 600, nunca se muestran)
├── usuarios.php          ← usuarios del panel: hash Argon2id, 2FA opcional
├── borradores/           ← configuraciones en edición (no publicadas)
├── plantillas/           ← Genérica, Aval ICO, Hipotecas, Vender, Comprar
├── traducciones/         ← textos por idioma
├── ia/                   ← instrucciones y conocimiento de Reference Home
├── copias/               ← copia automática antes de cada publicación (se guardan las últimas 50)
├── limites/              ← contadores de intentos de acceso y de peticiones al chat
├── sesiones/             ← sesiones PHP propias (no el /tmp compartido del hosting)
└── registro/             ← quién cambió qué y cuándo (sin contraseñas ni claves)

DENTRO de la raíz web
/html/rufi/
├── rufi.js, v/, configs/ ← lo de la fase 7. configs/ lo escribe el panel al PUBLICAR
├── admin/
│   ├── index.php         ← única entrada PHP del panel (controlador frontal)
│   ├── recursos/         ← CSS/JS/iconos estáticos del panel (sin datos)
│   └── .htaccess         ← deniega todo salvo index.php y recursos/
└── api/
    ├── chat.php          ← proxy seguro hacia Groq (la clave nunca sale del servidor)
    └── .htaccess
```

Si PHP **no puede** escribir fuera de `/html/` (por `open_basedir`), la alternativa es
`/html/rufi/_privado-<aleatorio>/`, con tres defensas a la vez:

1. `.htaccess` con `Require all denied`.
2. Todos los archivos privados son `.php` y empiezan por `<?php exit; ?>`. Aunque el servidor
   ignore el `.htaccess`, al pedirlos se ejecutan y no devuelven nada.
3. Nombre de carpeta aleatorio e `index.php` vacío en cada carpeta.

Esto se comprueba con una petición HTTP real en la instalación: el panel no arranca si algún
archivo privado se puede descargar.

**Sin base de datos.** Son archivos JSON (envueltos en PHP cuando son privados) con:
- escritura atómica: archivo temporal y después `rename`;
- bloqueo con `flock`;
- copia previa antes de cada cambio.

Con un administrador o pocos y decenas de páginas es suficiente y más fácil de copiar y restaurar.

**Sin dependencias.** PHP 8.3 puro: sesiones, `password_hash`, `random_bytes`, `hash_hmac` y cURL.
No hay Composer en producción. Para las pruebas se usa un ejecutor propio en PHP; PHPUnit, si
se usa, queda solo como herramienta de desarrollo.

---

## 3. Rufi Admin

### 3.1 Pantallas

1. **Acceso**: usuario, contraseña y, si se activa, un código de 6 dígitos de una app de
   autenticación (TOTP, RFC 6238, implementado sin librerías).
2. **Panel principal**:
   - interruptor global de Rufi;
   - lista de páginas con su estado (Activo / Apagado / Borrador sin publicar / Cargador no
     instalado), la plantilla, el idioma y la versión del motor;
   - fecha del último cambio.
3. **Añadir página**:
   - se pega la URL; solo se admiten direcciones de referencehome.es;
   - el panel la visita desde el servidor y detecta si tiene el cargador
     (`/rufi/rufi.js`), si es Joomla o una landing independiente, y qué secciones (`#id`)
     tiene;
   - se elige una plantilla y se crea un borrador.
4. **Editor visual** (formularios generados a partir del esquema):
   - bienvenida;
   - botones del panel (texto, icono, acción: ir a una sección, WhatsApp, enlace);
   - mensajes según el contexto. Las secciones se eligen de una lista de las detectadas en la
     página, no hace falta escribir selectores;
   - WhatsApp y mensaje;
   - posición (derecha/izquierda) y tamaño;
   - idioma;
   - límites de texto en vivo, los mismos del esquema.
5. **Vista previa**: la página real dentro del panel, con el borrador aplicado. Ver §3.3.
6. **Publicar**: valida, hace una copia, escribe `configs/<página>.json` y, si hace falta,
   `_routes.json`, y cambia `configVersion`. Los visitantes ven el cambio en su siguiente visita.
7. **Idiomas y traducciones**: textos por idioma (es, en… según §8), con indicación de lo que
   falta por traducir.
8. **Copias de seguridad**: lista con fecha y autor; «Ver diferencias» y «Restaurar»
   (restaurar también crea una copia antes de aplicarse). Descarga ZIP de toda la configuración.
9. **Inteligencia artificial**:
   - interruptor global del chat y otro por página;
   - instrucciones, conocimiento de Reference Home y modelo;
   - límites;
   - «Probar conexión» y consumo del día.
10. **Cuenta**: cambiar contraseña, activar 2FA, cerrar sesión, cerrar todas las sesiones.

Plantillas iniciales: **Genérica**, **Aval ICO** (la configuración actual), **Hipotecas**,
**Vender vivienda** y **Comprar vivienda**. Las tres nuevas se entregan con textos de propuesta,
prudentes y marcados como **pendientes de aprobación por Reference Home**.

### 3.2 Diseño visual

Paleta de la landing del Aval ICO (variables CSS medidas en el HTML publicado):
- granate `#A11F48` / `#7E1638`;
- verde `#4A5D5A`;
- beige `#F0DFCF`, papel `#FFFDF9`;
- tinta `#2B2B2B`, gris `#5E5A56`, línea `#D9CEC3`.

Interfaz:
- tipografía del sistema, adaptable a móvil (lista en tarjetas) y accesible (teclado,
  contraste AA);
- Rufi en miniatura con la imagen web oficial de `assets/web/`, sin modificarla.

### 3.3 Vista previa sin tocar lo publicado

El panel abre la página real en un `<iframe>` del mismo dominio con `?rufi=off`, para que no
cargue la versión publicada. Después inyecta el núcleo de `v/<versión>/rufi-core.js` con
`window.RufiConfig = <borrador>`. No hace falta cambiar el cargador ni publicar nada, y el
visitante normal nunca ve el borrador.

Riesgo: si Joomla envía `X-Frame-Options: DENY`, la vista previa se abre en otra pestaña con un
token de un solo uso y de 10 minutos. Se comprueba en la fase 8.0.

### 3.4 Activar Rufi según el tipo de página

| Tipo | Instalación única | Después, desde el panel |
|---|---|---|
| **Joomla** | **Plugin de sistema `plg_system_rufi`**: un ZIP que se instala desde el administrador de Joomla. Inserta la línea del cargador en todas las páginas públicas (nunca en `/administrator/`). Es mejor que editar la plantilla, porque una actualización de la plantilla borraría la línea | Añadir o quitar páginas, activar o apagar, editar |
| **Landing HTML independiente con el cargador** | Una línea antes de `</body>`, una vez | Todo |
| **Landing HTML sin el cargador** (la del Aval ICO publicada hoy) | — | **Nada.** El panel la marca como «Cargador no instalado» y muestra la línea que hay que añadir |

**Limitación de las landings independientes.** Un archivo `.html` estático solo carga lo que
lleva escrito. Desde fuera solo se le puede meter Rufi:
- reescribiendo el HTML en el servidor, con `mod_substitute` o enviando los `.html` a PHP;
- o editando el archivo.

Las dos opciones cambian la landing publicada, la caché y potencialmente el SEO, así que **las
descarto**. Propuesta: que la línea del cargador forme parte de la plantilla de cualquier
landing nueva. A partir de ahí todo se gestiona desde el panel. Para la landing del Aval ICO
publicada, añadir la línea seguirá necesitando tu orden expresa.

---

## 4. Seguridad del panel

| Medida | Cómo |
|---|---|
| Contraseñas | `password_hash` con **Argon2id** (bcrypt si el PHP de Arsys no lo tiene), mínimo 12 caracteres. Rehash automático si cambian los parámetros |
| Primer acceso | El paquete lleva un **token de instalación de un solo uso** (aleatorio, distinto en cada paquete, solo te lo doy a ti). Sirve para crear el primer usuario y se destruye al usarse. No hay contraseña por defecto |
| Intentos de acceso | Por IP (guardada con hash) y por usuario: retardo creciente. Bloqueo de 15 minutos tras 5 fallos y aviso en el registro. Mensaje de error genérico |
| 2FA | TOTP opcional (recomendado) |
| Sesiones | Carpeta de sesiones propia. Cookie `__Host-rufi_admin` con `Secure`, `HttpOnly`, `SameSite=Strict` y `Path=/`. `session_regenerate_id` al entrar. Caduca a los 30 min sin uso y a las 8 h como máximo. Cierre de sesión que la destruye en el servidor |
| CSRF | Token por sesión en cada formulario y en cada petición que cambia algo, comparado con `hash_equals`. Además se comprueba `Origin`/`Sec-Fetch-Site`. Solo POST para cambios |
| XSS | El panel escapa todo lo que muestra (`htmlspecialchars`). CSP estricta (`default-src 'self'`, sin scripts en línea, `frame-ancestors 'none'`). En Rufi, textos con `textContent` y enlaces con lista de esquemas permitidos |
| Validación | Cada configuración pasa por el validador PHP con el mismo esquema que el JS, antes de guardar y antes de publicar. Tamaños máximos. Ids y nombres de archivo con `^[a-z0-9-]+$`, así no hay rutas manipulables |
| Archivos privados | Fuera de la raíz o con las tres defensas del §2. Prueba automática de no descarga en la instalación y desde el panel («Comprobar seguridad») |
| Cabeceras | `X-Robots-Tag: noindex`, `Referrer-Policy: same-origin`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store` en el panel |
| Visitas desde el servidor (añadir página) | Solo `https://referencehome.es/…`, sin redirecciones a otros dominios, con tiempo y tamaño máximos (evita SSRF) |
| Registro | Accesos, fallos, publicaciones y restauraciones. Nunca contraseñas, claves ni conversaciones |

---

## 5. Rufi IA (GroqCloud)

### 5.1 Flujo

```
Visitante → chat de Rufi (Shadow DOM, v/1.1.0/rufi-chat.js, carga diferida y solo si la página tiene la IA activada)
          → POST /rufi/api/chat.php   (mismo dominio; sin clave)
                 ├ comprueba: chat activado, origen referencehome.es, token de conversación firmado (HMAC, caduca)
                 ├ límites: por visitante, por IP con hash, y tope diario global
                 ├ limpia el mensaje: longitud máxima; quita teléfonos, correos y DNI antes de enviarlo
                 ├ construye la petición: instrucciones + conocimiento + últimos turnos (máx. 6)
                 └ cURL → https://api.groq.com/openai/v1/chat/completions   (clave solo en el servidor)
          ← respuesta corta + botón «Hablar por WhatsApp» cuando corresponde
```

### 5.2 Reglas del asistente

Van en las instrucciones fijas, que el panel no deja borrar. Se pueden ampliar.

- Se presenta siempre como **«Rufi, asistente virtual con inteligencia artificial de Reference
  Home»**. El chat lo indica también de forma visible, de forma permanente y no solo en el
  primer mensaje.
- Responde en el idioma del visitante.
- No da cifras, condiciones hipotecarias, tipos, requisitos de ayudas ni interpretaciones
  legales o fiscales que no estén en el conocimiento aprobado. Cuando no lo sabe, lo dice y
  ofrece WhatsApp.
- Mensajes financieros prudentes, como hoy: «orientativo», «decide el banco», «habla con un
  asesor».
- No pide datos personales. Si el visitante los escribe, se quitan antes de enviar a Groq y se
  le recomienda usar WhatsApp.
- Si piden hablar con una persona o el tema es una operación concreta, deriva a WhatsApp
  (+34 674 61 22 72).

Límite honesto: un modelo de lenguaje **reduce** pero no **elimina** las respuestas inventadas.
Para compensarlo:
- conocimiento cerrado y aprobado;
- temperatura baja;
- respuestas cortas;
- reglas de derivación por palabras clave (hipoteca, ayuda, aval, impuestos, contrato…) que
  añaden siempre el aviso y el botón de WhatsApp, aunque el modelo no lo haga.

### 5.3 Límites y fallos

- **Tope diario global** (configurable) por debajo del límite gratuito de Groq.
- **Por visitante**: por ejemplo, 15 mensajes cada 10 minutos.
- **Por IP**: 60 mensajes por hora.
- Mensaje de 500 caracteres como máximo y conversación de 12 turnos.
- Si Groq contesta 429 (límite), 5xx o no responde en 15 s, o se llega a un tope, Rufi responde:
  «Ahora mismo no puedo contestar; si quieres, te atiende el equipo por WhatsApp». Se respeta
  `Retry-After` y nunca se muestra un error técnico.
- **Sin Groq no se rompe nada**: el panel, los botones y los mensajes predefinidos siguen igual.
- El modelo se elige en el panel a partir de la lista que devuelve Groq («Probar conexión»), no
  queda fijado en el código. Los límites gratuitos de Groq pueden cambiar sin aviso: el panel
  muestra el consumo y los topes son nuestros.

### 5.4 Privacidad

- No se guardan conversaciones. Solo contadores (número de mensajes, errores y derivaciones a
  WhatsApp) y el consumo de tokens del día.
- Los mensajes salen hacia Groq (empresa de EE. UU.). **Reference Home debe revisar**:
  - la política de privacidad y la información al usuario;
  - las condiciones de Groq;
  - las obligaciones de transparencia para chatbots del Reglamento europeo de IA y el RGPD.

  No es una decisión técnica. El diseño ya cumple lo que depende de nosotros: aviso visible de
  IA, minimización de datos y sin almacenamiento.

### 5.5 Cambio en las reglas del proyecto

`CLAUDE.md` y `RUFI.md` dicen hoy «Rufi no simula IA: sus mensajes son textos predefinidos».
Con el chat esto pasa a ser:
- los mensajes proactivos (bienvenida, contexto) siguen siendo predefinidos;
- el chat, opcional, es una IA real **identificada como tal**.

Ese cambio de regla lo haré solo cuando apruebes este diseño.

---

## 6. Cambios en el motor (versión 1.1.0)

En una carpeta nueva. La 1.0.0 no se toca y el cargador `rufi.js` no cambia.

1. `i18n`: textos por idioma en la configuración. El idioma se elige con `<html lang>` → idioma
   del navegador → idioma por defecto. Las configuraciones de la 1.0.0 siguen siendo válidas sin
   cambios.
2. Opción «Chatear con Rufi» en el panel cuando `ai.enabled` es `true`. Carga diferida de
   `rufi-chat.js`; sin chat no se descarga nada extra.
3. Lista de esquemas permitidos en los enlaces (`https:`, relativos, `wa.me`, `m.me`, `ig.me`).
4. Estado `talking` (ya existe en el contrato) mientras llega la respuesta.
   - El cuerpo y las animaciones son las reales del GLB.
   - El modelo no tiene shape keys de boca para hablar, así que no se simula lectura de labios.
5. Las mismas pruebas e2e de la 1.0.0 (148) deben pasar con la 1.1.0, más las nuevas.

Paso de una página a 1.1.0: `"version": "1.1.0"` en su configuración. El paso global se hace en
`_global.json` cuando esté probado.

---

## 7. Fases de desarrollo

Cada fase va en esta rama, con pruebas automáticas, sin desplegar y con revisión antes de la
siguiente.

| Fase | Contenido | Pruebas |
|---|---|---|
| **8.0 Diagnóstico** | `rufi-check.php`, de un solo uso como `rufi-test.php`. Solo responde sí/no, sin rutas: ¿se puede escribir fuera de `/html/`? ¿hay cURL y salida HTTPS a `api.groq.com`? ¿Argon2id? ¿HTTPS? ¿se respeta `Require all denied`? ¿se puede enmarcar la página en un iframe? Versión de Joomla | Prueba local con Apache + PHP |
| **8.1 Base PHP** | almacenamiento atómico, autenticación, sesiones, CSRF, límites, validador PHP con el esquema, registro | Unitarias en PHP + paridad JS↔PHP del validador con los mismos casos |
| **8.2 Panel** | acceso, panel principal, interruptores, añadir página, plantillas, editor, publicar, copias y restauración | Playwright contra Apache + PHP local: flujo completo, CSRF, bloqueo de intentos, XSS, archivos privados no descargables |
| **8.3 Vista previa e idiomas** | motor 1.1.0 (i18n, enlaces seguros), vista previa | e2e 1.0.0 y 1.1.0 |
| **8.4 Joomla** | `plg_system_rufi` (Joomla 4/5) | Joomla local en Docker si es posible; si no, pruebas del HTML que genera |
| **8.5 IA** | `api/chat.php`, cliente Groq, límites, limpieza de datos, chat en 1.1.0 (desactivado por defecto) | Con un **Groq simulado** (429, 5xx, tiempo agotado, respuestas largas, intentos de saltarse las instrucciones) y una prueba real con tu clave si me la das por el mecanismo seguro |
| **8.6 Paquete** | ZIP de instalación por FTP, guía y verificación como en la fase 7 | Verificación con y sin `.htaccess` |

---

## 8. Riesgos y dependencias

| Riesgo | Impacto | Mitigación |
|---|---|---|
| `open_basedir` impide escribir fuera de `/html/` | Datos privados dentro de la raíz | Tres defensas (§2) y prueba de no descarga obligatoria |
| `.htaccess` limitado en Arsys | Error 500 o reglas ignoradas | Todo protegido también sin `.htaccess` (archivos `.php` con `exit`) |
| Arsys bloquea la salida HTTPS o falta cURL | No hay IA | Se detecta en la 8.0. El resto funciona igual |
| Groq cambia límites, modelos o condiciones | Chat no disponible | Topes propios, modelo configurable, mensaje de respaldo con WhatsApp |
| Respuestas inventadas de la IA | Información errónea | §5.2: conocimiento cerrado, derivación forzada, avisos. Revisión del conocimiento por Reference Home |
| Robo de la contraseña del panel | Alguien cambia los textos de todas las páginas | Argon2id, 2FA, bloqueo, registro, copias para deshacer. Los textos nunca ejecutan código (`textContent` y enlaces filtrados) |
| Actualizar la plantilla de Joomla borra la línea | Rufi desaparece en Joomla | Plugin en lugar de editar la plantilla |
| Caché de navegadores y proxies | Cambios tardan en verse | `configVersion` automático al publicar y caché de 5 min (fase 7) |
| Vista previa bloqueada por `X-Frame-Options` | Sin vista previa integrada | Pestaña aparte con token |
| Copias de seguridad en el mismo servidor | Se pierden si se pierde el hosting | Descarga ZIP desde el panel |
| Legal (RGPD, transparencia de IA) | Sanciones o reclamaciones | Decisión y textos de Reference Home. Diseño con aviso visible y sin almacenamiento |

Dependencias externas: **ninguna de pago**. Solo GroqCloud (cuenta gratuita, clave tuya) y, en
desarrollo, Playwright, que ya se usa.

---

## 9. Lo que necesito que decidas o me confirmes

1. **Aprobar este diseño**, en especial la §3.4 (plugin de Joomla; las landings independientes
   necesitan la línea una vez) y la §5.5 (cambio de la regla «Rufi no simula IA»).
2. **Versión de Joomla** (4 o 5) y si puedes instalar extensiones desde su administrador.
3. **¿Ves por FTP alguna carpeta al mismo nivel que `/html/`?** (Arsys suele tener otras). La 8.0
   lo comprueba igualmente.
4. **Idiomas**: ¿español e inglés? ¿valenciano, francés, alemán…?
5. **Usuarios del panel**: ¿solo tú o varias personas? ¿2FA obligatorio?
6. **Conocimiento de la IA**: ¿qué textos, servicios, horarios y zonas aprobados le damos? ¿Lo
   redacto como propuesta para que lo revises?
7. **Privacidad**: confirmar que Reference Home revisará su política y las condiciones de Groq
   antes de activar el chat al público.
