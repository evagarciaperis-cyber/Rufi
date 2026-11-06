<?php

/**
 * Pruebas de Helper\Injector (puro, sin Joomla).
 */

declare(strict_types=1);

require_once RUFI_PLUGIN . '/src/Helper/Injector.php';

use ReferenceHome\Plugin\System\Rufi\Helper\Injector;

$page = static fn (string $body = '<h1>Aval ICO</h1>'): string => "<!DOCTYPE html>\n<html lang=\"es\">\n<head><meta charset=\"utf-8\"><title>Prueba</title></head>\n<body>\n{$body}\n</body>\n</html>\n";

$req = static fn (array $over = []): array => array_merge([
    'client'        => 'site',
    'path'          => '/ICO/aval-ico-valencia.html',
    'base_path'     => '',
    'origin'        => 'https://referencehome.es',
    'itemid'        => 101,
    'format'        => '',
    'tmpl'          => '',
    'option'        => 'com_content',
    'is_ajax'       => false,
    'document_type' => 'html',
    'content_type'  => 'text/html; charset=utf-8',
    'status'        => 200,
], $over);

$set = static fn (array $over = []): array => array_merge([
    'enabled'    => '1',
    'loader_url' => '/rufi/rufi.js',
    'url_map'    => [['match' => 'exact', 'path' => '/ICO/aval-ico-valencia.html', 'config' => 'aval-ico-valencia']],
    'menu_map'   => [],
], $over);

$TAG = "<script src=\"/rufi/rufi.js\" data-rufi-config=\"aval-ico-valencia\" defer></script>\n";

/** Comprueba que $out = $in con $tag insertado justo en $pos y nada más. */
$exactInsert = static function (string $in, string $out, string $tag, int $pos): bool {
    return \strlen($out) === \strlen($in) + \strlen($tag)
        && substr($out, 0, $pos) === substr($in, 0, $pos)
        && substr($out, $pos, \strlen($tag)) === $tag
        && substr($out, $pos + \strlen($tag)) === substr($in, $pos)
        && str_replace($tag, '', $out) === $in;
};

$countTag = static fn (string $html): int => preg_match_all('/<script\b[^>]*data-rufi-config=/i', $html);

// ------------------------------------------------------------------------------------------------
T::group('Inserción');

$in = $page();
$r  = Injector::process($in, $set(), $req());
T::eq($r['injected'], true, 'inserta en una página HTML pública con configuración');
T::eq($r['config'], 'aval-ico-valencia', 'config resuelta');
T::ok($exactInsert($in, $r['html'], $TAG, strrpos($in, '</body>')), 'byte a byte idéntica fuera del punto de inserción (justo antes de </body>)');
T::eq($countTag($r['html']), 1, 'exactamente una etiqueta');
T::ok(str_contains($r['html'], "\n" . $TAG . '</body>'), 'queda como una línea propia antes de </body>');
T::eq(Injector::inject($in, $set(), $req()), $r['html'], 'inject() devuelve el mismo HTML que process()');

$bin = "<html><body>\x00\xff\xfe binario \r\n\r\n</body></html>";
$r   = Injector::process($bin, $set(), $req());
T::ok($r['injected'] && $exactInsert($bin, $r['html'], $TAG, strrpos($bin, '</body>')), 'conserva bytes no UTF-8 y \\r\\n');

$upper = "<HTML><BODY>x</BODY >\n</HTML>";
$r     = Injector::process($upper, $set(), $req());
T::ok($r['injected'] && $exactInsert($upper, $r['html'], $TAG, strpos($upper, '</BODY')), '</BODY > en mayúsculas y con espacio');

$bom = "\xEF\xBB\xBF" . $page();
T::eq(Injector::process($bom, $set(), $req())['injected'], true, 'con BOM UTF-8 al principio');

$r = Injector::process($page(), $set(['fallback' => 'routes', 'url_map' => []]), $req());
T::ok($r['injected'] && str_contains($r['html'], "<script src=\"/rufi/rufi.js\" defer></script>\n</body>"), 'modo «cargador sin nombre»: sin data-rufi-config');
T::eq(Injector::process($page(), $set(['url_map' => []]), $req())['reason'], 'sin-configuracion', 'sin configuración y sin modo _routes.json: no inserta');

$r = Injector::process($page(), $set(), $req(['csp_nonce' => 'abcDEF123+/=']));
T::ok(str_contains($r['html'], ' nonce="abcDEF123+/=" defer>'), 'añade el nonce de CSP si Joomla lo da');
$r = Injector::process($page(), $set(), $req(['csp_nonce' => '"><script>alert(1)</script>']));
T::ok($r['injected'] && !str_contains($r['html'], 'nonce=') && !str_contains($r['html'], 'alert(1)'), 'nonce no válido: se ignora');

