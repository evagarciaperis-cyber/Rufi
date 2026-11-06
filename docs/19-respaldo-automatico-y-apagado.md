# 19 · Respaldo automático y apagado de emergencia (propuesta para aprobar antes de la fase B)

Fecha: 6-nov-2026. Estado: **propuesta, sin implementar**.
- No se ha creado ninguna conexión entre Vercel y Arsys.
- No se ha tocado el CRM, no se ha ejecutado SQL y no se ha desplegado nada.
- Si se aprueba, se ajustan la especificación y los casos de la fase A (`spec/rufi-crm-api.md`,
  `spec/vectors/decision.json`) **antes** de la fase B, en el mismo PR #4.

Hechos de partida:
- **Medido:** el cargador pide sus JSON con `cache: 'no-cache'` (`src/loader.js:32`). El
  navegador revalida en **cada visita**, así que un cambio en un archivo de Arsys se ve en la
  siguiente visita, aunque el `.htaccess` diga `max-age=300`.
- **Comprobado:** Vercel está en el plan **Hobby**. Al superar sus límites corta el servicio, y
  sus tareas programadas (cron) solo pueden ejecutarse una vez al día.
- **No comprobado (no ejecuto SQL ni miro la facturación de Supabase):** el plan de Supabase.
  Algunos tiempos dependen de si tiene «Smart CDN» (§2.3).

---

## 1. Respaldo sin FTP habitual

### 1.1 Alternativas

| | Alternativa | Automática | Escritura en Arsys desde fuera | Servicios nuevos | Mantenimiento | Valoración |
|---|---|---|---|---|---|---|
| **A** | **El CRM publica sobres estáticos en Supabase Storage** (cubeta pública solo de lectura) al publicar o apagar. El cargador los lee directamente | Sí | **No** | No (Supabase ya está contratado) | Mínimo | **Recomendada** |
| B | Arsys «tira» de la API del CRM: un `sync.php` lee y guarda copias en `/rufi/configs/_crm/` (por cron de Arsys o al paso de visitantes, como mucho cada 10 min) | Sí | No (Arsys solo lee datos públicos) | No | Bajo: un script PHP y, si existe, una tarea cron | Buena como **refuerzo opcional** |
| C | Vercel «empuja» a un receptor PHP en Arsys, firmado con HMAC | Sí | **Sí** (abre una entrada de escritura en Arsys) | No | Medio | No recomendada |
| D | Vercel sube los archivos por FTP o SFTP | Sí | **Sí, con credenciales de FTP de todo el sitio guardadas en Vercel** | No | Medio | **Rechazada** (si se filtran, se puede modificar toda la web) |
| E | El CRM publica en GitHub Pages o jsDelivr | Sí | No | Sí (tercero y otra caché que no controlamos) | Medio | Rechazada |
| F | Sin respaldo en servidor: solo la copia del navegador | — | No | No | Ninguno | Insuficiente para visitantes nuevos |

### 1.2 Recomendación: A (Supabase Storage como fuente estática)

**Cambio respecto a la fase A:** la configuración pública **deja de servirse con una función de
Vercel**. El CRM, al publicar, escribe el mismo sobre del contrato (`pageEnvelope`, sin cambios
de formato) como **archivo estático** en una cubeta pública de Supabase:

```
https://<proyecto>.supabase.co/storage/v1/object/public/rufi-public/v1/
├── status.json                 ← estado global: { api, status: "active"|"killed", revision, issuedAt, expiresAt }
├── pages/<slug>.json           ← sobre de cada página (active / disabled / killed)
└── routes/<sha256(ruta)>.json  ← solo Joomla: ruta → slug, con la ruta en hash (no se pueden listar)
```

Ventajas:
- **Seguridad:** el CRM **no abre ninguna ruta pública** para la configuración.
  - El tráfico de las webs no toca Vercel ni el CRM.
  - Solo el servidor del CRM puede escribir en la cubeta (con `service_role`). Al público solo
    se le permite leer archivos sueltos; no puede listarlos.
  - En la cubeta solo hay sobres públicos, validados con el contrato antes de subirlos.
- **Independencia de Vercel Hobby:** si Vercel corta el servicio por límites o se cae, las webs
  siguen leyendo de Supabase.
- **Automático:** publicar, apagar o encender en el CRM escribe los archivos en el mismo
  momento. Una tarea **diaria** del CRM (cabe en Hobby) vuelve a emitir los sobres para renovar
  su caducidad. Sin FTP y sin exportaciones.
