# 20 · Vista previa de un borrador en la página real (diseño, fase D)

Fecha: 6-nov-2026. Estado: **diseño**, más una **demostración solo local**.
- La ruta pública que acepta el token (`GET /api/public/rufi/v1/pages/{slug}?preview=…`) **no
  existe** y no se ha creado en ningún servidor real.
- No se ha tocado el CRM, ni Arsys, ni ninguna landing.
- El cargador 1.1 ya sabe pedirla. Mientras la ruta no exista o `_global.json` no tenga
  `source.api`, la vista previa **no muestra nada**: falla cerrada.

## 1. Objetivo

Un administrador del CRM quiere ver **un borrador** de la configuración de **una página**:
- sobre la página real (`https://referencehome.es/...`), con sus selectores, su CSS y su idioma;
- sin publicarlo;
- sin que lo vea ningún visitante;
- sin subir nada a Arsys.

## 2. Flujo

```
CRM (admin con sesión)                        Navegador del admin                         API del CRM (Vercel)
───────────────────────                        ───────────────────                         ────────────────────
1. «Ver en la página real» (página P, borrador D)
2. lib/rufi/preview-token.ts firma
   v1.<claims b64url>.<HMAC-SHA256 b64url>
   claims = { v:1, slug:P, draft:D, exp:≤ ahora+600 s, nonce }
3. abre https://referencehome.es/<ruta de P>#rufi-preview=<token>
                                               4. rufi.js (1.1) lee el token del ANCLA y lo quita
                                                  de la barra de direcciones (history.replaceState)
                                               5. comprueba la forma del token (sin secreto)
                                               6. GET {source.api}/pages/P?preview=<token> ───────► 7. verifica firma (comparación de tiempo
                                                  cache: no-store, credentials: omit,                  constante), exp ≤ 10 min, slug = P,
                                                  referrerPolicy: no-referrer                          borrador D de la página P
                                                                                      ◄─────────  8. pageEnvelope { preview:true, status:active,
                                                                                                       config: borrador, expiresAt = exp }
                                                                                                       Cache-Control: no-store
                                               9. decide() › vista previa: válido → carga el motor
                                                  con el borrador y la etiqueta «Vista previa · borrador»
```

### 2.1 Reglas del cargador (ya implementadas; `spec/reference/decide.mjs` §5)

| Regla | Dónde |
|---|---|
| El token va en el **ancla** (`#rufi-preview=`): el navegador no lo envía a Arsys, no aparece en sus registros ni en `Referer` | `src/loader.js › takePreviewToken` |
| Se quita de la URL nada más leerlo; si se recarga la página, ya no hay vista previa | igual |
| Solo se acepta la forma `v1.<16–600 car.>.<43 car.>` (base64url). El cargador **no** verifica la firma, porque no tiene el secreto: la verifica la API | `src/loader-core.js › PREVIEW_TOKEN_RE` |
| Solo se llama a `source.api` de `_global.json`, que debe cumplir el patrón del contrato (`https://…/api/public/rufi/v1`) | `sourceOf()` |
| En vista previa **no** se lee Storage ni las copias de `localStorage`, y no se escribe ninguna copia | `decide()` + `storage()` |
| Si la API falla, responde 401/404, tarda más de `timeoutMs` o el sobre no es válido (o no lleva `preview: true`, o es de otra página) → **no se muestra nada**, tampoco la configuración publicada | `decide()` › `preview-failed` |
| Sin revisión de página abierta (no se aplica `decideLive`) | `storage()` |
| Aviso visible «Vista previa · borrador» en los cinco idiomas | `src/rufi.js` (`cfg.preview`) |

### 2.2 Lo que debe hacer la API del CRM (fase B/C, **pendiente de autorización**)

- Verificar el HMAC-SHA256 con comparación de tiempo constante. El secreto solo está en Vercel.
- Comprobar las claims con `previewClaims`:
  - `exp` dentro de los próximos 600 s;
  - `slug` igual al de la ruta;
  - `draft` es un borrador de esa página.
