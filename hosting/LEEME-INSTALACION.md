# Rufi · prueba real en referencehome.es

Paquete para probar a Rufi en el hosting **sin tocar la landing publicada**.

## 1. Qué contiene el ZIP

```
web/                                   ← equivale a la RAÍZ del dominio referencehome.es (public_html / www / httpdocs)
├── ICO/
│   └── aval-ico-valencia-rufi-test.html   ← NUEVO: copia de la landing con Rufi (noindex)
└── rufi/                                   ← NUEVA carpeta
    ├── .htaccess                           ← tipos MIME, compresión y caché (solo /rufi/)
    ├── index.html                          ← evita que se liste la carpeta
    ├── rufi.js                             ← núcleo del componente
    ├── rufi-3d.js                          ← motor 3D (se carga después)
    ├── rufi-expresivo.web.glb              ← modelo 3D
    ├── rufi-poster.webp                    ← imagen de respaldo
    └── config/
        ├── aval-ico-test.js                ← configuración de la PRUEBA (la que usa la página de pruebas)
        └── aval-ico.js                     ← configuración de producción (para más adelante; ahora no la usa nadie)
SHA256SUMS.txt                          ← huellas para comprobar que los archivos llegan íntegros
LEEME-INSTALACION.md                    ← este documento
```

**No hay ningún archivo que sustituya a otro existente.** `/ICO/aval-ico-valencia-rufi-test.html` y la carpeta `/rufi/` no existían (comprobado: devuelven 404 antes de la subida).

## 2. Subida por FTP

1. Conectar por FTP al hosting y entrar en la carpeta raíz del dominio (la que contiene la carpeta `ICO` y la carpeta `images`).
2. Subir `web/rufi/` a la raíz → queda `/rufi/` junto a `/ICO/` e `/images/`.
   - Activar en el programa FTP la opción de **mostrar archivos ocultos** para que suba `.htaccess`.
   - Modo de transferencia **binario** (o automático) para `.glb` y `.webp`.
3. Subir **solo** `web/ICO/aval-ico-valencia-rufi-test.html` dentro de la carpeta `/ICO/` existente.
   - **No** subir ni sobrescribir `aval-ico-valencia.html` ni ningún otro archivo de `/ICO/`.
4. Permisos habituales: carpetas 755, archivos 644.

## 3. Comprobación

1. Abrir https://referencehome.es/rufi/rufi.js → debe mostrarse código JavaScript (no un error 404 ni 500).
2. Abrir https://referencehome.es/ICO/aval-ico-valencia-rufi-test.html
   - La página es idéntica a la original y Rufi aparece abajo a la derecha.
   - La mascota anterior no se ve en esta copia.
3. Comprobar que https://referencehome.es/ICO/aval-ico-valencia.html **sigue igual** (con su mascota anterior).
4. Opcional: en el navegador, Herramientas de desarrollo → Consola: los eventos aparecen como `[Rufi PRUEBA] …`.
5. Si alguna URL de `/rufi/` devuelve **Error 500**: borrar `/rufi/.htaccess` y volver a probar.

## 4. Lo que diferencia la copia de pruebas de la original

Solo tres cambios, todos fuera del contenido visible:

1. `<meta name="robots" content="noindex, nofollow, noarchive">` en lugar de `index, follow`. La página de pruebas no se indexa.
2. Un comentario HTML al principio del `<head>` que la identifica como copia de pruebas.
3. Dos líneas antes de `</body>` que cargan Rufi:
   ```html
   <script src="/rufi/config/aval-ico-test.js"></script>
   <script src="/rufi/rufi.js" defer></script>
   ```

Textos, formularios, calculadoras, enlaces, `canonical` (sigue apuntando a la página original), `hreflang` y datos estructurados no cambian.

## 5. Analítica y conversiones

- La landing **no tiene analítica** (no carga Google Analytics, Tag Manager, Meta Pixel ni Clarity; comprobado), así que la copia no duplica estadísticas.
- Los eventos de Rufi en la página de pruebas llevan `test: true` y `page: "aval-ico-valencia-test"`, y se ven en la consola como `[Rufi PRUEBA]`. No se envían a ningún servicio.
- El WhatsApp que abre Rufi en la prueba empieza por **«[PRUEBA RUFI]»**, para distinguir esos mensajes de los de clientes reales.
- Los botones de WhatsApp propios de la página son los originales (no se tocan). Si se pulsan durante la prueba, el mensaje es real: conviene usar el de Rufi o avisar al equipo.
- No hay sitemap en el dominio (`/sitemap.xml` da 404) y la página de pruebas no se enlaza desde ninguna otra. **No añadirla** a ningún sitemap ni menú.

## 6. Retirar la prueba por completo

1. Borrar por FTP `/ICO/aval-ico-valencia-rufi-test.html`.
2. Borrar por FTP la carpeta `/rufi/` completa (incluido `.htaccess`).

Con eso el hosting queda exactamente como antes: la prueba no modificó ningún otro archivo.

Si Google llegara a conocer la URL, el `noindex` impide que se indexe. Tras borrarla devolverá 404 y desaparecerá sola.

## 7. Paso a producción (más adelante, no ahora)

Cuando la prueba esté aprobada:
- En `/ICO/aval-ico-valencia.html`, añadir antes de `</body>` las dos líneas con `/rufi/config/aval-ico.js` (la de producción, sin `[PRUEBA]`).
- En `/rufi/.htaccess`, subir la caché (`max-age=31536000`) y versionar los nombres de archivo.
- Ver `docs/14-componente-web.md` §5.