- **Coste:** cada visita descarga unos 5 KB, o una revalidación 304. Por ejemplo, 100 000
  visitas al mes son unos 0,5 GB de salida de datos. Hay que comprobarlo con el plan de
  Supabase, pero es muy inferior a lo que incluyen sus planes. No hay servicios nuevos.
- **Mantenimiento:** nada en Arsys. El cargador solo necesita la URL de la cubeta en
  `_global.json`.

Qué sigue en Vercel (dinámico y con poco tráfico):
- la **vista previa**, solo para administradores y con token;
- el **chat de IA**, apagado.

Resistencia: con la opción A, Supabase pasa a ser el punto único de la configuración.
- Si Supabase cae, los visitantes que ya han venido usan su copia del navegador.
- Los visitantes nuevos no ven a Rufi; la página funciona igual.
- Si se quiere cubrir también ese caso, se añade **B como refuerzo**. No hace falta para
  empezar.

### 1.3 Refuerzo opcional B (no recomendado para empezar)

- Script `sync.php` de unas 120 líneas, sin parámetros de entrada: ignora la URL y el cuerpo.
- Lee `status.json` y los `pages/*.json` de las páginas de `_routes.json` desde la cubeta
  pública. **Arsys solo lee datos públicos**, sin credenciales.
- Solo guarda un sobre si tiene buen formato, la revisión es mayor que la guardada y no ha
  caducado.
- Escribe de forma atómica en `/rufi/configs/_crm/`, como mucho una vez cada 10 minutos.
- Antes habría que comprobar si el plan de Arsys tiene cron (si no, se ejecuta al paso de
  visitantes) y si PHP puede hacer HTTPS hacia fuera.

---

## 2. Caché y apagado: tiempos reales

### 2.1 Capas de caché (con la recomendación A)

| Capa | Valor | Efecto |
|---|---|---|
| Archivos de la cubeta | `Cache-Control: max-age=60` al subirlos | La CDN de Supabase los guarda hasta 60 s. Con Smart CDN se invalidan solos al sobrescribirlos |
| Navegador (HTTP) | `cache: 'no-cache'` del cargador | Revalida en cada visita: nunca usa una copia HTTP sin preguntar |
| Navegador (`localStorage`) | último sobre válido y marcas de apagado | Solo se usa si no responde la fuente principal; respeta `revision` y `expiresAt` |
| Caducidad de los sobres | 7 días, renovada a diario por el CRM | Si el CRM deja de renovarlos, Rufi se apaga solo como mucho en 7 días: nunca queda una copia vieja para siempre |
| `_global.json` en Arsys | revalidado en cada visita | El interruptor local actúa en la **siguiente visita** |

### 2.2 Dos tipos de apagado

| | **Apagado ordinario** | **Apagado urgente** |
|---|---|---|
| Para qué | Retirar a Rufi de una página o de todo el sitio por una decisión normal: campaña, revisión de textos | Algo va mal y hay que quitarlo ya, o el CRM/Vercel no responde |
| Cómo | CRM → página «Apagar» o «Apagar Rufi en todo el sitio» | 1) CRM → «Apagado urgente»: igual que el global, pero además obliga a confirmar y avisa a todos los administradores · 2) si el CRM no abre: subir `status.json` con `killed` desde el panel web de Supabase (sin FTP) · 3) último recurso: `_global.json` con `"enabled": false` en Arsys (FTP) |
| Qué escribe | `pages/<slug>.json` con `disabled` o `status.json` con `killed`, con revisión nueva | lo mismo, o el interruptor local |
| Tiempo máximo hasta que lo ve un visitante | **≤ 60 s** sin Smart CDN; normalmente unos segundos con Smart CDN | vía 1: **≤ 60 s** · vía 2: **≤ 60 s** desde la subida · vía 3: **la siguiente visita** tras la subida |
| Reactivar | «Encender» en el CRM (nueva revisión) | Vías 1 y 2: «Encender» en el CRM · vía 3: volver a poner `true` por FTP. El interruptor local manda sobre el CRM a propósito |

Comparación con la fase A: allí se servía con una función de Vercel con
`s-maxage=60, stale-while-revalidate=300, stale-if-error=86400`. El tiempo real era **≤ 6 min**
(el primer visitante tras un rato sin tráfico recibía la versión vieja) y **hasta 24 h** si la
función fallaba. Con la recomendación A desaparecen esos dos casos: no hay
`stale-while-revalidate` ni `stale-if-error`.