// ------------------------------------------------------------------------------------------------
T::group('Idempotencia');

$once  = Injector::inject($page(), $set(), $req());
$twice = Injector::inject($once, $set(), $req());
T::eq($twice, $once, 'segunda pasada: no cambia nada');
T::eq(Injector::process($once, $set(), $req())['reason'], 'cargador-ya-presente', 'motivo: cargador ya presente');

$manual = [
    'línea manual idéntica'                 => '<script src="/rufi/rufi.js" data-rufi-config="otra" defer></script>',
    'fragmento global sin nombre'           => '<script src="/rufi/rufi.js" defer></script>',
    'URL absoluta del cargador'             => '<script defer src="https://referencehome.es/rufi/rufi.js"></script>',
    'con ?v= y comillas simples'            => "<script src='/rufi/rufi.js?v=2' defer></script>",
    'sin comillas'                          => '<script src=/rufi/rufi.js defer></script>',
    'otro src con data-rufi-config'         => '<script src="/otra/ruta.js" data-rufi-config="x"></script>',
    'en el <head>'                          => null,
];
foreach ($manual as $name => $line) {
    $html = $line === null
        ? str_replace('</head>', '<script src="/rufi/rufi.js" data-rufi-config="aval-ico-valencia" defer></script></head>', $page())
        : $page($line);
    T::eq(Injector::inject($html, $set(), $req()), $html, "ya incluido ({$name}): no se toca");
}
$custom = $page('<script src="/cdn/cargador-rufi.js" defer></script>');
T::eq(Injector::inject($custom, $set(['loader_url' => '/cdn/cargador-rufi.js']), $req()), $custom, 'detecta el cargador con la URL configurada');
$other = $page('<script src="/media/templates/site/js/rufian.js"></script><p>rufi</p>');
T::eq(Injector::process($other, $set(), $req())['injected'], true, 'otros scripts con «rufi» en el nombre no cuentan');

// ------------------------------------------------------------------------------------------------
T::group('Sin </body>');

foreach ([
    'fragmento sin body'   => '<div>hola</div>',
    'body sin cerrar'      => "<html><body><p>x</p>\n",
    '</body> solo en comentario' => '<html><body><p>x</p><!-- </body> -->',
    '</bodyx> no es cierre' => '<html><body>x</bodyx>',
] as $name => $html) {
    $r = Injector::process($html, $set(), $req());
    T::ok(!$r['injected'] && $r['html'] === $html && $r['reason'] === 'sin-body', "{$name}: intacto");
}

// ------------------------------------------------------------------------------------------------
T::group('Varios </body> (scripts, comentarios, atributos)');

$cases = [
    'en un script antes'          => "<body><script>document.write('</body>');</script>x</body>",
    'en un script después'        => "<body>x</body>\n<script>var s = '</body>';</script>",
    'en un comentario después'    => "<body>x</body>\n<!-- copia vieja: </body> -->\n</html>",
    'en un comentario antes'      => "<body><!-- </body> -->x</body>",
    'en <style>'                  => "<body>x</body><style>/* </body> */</style>",
    'en <textarea>'               => "<body><textarea></body></textarea>x</body><textarea></body></textarea>",
    'en <template>'               => "<body>x</body><template></body></template>",
    'en <noscript>'               => "<body>x</body><noscript></body></noscript>",
    'en un atributo'              => "<body>x</body><div title=\"</body>\" data-a='</body>'></div>",
    'en CDATA'                    => "<body>x</body><svg><![CDATA[ </body> ]]></svg>",
    'script con </script dentro de cadena' => "<body>x</body><script>a='<\\/body>'; b = 1 < 2;</script>",
    '<script/> no se cierra solo' => "<body>x</body><script/>var a='</body>';</script>",
    'script con atributo «>» entre comillas' => "<body>x</body><script data-x=\"a>b\">'</body>'</script>",
];
foreach ($cases as $name => $html) {
    // El cierre real es el «</body>» que va justo después de «x».
    $real = strpos($html, 'x</body>');
    $real = $real === false ? null : $real + 1;
    $pos  = Injector::findBodyClose($html);
    $out  = Injector::inject($html, $set(), $req());
    T::ok($pos === $real && $exactInsert($html, $out, $TAG, (int) $real), "{$name}: se inserta ante el </body> real", "pos {$pos}, real {$real}");
}

