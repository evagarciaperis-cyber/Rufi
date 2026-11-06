# Rufi · instalación centralizada en referencehome.es

Paquete para instalar Rufi **una sola vez** en `https://referencehome.es/rufi/` y probarlo en una
copia de la landing del Aval ICO, **sin tocar la landing publicada**. La guía completa para
reutilizarlo en otras páginas (HTML y Joomla) está en `GUIA-REUTILIZAR-RUFI.md`.

## 1. Qué contiene el ZIP

```
web/                                       ← equivale a la RAÍZ del dominio (public_html / www / httpdocs)
├── ICO/
│   └── aval-ico-valencia-rufi-test.html   ← NUEVO: copia de la landing con Rufi (noindex)
└── rufi/                                  ← NUEVA carpeta: instalación central
    ├── .htaccess                          ← tipos MIME, compresión, caché corta (5 min)
    ├── index.html                         ← evita que se liste la carpeta
    ├── rufi.js                            ← CARGADOR: lo único que incluyen las páginas
    ├── configs/
    │   ├── _global.json                   ← interruptor general y versión activa (1.0.0)
    │   ├── _routes.json                   ← solo para un fragmento global (Joomla)
    │   ├── aval-ico-valencia.json         ← configuración de producción (aún no la usa ninguna página)
    │   ├── aval-ico-valencia-test.json    ← configuración de la PRUEBA
    │   └── index.html
    └── v/
        ├── .htaccess                      ← caché de 1 año: las versiones no se modifican nunca
        ├── index.html
        └── 1.0.0/
            ├── rufi-core.js               ← componente
            ├── rufi-3d.js                 ← motor 3D (se carga después)
            ├── rufi-expresivo.web.glb     ← modelo 3D (el único)
            ├── rufi-poster.webp           ← imagen de respaldo
            └── index.html
ejemplos/                                  ← plantillas de configuración (NO se suben)
esquema/                                   ← esquema JSON y validador de configuraciones (NO se suben)
GUIA-REUTILIZAR-RUFI.md                    ← arquitectura, Joomla, versiones, ManyChat, configurador
SHA256SUMS.txt                             ← huellas para comprobar que los archivos llegan íntegros
LEEME-INSTALACION.md                       ← este documento
```

**Ningún archivo sustituye a otro existente.** `/rufi/` y `/ICO/aval-ico-valencia-rufi-test.html`
no existían (comprobado: devolvían 404).

## 2. Subida por FTP

1. Conectar por FTP y entrar en la raíz del dominio (la carpeta que contiene `ICO` e `images`).
2. Subir `web/rufi/` completa a la raíz → queda `/rufi/` junto a `/ICO/` e `/images/`.
   - Activar **mostrar archivos ocultos** para que suban los dos `.htaccess`.
   - Transferencia **binaria** (o automática) para `.glb` y `.webp`.
3. Subir **solo** `web/ICO/aval-ico-valencia-rufi-test.html` dentro de `/ICO/`.
   **No** subir ni sobrescribir `aval-ico-valencia.html` ni ningún otro archivo.
4. Permisos habituales: carpetas 755, archivos 644.

## 3. Comprobación

1. https://referencehome.es/rufi/rufi.js → código JavaScript (no 404 ni 500).
2. https://referencehome.es/rufi/configs/_global.json → texto con `"enabled": true`.
3. https://referencehome.es/ICO/aval-ico-valencia-rufi-test.html → la página es igual que la
   original, Rufi aparece abajo a la derecha y la mascota anterior no se ve.
4. https://referencehome.es/ICO/aval-ico-valencia.html → **sigue igual**, con su mascota anterior.
5. Añadir `?rufi=debug` a la URL de pruebas: la consola explica qué carga (`[Rufi cargador] activado: aval-ico-valencia-test · versión 1.0.0`).
6. Si alguna URL de `/rufi/` da **Error 500**: borrar `/rufi/.htaccess` y `/rufi/v/.htaccess`.

## 4. Diferencias entre la copia de pruebas y la original

Solo tres cambios, fuera del contenido visible:

1. `<meta name="robots" content="noindex, nofollow, noarchive">` en lugar de `index, follow`.
2. Un comentario HTML al principio del `<head>` que la identifica como copia de pruebas.
3. **Una** línea antes de `</body>`:
   ```html
   <script src="/rufi/rufi.js" data-rufi-config="aval-ico-valencia-test" defer></script>
   ```

Textos, formularios, calculadoras, enlaces, `canonical` (sigue apuntando a la original),
`hreflang` y datos estructurados no cambian (el script de empaquetado lo comprueba byte a byte).

## 5. Analítica y conversiones

- La landing no tiene analítica (ni Google Analytics, Tag Manager, Meta Pixel ni Clarity), así que
  la copia no duplica estadísticas. Rufi no envía nada a ningún servicio.
- Los eventos de la página de pruebas llevan `test: true` y `page: "aval-ico-valencia-test"` y se
  ven en la consola como `[Rufi PRUEBA]`.
- El WhatsApp que abre Rufi en la prueba empieza por **«[PRUEBA RUFI]»**.
- Los botones de WhatsApp propios de la página son los originales: si se pulsan durante la prueba,
  el mensaje es real.
- No hay sitemap (`/sitemap.xml` da 404) y la copia no se enlaza desde ninguna página. **No
  añadirla** a ningún sitemap ni menú.

## 6. Apagar, actualizar, retirar

- **Apagar Rufi en todas partes al instante**: en `/rufi/configs/_global.json`, `"enabled": false`.
- **Apagar una página**: añadir su nombre a `"disabledPages"` (p. ej. `["aval-ico-valencia-test"]`).
- **Actualizar el motor**: subir una carpeta nueva `/rufi/v/<nueva>/` y cambiar `"version"` en
  `_global.json`. Para volver atrás, poner la versión anterior. Nunca sobrescribir una versión.
- **Retirar la prueba**: borrar `/ICO/aval-ico-valencia-rufi-test.html` y, si no se va a usar en
  ninguna otra página, la carpeta `/rufi/` completa. Nada más se modificó.

## 7. Paso a producción (más adelante, no ahora)

Cuando la prueba esté aprobada, en `/ICO/aval-ico-valencia.html` añadir antes de `</body>`:

```html
<script src="/rufi/rufi.js" data-rufi-config="aval-ico-valencia" defer></script>
```

La configuración `aval-ico-valencia.json` ya está subida (sin `[PRUEBA]`). Para otras páginas o
Joomla, ver `GUIA-REUTILIZAR-RUFI.md`.