### 2.3 Qué pasa en cada situación

| Situación | Visitante que ya vino | Visitante nuevo |
|---|---|---|
| Todo funciona | Configuración actual (≤ 60 s de retraso) | Igual |
| **Vercel no responde** (caída o corte de Hobby) | **Sin efecto**: la configuración no pasa por Vercel. Solo fallan la vista previa y el chat | **Sin efecto** |
| Vercel no responde y hay que apagar | El CRM no abre: vía urgente 2 (panel de Supabase) o 3 (FTP) | Igual |
| Supabase no responde (2,5 s) | Usa su copia del navegador si es válida y no ha caducado. Si tenía una marca de apagado, sigue apagado | **No ve a Rufi**; la página no se ve afectada. Con el refuerzo B usaría la copia de Arsys |
| Se apaga mientras Supabase no responde | El CRM no puede escribir → vía 3 (FTP). Un visitante con una copia «activa» la usaría hasta que caduque o hasta que se active la vía 3 | No ve a Rufi (no hay de dónde leer) |
| La CDN de Supabase sirve una copia antigua | Gana la revisión más alta: una marca de apagado ya vista no se pierde | Ve como mucho 60 s de retraso |
| El CRM deja de renovar los sobres (tarea diaria parada) | Rufi sigue hasta que caducan (≤ 7 días). El CRM avisa en su panel | Igual |

Retraso máximo para mostrar a Rufi con una fuente caída: 2,5 s de espera más la copia del
navegador. **La página nunca espera**: el cargador va diferido.

---

## 3. Riesgos de la recomendación

| Riesgo | Mitigación |
|---|---|
| Configurar mal la cubeta: escritura pública o listado abierto | Políticas de Storage: sin `insert`/`update`/`delete` para `anon` ni para usuarios autenticados; sin `select` de listado. Prueba automática en la fase B que intenta escribir y listar como anónimo y debe fallar |
| Supabase como punto único de la configuración | Copia del navegador. Refuerzo B opcional. Interruptor local en Arsys |
| Plan de Supabase sin Smart CDN | El máximo pasa a ser 60 s, que es aceptable. Se puede bajar a 30 s a cambio de más revalidaciones |
| URL del proyecto de Supabase visible en el cargador | Ya es pública: el CRM la publica en su JavaScript (`NEXT_PUBLIC_SUPABASE_URL`). La cubeta solo contiene datos públicos |
| Se sube a la cubeta algo que no es público | El CRM valida cada sobre con el contrato (lista blanca, `additionalProperties: false`) antes de subirlo; si no pasa, no se publica. Mismos casos `fuga-de-datos-*` de la fase A |
| La tarea diaria de Hobby se ejecuta con poca precisión horaria | La caducidad es de 7 días: un retraso de horas no afecta |
| Vercel Hobby es para uso no comercial | No afecta a la configuración de Rufi (ya no pasa por Vercel). Sigue recomendado revisar el plan del CRM |

## 4. Qué cambia en el contrato de la fase A si se aprueba

En el mismo PR #4, antes de la fase B:

- `spec/rufi-crm-api.md`: la fuente de configuración pasa a ser estática (`status.json`,
  `pages/`, `routes/` con hash). `GET /pages` y `GET /routes` salen de Vercel. Se mantienen
  `GET /pages/{slug}?preview=` (vista previa) y el chat.
- `spec/rufi-crm-api.schema.json`: añadir `statusFile`. `localGlobal.source` pasa a
  `{ "static": "<URL de la cubeta>/v1", "api": "<URL de Vercel>/v1", "timeoutMs": 2500 }`.
- `spec/reference/decide.mjs` y `spec/vectors/decision.json`: incluir `status.json` (que el
  cargador pide a la vez que la página), quitar los casos de `stale-if-error` y añadir «Vercel
  caído → sin efecto» y «Supabase caído → copia del navegador».
- El sobre `pageEnvelope` **no cambia**.

## 5. Pendiente de vuestra decisión

1. Aprobar la **opción A**, con o sin el refuerzo B más adelante.
2. Aprobar los dos tipos de apagado y sus tres vías urgentes.
3. Autorizar que compruebe el plan de Supabase y si tiene Smart CDN. Es una consulta de solo
   lectura en el panel o la API de facturación, sin SQL; si no se puede, me lo indicáis
   vosotros.
