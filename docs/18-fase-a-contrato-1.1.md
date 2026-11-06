# 18 · Fase A — contrato de configuración 1.1 y especificación Rufi ↔ CRM

Fecha: 6-nov-2026. Rama: `fase-8a-contrato-1.1` (PR evagarciaperis-cyber/Rufi#4, que depende
del #3). Autorizada **solo** la fase A.
- No se ha tocado el CRM, el motor publicado, los modelos ni las landings.
- No se ha ejecutado SQL ni desplegado nada.

**Revisión 2** (tras aprobar la opción A de `docs/19`):
- la configuración pública sale de **archivos estáticos en Supabase Storage**, no de Vercel;
- estado global en un solo archivo;
- orden de publicación seguro ante cortes;
- control de subida a la cubeta pública;
- tres tipos de visitante;
- apagado ordinario y urgente con tiempos «objetivo, por medir»;
- herramienta de medición.

## Archivos

| Archivo | Qué es |
|---|---|
| `spec/rufi-config.schema.json` | Contrato de configuración **1.1**, una ampliación de 1.0 (`contract`, `lang`, `i18n` es/en/fr/it/de, `ai`, enlaces seguros) |
| `spec/contract/1.0/rufi-config.schema.json` | 1.0 congelado (huella comprobada en las pruebas) |
| `spec/rufi-crm-api.schema.json` | `statusFile`, `pageEnvelope`, `routeFile`, `publicObjectPath`, `localGlobal` (`source.static`, `api`, `timeoutMs`, `recheckSeconds`), vista previa, chat, errores |
| `spec/rufi-crm-api.md` | Especificación completa (§0 hechos comprobados y documentados; §3 fallos a medias; §4 nada privado en público; §5 visitantes; §6 apagado) |
| `spec/reference/decide.mjs` | `decide()` (al cargar) y `decideLive()` (páginas abiertas) |
| `spec/reference/publish.mjs` | `guardPublicObject()` (control de subida), `planPublish()` (orden), `applyPlan()` (simulación con cortes) |
| `spec/reference/routes.mjs` | Normalización de rutas y nombre con SHA-256 |
| `spec/reference/i18n.mjs` | Elección de idioma y textos resueltos |
| `spec/vectors/` | Configuraciones (5 válidas, 24 inválidas); API (15 válidos, 29 inválidos); 30 decisiones (visitantes nuevos y que vuelven); 8 de páginas abiertas; 15 rutas; 17 rutas de cubeta (3 permitidas, 14 prohibidas); 7 de idioma |
| `spec/contract/1.1.sha256` | Huellas para la copia fijada del CRM |
| `tools/validate-config.mjs` | Validador: configuración, `--api` (status, página y ruta), caducidad |
| `tools/measure-propagation.mjs` | Mide de verdad cuánto tarda un cambio en verse a través de la CDN (para la fase B) |
| `tests/contract.test.mjs` | 22 pruebas del contrato |
| `tests/e2e/compat-1.1.e2e.cjs` | El motor 1.0.0 publicado con configuraciones 1.1 (Chromium) |

## Resultados

Ver `docs/data/fase-a-*.txt`.

| Prueba | Resultado |
|---|---|
| `npm test` | **43 superadas, 0 fallos, 1 omitida** (anterior a esta fase: necesita Blender) |
| Prioridad de los apagados, exhaustiva | **625/625** combinaciones: nunca se muestra a Rufi si lo más reciente es un apagado o no hay estado |
| Publicación cortada en cada paso posible (apagar sitio, apagar página, publicar con ruta nueva) | Siempre la versión anterior completa, la nueva completa o nada. El diario marca «incompleta» |
| Control de subida | 14 rutas prohibidas y 7 contenidos inválidos rechazados |
| Compatibilidad 1.1 con el motor 1.0.0 publicado | **24/24** |
| Cargador | **53/53** (sin cambios) |
| `npm run build` | `dist/` **idéntico**. Diff de `dist src models assets hosting/rufi configs` respecto a la fase 7: **vacío** |
| Prueba de mutación (romper a propósito la regla de apagado, la de revisión o la de rutas permitidas) | Las pruebas fallan (5, 3 y 1 fallos) |

## Comprobaciones con fuentes reales (solo lectura)

| Qué | Resultado | Grado |
|---|---|---|
| Vercel | Plan Hobby | Comprobado (API de Vercel) |
| Joomla | 6.2.0 | Comprobado (manifiesto público) |
| Supabase | Plan Pro con *spend cap* | Documentado por el equipo en el CRM (04-11-2026). No lo he podido ver directamente: la herramienta de solo lectura no muestra la facturación y no ejecuto SQL |
| Caché de Supabase Storage | Smart CDN en Pro; invalidación al sobrescribir de hasta 60 s; los parámetros de consulta no saltan la caché; purga manual; 250 GB + 250 GB de salida | Documentación de Supabase; **no verificado con pruebas** |

## Riesgos

| Riesgo | Situación |
|---|---|
| Tiempos de apagado | **No verificados**: el «≤ 60 s» es lo que documenta Supabase. Se medirán en la fase B con `tools/measure-propagation.mjs` contra una cubeta de pruebas, desde varias redes |
| Páginas abiertas con el motor 1.0.0 | No se enteran de un apagado hasta recargar. Con el 1.1.0, objetivo ≤ 6 min |
| Supabase como única fuente | Visitante nuevo con Storage caído: no ve a Rufi (la página bien). Los que vuelven usan su copia. Mejora futura: opción B |
| *Spend cap* de Supabase Pro | Si se supera la cuota, Supabase puede restringir el servicio (402) → mismo caso que «Storage caído». El consumo estimado de Rufi es muy inferior a la cuota |
| Copia «activa» en el navegador + Storage caído + apagado | Ese visitante ve a Rufi hasta que caduque su copia (≤ 7 días) o hasta U3 (Arsys) |
| Listado de la cubeta pública | Depende de no crear la política `select`. Se verifica con pruebas reales en la fase B |
| Vercel Hobby (uso no comercial) | Ya no afecta a la configuración de Rufi. Sigue recomendado revisar el plan del CRM |
| Manifiesto de Joomla público | Revela la versión. Recomendación aparte (no lo he tocado) |
| Traducciones de los casos de prueba | No son textos aprobados |

## Fuera de esta fase

- CRM (B/C): cubeta, tablas, panel, publicación, auditoría y medición real de tiempos.
- Cargador y motor 1.1.0 (D): lectura de Storage, `decide`/`decideLive`, revisión de páginas
  abiertas, idiomas.
- IA (E).
- Plugin de Joomla 6 (F).