$two = "<body>a</body>\n<body>b</body>\n";
T::eq(Injector::findBodyClose($two), strrpos($two, '</body>'), 'dos </body> reales: el último');
T::eq(Injector::findBodyClose('<body><script>sin cerrar </body>'), null, 'script sin cerrar: no hay </body> real');
T::eq(Injector::findBodyClose('<body><!-- sin cerrar </body>'), null, 'comentario sin cerrar: no hay </body> real');

// ------------------------------------------------------------------------------------------------
T::group('Correspondencia página → configuración');

$map = $set([
    'url_map' => [
        ['match' => 'exact', 'path' => '/ICO/aval-ico-valencia.html', 'config' => 'aval-ico-valencia'],
        ['match' => 'prefix', 'path' => '/hipotecas/', 'config' => 'hipotecas'],
        ['match' => 'exact', 'path' => '/hipotecas/fija', 'config' => 'no-gana'],
        (object) ['match' => 'exact', 'path' => '/objeto', 'config' => 'desde-objeto'],
    ],
    'menu_map' => [
        ['itemid' => '205', 'config' => 'menu-205'],
        (object) ['itemid' => 300, 'config' => 'menu-300'],
    ],
]);
$cfg = static fn (array $r) => Injector::process($page(), $map, $r)['config'];
T::eq($cfg($req()), 'aval-ico-valencia', 'URL exacta');
T::eq($cfg($req(['path' => '/ICO/aval-ico-valencia.html?utm=1'])), 'aval-ico-valencia', 'ignora ?consulta');
T::eq($cfg($req(['path' => '/ICO/aval-ico-valencia.html/', 'itemid' => null])), 'aval-ico-valencia', 'ignora barra final');
T::eq($cfg($req(['path' => '/ICO/Aval-ICO-Valencia.html', 'itemid' => null])), null, 'distingue mayúsculas (como el cargador)');
T::eq($cfg($req(['path' => '/hipotecas', 'itemid' => null])), 'hipotecas', 'prefijo: la propia ruta');
T::eq($cfg($req(['path' => '/hipotecas/fija', 'itemid' => null])), 'hipotecas', 'prefijo: gana la primera regla');
T::eq($cfg($req(['path' => '/hipotecasx', 'itemid' => null])), null, 'prefijo por segmentos: /hipotecasx no cuenta');
T::eq($cfg($req(['path' => '/objeto', 'itemid' => null])), 'desde-objeto', 'filas de subformulario como objetos');
T::eq($cfg($req(['path' => '/blog/articulo', 'itemid' => 205])), 'menu-205', 'por elemento de menú (Itemid como texto en ajustes)');
T::eq($cfg($req(['path' => '/blog/otro', 'itemid' => '300'])), 'menu-300', 'por elemento de menú (Itemid como texto en la petición)');
T::eq($cfg($req(['path' => '/hipotecas/x', 'itemid' => 205])), 'hipotecas', 'la URL va antes que el menú');
T::eq($cfg($req(['path' => '/otra', 'itemid' => 999])), null, 'sin coincidencia: nada');
T::eq(Injector::process($page(), $map, $req(['path' => '/otra', 'itemid' => 999]))['html'], $page(), 'sin coincidencia: HTML intacto');

$bad = Injector::normalizeSettings(['url_map' => [
    ['path' => 'sin-barra', 'config' => 'a'],
    ['path' => '/a/../b', 'config' => 'a'],
    ['path' => '/ok', 'config' => ''],
], 'menu_map' => [['itemid' => 0, 'config' => 'a'], ['itemid' => 'x', 'config' => 'a'], ['itemid' => -3, 'config' => 'a']]]);
T::eq([$bad['url_map'], $bad['menu_map']], [[], []], 'reglas no válidas se descartan');
T::eq(Injector::normalizeSettings([])['enabled'], false, 'sin ajustes: desactivado');
T::eq(Injector::normalizeSettings([])['loader_url'], '/rufi/rufi.js', 'URL del cargador por defecto');
T::eq(Injector::process($page(), $set(['enabled' => '0']), $req())['reason'], 'desactivado', 'interruptor general en No');

// Misma normalización de rutas que el contrato (spec/vectors/routes.json, compartido con el CRM).
$vectors = json_decode((string) file_get_contents(RUFI_REPO . '/spec/vectors/routes.json'), true);
$okNorm  = true;
$okHash  = true;
foreach ($vectors['cases'] as $c) {
    $n = Injector::normalizePath($c['input']);
    if ($n !== $c['normalized']) {
        $okNorm = false;
        echo "    vector {$c['input']}: " . var_export($n, true) . "\n";
    }
    if ($n !== null && hash('sha256', $n) !== $c['sha256']) {
        $okHash = false;
    }
}
T::ok($okNorm, 'normalizePath igual que spec/reference/routes.mjs (' . \count($vectors['cases']) . ' vectores)');
T::ok($okHash, 'SHA-256 de las rutas normalizadas igual que los vectores');

