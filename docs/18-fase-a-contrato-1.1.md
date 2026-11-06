# 18 · Fase A — contrato de configuración 1.1 y especificación Rufi ↔ CRM

Fecha: 6-nov-2026. Rama: `fase-8a-contrato-1.1`. Autorizada **solo** la fase A.
- No se ha tocado el CRM, el motor publicado, los modelos ni las landings.
- No se ha ejecutado SQL ni desplegado nada.

## Qué se entrega

| Archivo | Qué es |
|---|---|
| `spec/rufi-config.schema.json` | Contrato de configuración **1.1**, una ampliación de 1.0: `contract`, `lang`, `i18n` (es, en, fr, it, de) y `ai`, más enlaces seguros |
| `spec/contract/1.0/rufi-config.schema.json` | Esquema 1.0 **congelado** (huella `fc4de53c…`, comprobada en las pruebas) |
| `spec/rufi-crm-api.schema.json` | Formas exactas de la API `rufi-crm/1`: sobre de página, ruta, chat, errores, vista previa, respaldo, `_global.json` local |
| `spec/rufi-crm-api.md` | Especificación: rutas, autorización y abuso, CORS, caché, caducidad, apagado de emergencia, versionado |
| `spec/reference/decide.mjs` | Referencia de la decisión del cargador en modo API (función pura) |
| `spec/reference/i18n.mjs` | Referencia de idiomas: elección y textos resueltos (funciones puras) |
| `spec/vectors/` | Casos compartidos que el CRM (fase B/C) y el cargador/motor (fase D) deben pasar: 5 configuraciones válidas y 24 inválidas; 12 mensajes de API válidos y 21 inválidos; 26 decisiones; 7 elecciones de idioma |
| `spec/contract/1.1.sha256` | Huellas del contrato, para que el CRM fije la misma copia |
| `tools/validate-config.mjs` | Validador ampliado (1.1, sobres de la API con `--api`, caducidad). La API anterior se mantiene (`validateSchema`, `validateConfig`) |
| `tests/contract.test.mjs` | 15 pruebas del contrato |
| `tests/e2e/compat-1.1.e2e.cjs` | El motor **publicado** 1.0.0 con configuraciones 1.1, en Chromium |

## Resultados

| Prueba | Resultado |
|---|---|
| `npm test` | **36 superadas, 0 fallos, 1 omitida** (la omitida es anterior a esta fase: necesita Blender) · `docs/data/fase-a-npm-test.txt` |
| Compatibilidad 1.1 con el motor 1.0.0 publicado (`npm run test:compat`) | **24/24** · `docs/data/fase-a-compat-1.1.txt` |
| Cargador (sin cambios) | **53/53** · `docs/data/fase-a-cargador.txt` |
| `npm run build` | `dist/` **idéntico byte a byte** (`git status dist` vacío) |
| `git diff fase-7-centralizado -- dist src models assets hosting/rufi configs` | **vacío**: motor, modelos, configuraciones y paquete sin cambios |
| Comprobación de que las pruebas detectan errores | Al alterar a propósito la regla de revisión o la de `?rufi=off`, fallan las pruebas |

## Comprobaciones pedidas

- **Vercel:** plan **Hobby**, comprobado en la API de Vercel en solo lectura.
- **Joomla en producción:** **6.2.0**, según su manifiesto público.
- **Base de datos de desarrollo:** no se asume que exista.

Consecuencias en `spec/rufi-crm-api.md §0`.

## Riesgos

| Riesgo | Situación |
|---|---|
| **Vercel Hobby**: uso no comercial según sus condiciones; al superar límites se corta el servicio | El contrato no depende de la disponibilidad de la API (respaldo, caducidad, apagado local). Recomendación: valorar Pro para el CRM |
| Apagado durante una caída del CRM | No llega por la API (la CDN puede servir la copia antigua hasta 24 h). Solución: el interruptor local `_global.json` en Arsys, documentado como paso obligatorio del procedimiento |
| Visitante nuevo, CRM caído y respaldo estático anterior a un apagado | Verá a Rufi hasta que caduque el respaldo. Se mitiga con respaldos de caducidad corta y con el interruptor local |
| Endurecimiento de enlaces (`href`) | Una configuración 1.0 con `http:` o `javascript:` dejaría de validar. Ninguna del repositorio lo usa (comprobado). Es intencionado |
| El motor 1.0.0 ignora `i18n` y `ai` | Comprobado que no se rompe y muestra el idioma base. El validador marca error si se fija `version < 1.1.0` y aviso si no se fija |
| Idioma: Rufi sigue el `<html lang>` de la página | En una página en español, un visitante inglés verá a Rufi en español. Es intencionado, para coincidir con la página. El chat de IA sí responde en el idioma del visitante |
| Traducciones fr/it/de/en de los casos de prueba | Escritas para las pruebas; **no son textos aprobados** para publicar |
| Manifiesto de Joomla público (`/administrator/manifests/`) | Revela la versión exacta. Recomendación aparte: bloquearlo en el `.htaccess` de Joomla (no lo he tocado) |
| Groq | Solo especificado; nada contratado ni activado. Doble llave (CRM + página), aviso de IA obligatorio en los 5 idiomas, sin instrucciones en datos públicos |

## Lo que NO incluye esta fase

- CRM: tablas, API, panel. Es la fase B/C.
- Cargador y motor 1.1.0. Es la fase D.
- IA. Es la fase E.
- Plugin de Joomla 6. Es la fase F.
