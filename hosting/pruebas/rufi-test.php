<?php
// Rufi · prueba de PHP. Subir a /html/rufi/rufi-test.php y abrir https://referencehome.es/rufi/rufi-test.php
// Solo muestra «RUFI PHP OK» y la versión de PHP. No lee ni escribe archivos, no usa base de datos.
// Borrar este archivo después de la prueba.
header('Content-Type: text/plain; charset=utf-8');
header('X-Robots-Tag: noindex, nofollow');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
echo 'RUFI PHP OK' . "\n" . 'PHP ' . htmlspecialchars(PHP_VERSION, ENT_QUOTES, 'UTF-8') . "\n";