- Responder un `pageEnvelope` con:
  - `preview: true`, `status: active` y la `config` del borrador, validada con el contrato;
  - `expiresAt` igual al `exp` del token;
  - `Cache-Control: no-store`.
- Errores con la forma `error`:
  - `401 unauthorized` si la firma es mala, el token ha caducado o es de otra página;
  - `404 not_found` si no existe el borrador.
- CORS: orígenes exactos (`https://referencehome.es`) y **sin credenciales**. CORS no es
  autenticación: lo que protege es el token.
- Límite de peticiones por IP (con hash) y no guardar el token en los registros (quitar
  `?preview=` de los logs de Vercel o registrar solo el `nonce`).
- Reutilización: el token vale como mucho 10 min para una página y un borrador.
  - Hacerlo de un solo uso (lista de `nonce` gastados) impediría que el admin recargue.
  - **Propuesta:** se puede reutilizar dentro de esos 10 min, con revocación opcional por
    `nonce` desde el CRM.

## 3. Decisiones abiertas (necesitan vuestra respuesta)

1. **¿La vista previa debe respetar el apagado del sitio?**
   - Hoy la referencia (`decide.mjs`) evalúa la vista previa **antes** que `status.json`: un
     admin puede ver un borrador aunque Rufi esté apagado. Es útil para preparar un encendido.
   - Si no se quiere así, hay que cambiar la referencia y los vectores, que forman parte del
     contrato: `npm run contract:hash` y aviso al CRM.
2. **Token en la consulta o en una cabecera.** La especificación (`spec/rufi-crm-api.md` §2.1)
   lo pone en la consulta (`?preview=`).
   - Ventaja: es una petición «simple», sin *preflight* de CORS.
   - Inconveniente: puede quedar en los registros de Vercel.
   - Alternativa: `Authorization: Bearer <token>`, que añade un *preflight* y cambia el contrato.
   - Recomendación: mantener la consulta y no registrarla.
3. **Entrada firmada.** La demostración local firma `HMAC(secreto, "v1.<claims b64url>")`. **No
   he podido comprobar** que `lib/rufi/preview-token.ts` del CRM firme exactamente eso: está en
   otro repositorio y no lo he abierto. Hay que confirmarlo antes de la fase B.
4. **CSP de las landings.** Si una página tiene `Content-Security-Policy` con `connect-src`,
   tendrá que permitir:
   - `https://<proyecto>.supabase.co`, para la configuración;
   - `crm.referencehome.es`, para la vista previa.

   No lo he comprobado en las páginas reales (no las he tocado).

## 4. Demostración local (sin servidores reales)

`tests/e2e/storage-1.1.e2e.cjs`, bloque 9. Funciona así:
- un servidor Node `http` local imita la API de vista previa, con un secreto **de
  demostración**;
- Playwright reenvía a ese servidor las peticiones a `crm.referencehome.es`;
- también imita el Supabase Storage del resto de pruebas.

| Caso | Resultado esperado | Verificado |
|---|---|---|
| Token válido (sitio apagado en Storage) | Se muestra el borrador con el aviso. No se pide nada a Storage ni se escribe `localStorage`. El token desaparece de la URL | Sí (Chromium) |
| Firma manipulada | No se muestra nada, tampoco la copia publicada | Sí |
| Token caducado | Igual | Sí |
| Token de otra página | Igual | Sí |
| Firmado con otro secreto | Igual | Sí |
| Forma no válida (`v1.x.y`) | Igual: la API ni se llama | Sí |

## 5. Qué falta para usarlo de verdad (todo necesita autorización)

1. Fase B/C del CRM: la ruta `GET /pages/{slug}?preview=`, el botón «Ver en la página real» y la
   firma con `preview-token.ts`.
2. Añadir `source.api` a `/rufi/configs/_global.json` en Arsys (junto con `source.static`).
3. Publicar el cargador 1.1 (`/rufi/rufi.js`) y la carpeta `/rufi/v/1.1.0/`.