// ------------------------------------------------------------------------------------------------
T::group('Rutas excluidas');

$ex = $set(['url_map' => [['match' => 'prefix', 'path' => '/', 'config' => 'todo']], 'excluded_paths' => "/component/users\r\n  /privado/  \n# comentario\n\nno-valida\n"]);
$why = static fn (string $path, array $over = []) => Injector::process($page(), $ex, $req(['path' => $path] + $over))['reason'];
T::eq($why('/inicio'), 'insertado', 'ruta normal con prefijo «/»: inserta');
T::eq($why('/component/users/login'), 'ruta-excluida', 'excluida configurada (y por debajo)');
T::eq($why('/privado'), 'ruta-excluida', 'excluida con espacios y barra final');
T::eq($why('/privadox'), 'insertado', 'por segmentos: /privadox no está excluida');
T::eq($why('/administrator/index.php'), 'ruta-excluida', '/administrator siempre excluida');
T::eq($why('/api/index.php/v1/content'), 'ruta-excluida', '/api siempre excluida');
T::eq($why('/installation/index.php'), 'ruta-excluida', '/installation siempre excluida');
T::eq($why('/web/administrator/', ['base_path' => '/web']), 'ruta-excluida', 'Joomla en subcarpeta: /web/administrator excluida');
T::eq($why('/a/../administrator'), 'ruta-no-valida', 'ruta con «..»: no inserta');
T::eq($why('/%61dministrator'), 'ruta-excluida', 'ruta codificada (%61dministrator): excluida');

// ------------------------------------------------------------------------------------------------
T::group('XSS en nombres de configuración y URL');

$xssNames = ['"><script>alert(1)</script>', "a\" onload=\"alert(1)", 'Aval-ICO', 'aval_ico', 'aval ico', 'aval.ico', '../../x', str_repeat('a', 65), "av\nal", "aval\0", 'á', ''];
foreach ($xssNames as $n) {
    $out = Injector::inject($page(), $set(['url_map' => [['match' => 'exact', 'path' => '/ICO/aval-ico-valencia.html', 'config' => $n]]]), $req());
    T::eq($out, $page(), 'nombre rechazado: ' . json_encode($n, JSON_UNESCAPED_UNICODE));
}
$r = Injector::process($page(), $set(['url_map' => [['match' => 'exact', 'path' => '/ICO/aval-ico-valencia.html', 'config' => " aval-ico-valencia\n"]]]), $req());
T::eq($r['config'], 'aval-ico-valencia', 'espacios alrededor del nombre: se recortan (dato del formulario)');
T::eq(Injector::isValidConfigName(str_repeat('a', 64)), true, 'nombre de 64 caracteres: válido');
T::eq(Injector::isValidConfigName('aval-ico-valencia-test'), true, 'nombre del contrato: válido');

$badUrls = [
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)//x.js',
    'data:text/javascript,alert(1)',
    '//evil.example/rufi.js',
    '/\\evil.example/rufi.js',
    'https://evil.example/rufi/rufi.js',
    'https://referencehome.es.evil.example/rufi/rufi.js',
    'https://user:pass@referencehome.es/rufi/rufi.js',
    'https://evil.example@referencehome.es/rufi/rufi.js',
    'http://referencehome.es/rufi/rufi.js',
    '/rufi/rufi.js" onload="alert(1)',
    "/rufi/rufi.js'><script>alert(1)</script>",
    '/rufi/rufi.js#"><b>',
    '/rufi/../evil.js',
    '/rufi/%2e%2e/evil.js',
    '/rufi/rufi.css',
    'rufi/rufi.js',
    '/rufi/ru fi.js',
    "/rufi/\nrufi.js",
    "/rufi/\x00rufi.js",
    '/rufi/%zzrufi.js',
    '',
];
foreach ($badUrls as $u) {
    $r = Injector::process($page(), $set(['loader_url' => $u]), $req());
    $expected = $u === '' ? 'insertado' : 'url-cargador-no-permitida'; // vacío = valor por defecto
    T::ok($r['reason'] === $expected && ($u === '' || $r['html'] === $page()), 'URL rechazada: ' . json_encode($u), $r['reason']);
}
T::eq(Injector::process($page(), $set(['loader_url' => "  /rufi/rufi.js\n"]), $req())['reason'], 'insertado', 'espacios alrededor: se recortan');

$goodUrls = [
    ['/rufi/rufi.js', [], 'https://referencehome.es'],
    ['/rufi/rufi.js?v=1.0.0&x=y', [], 'https://referencehome.es'],
    ['https://referencehome.es/rufi/rufi.js', [], 'https://referencehome.es'],
    ['https://referencehome.es:443/rufi/rufi.js', [], 'https://REFERENCEHOME.es'],
    ['https://cdn.referencehome.es/rufi/rufi.js', "https://cdn.referencehome.es/\nno es un origen", 'https://referencehome.es'],
    ['http://localhost:8080/rufi/rufi.js', [], 'http://localhost:8080'],
];
foreach ($goodUrls as [$u, $allow, $origin]) {
    $r = Injector::process($page(), $set(['loader_url' => $u, 'allowed_origins' => $allow]), $req(['origin' => $origin]));
    T::eq($r['reason'], 'insertado', "URL aceptada: {$u}");
}
$r = Injector::process($page(), $set(['loader_url' => '/rufi/rufi.js?a=1&b=2']), $req());
T::ok(str_contains($r['html'], 'src="/rufi/rufi.js?a=1&amp;b=2"'), 'atributos escapados («&» → «&amp;»)');
T::eq(Injector::buildTag('/a.js?x="<>\'', 'n'), "<script src=\"/a.js?x=&quot;&lt;&gt;&apos;\" data-rufi-config=\"n\" defer></script>\n", 'buildTag escapa comillas y < >');

// ------------------------------------------------------------------------------------------------
T::group('Respuestas que no son HTML');

$skips = [
    'JSON por tipo'              => [['content_type' => 'application/json'], $page()],
    'XML'                        => [['content_type' => 'application/xml'], $page()],
    'XHTML'                      => [['content_type' => 'application/xhtml+xml'], $page()],
    'format=json'                => [['format' => 'json'], $page()],
    'format=raw'                 => [['format' => 'raw'], $page()],
    'format=feed'                => [['format' => 'feed'], $page()],
    'AJAX (X-Requested-With)'    => [['is_ajax' => true], $page()],
    'com_ajax'                   => [['option' => 'com_ajax'], $page()],
    'tmpl=component'             => [['tmpl' => 'component'], $page()],
    'tmpl=raw'                   => [['tmpl' => 'raw'], $page()],
    'documento raw'              => [['document_type' => 'raw'], $page()],
    'documento json'             => [['document_type' => 'json'], $page()],
    'página de error (documento)' => [['document_type' => 'error'], $page()],
    'página de error 404'        => [['status' => 404], $page()],
    'página de error 500'        => [['status' => 500], $page()],
    'redirección 303'            => [['status' => 303], $page()],
    'cuerpo JSON con text/html'  => [[], '{"html":"<body></body>"}'],
    'cuerpo array JSON'          => [[], " \n[1,2,\"</body>\"]"],
    'cuerpo vacío'               => [[], ''],
];
foreach ($skips as $name => [$over, $html]) {
    $r = Injector::process($html, $set(['fallback' => 'routes']), $req($over));
    T::ok(!$r['injected'] && $r['html'] === $html, "{$name}: intacto", $r['reason']);
}
T::eq(Injector::process($page(), $set(), $req(['content_type' => 'TEXT/HTML;charset=UTF-8', 'format' => 'HTML']))['injected'], true, 'text/html en mayúsculas y format=html: sí');
T::eq(Injector::process($page(), $set(), $req(['content_type' => null, 'document_type' => null]))['injected'], true, 'sin tipo declarado pero con HTML: sí');

// ------------------------------------------------------------------------------------------------
T::group('Administración');

foreach (['administrator', 'api', 'cli', 'installation', '', null] as $client) {
    $r = Injector::process($page(), $set(['fallback' => 'routes', 'url_map' => [['match' => 'prefix', 'path' => '/', 'config' => 'todo']]]), $req(['client' => $client, 'path' => '/index.php']));
    T::ok(!$r['injected'] && $r['reason'] === 'no-es-sitio', 'cliente ' . var_export($client, true) . ': nunca inserta');
}
$noClient = $req();
unset($noClient['client']);
T::eq(Injector::process($page(), $set(), $noClient)['reason'], 'no-es-sitio', 'sin cliente indicado: no inserta (por defecto, seguro)');
T::eq(Injector::process($page(), $set(['url_map' => [['match' => 'prefix', 'path' => '/administrator', 'config' => 'admin']]]), $req(['path' => '/administrator/index.php']))['reason'], 'ruta-excluida', 'aunque se asigne una configuración a /administrator');
