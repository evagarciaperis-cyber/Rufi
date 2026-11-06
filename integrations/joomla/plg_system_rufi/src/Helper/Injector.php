<?php

/**
 * Rufi · plugin de sistema para Joomla 6 — inyector puro.
 *
 * Esta clase NO depende de Joomla: recibe el HTML ya generado, los ajustes del plugin y un
 * resumen de la petición, y devuelve el HTML con UNA línea del cargador de Rufi antes del último
 * </body> real (fuera de comentarios, <script>, <style>, etc.):
 *
 *     <script src="/rufi/rufi.js" data-rufi-config="<nombre>" defer></script>
 *
 * Fuera de ese punto de inserción no cambia ni un byte de la página (se comprueba en cada
 * inserción y en las pruebas de tests/php/). Si algo no cuadra, devuelve el HTML intacto.
 *
 * Reglas (ver docs/20-fase-f-plugin-joomla.md):
 *  - solo en el sitio público (nunca en /administrator, /api ni /installation);
 *  - solo respuestas HTML 2xx (no JSON, format=raw, AJAX, tmpl=component, com_ajax ni errores);
 *  - nombres de configuración con el patrón del contrato (`^[a-z0-9-]+$`, máx. 64);
 *  - URL del cargador relativa a la raíz (`/…`) o del mismo origen, o de un origen permitido;
 *  - idempotente: si la página ya incluye el cargador (o cualquier data-rufi-config), no hace nada.
 *
 * @copyright  Reference Home
 * @license    Propietaria (UNLICENSED)
 */

declare(strict_types=1);

namespace ReferenceHome\Plugin\System\Rufi\Helper;

\defined('_JEXEC') or die;

final class Injector
{
    /** Mismo patrón que el contrato (spec/rufi-config.schema.json `page` y spec/rufi-crm-api.schema.json `slug`). */
    public const CONFIG_NAME_PATTERN = '/^[a-z0-9-]{1,64}$/D';

    public const DEFAULT_LOADER_URL = '/rufi/rufi.js';

    /** Rutas en las que nunca se inserta (además de las que se configuren). */
    public const ALWAYS_EXCLUDED = ['/administrator', '/api', '/installation'];

    /** Igual que spec/reference/routes.mjs. */
    public const MAX_PATH = 512;

    /** Elementos cuyo contenido no es HTML: un «</body>» dentro de ellos no es el cierre real. */
    private const RAW_TEXT = ['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript', 'template'];

    /** Devuelve solo el HTML (insertado o intacto). */
    public static function inject(string $html, array $settings, array $request): string
    {
        return self::process($html, $settings, $request)['html'];
    }

    /**
     * @return array{html: string, injected: bool, reason: string, config: ?string}
     */
    public static function process(string $html, array $settings, array $request): array
    {
        $skip = static fn (string $reason): array => ['html' => $html, 'injected' => false, 'reason' => $reason, 'config' => null];

        $s = self::normalizeSettings($settings);
        if (!$s['enabled']) {
            return $skip('desactivado');
        }

        $why = self::requestSkipReason($request, $html);
        if ($why !== null) {
            return $skip($why);
        }

        $path = self::normalizePath((string) ($request['path'] ?? ''));
        if ($path === null) {
            return $skip('ruta-no-valida');
        }

        $base     = self::normalizePath((string) ($request['base_path'] ?? '')) ?? '/';
        $excluded = $s['excluded_paths'];
        foreach (self::ALWAYS_EXCLUDED as $always) {
            $excluded[] = $always;
            if ($base !== '/') {
                $excluded[] = $base . $always;
            }
        }
        foreach ($excluded as $prefix) {
            if (self::pathUnder($path, $prefix)) {
                return $skip('ruta-excluida');
            }
        }

        $loader = self::validateLoaderUrl($s['loader_url'], isset($request['origin']) ? (string) $request['origin'] : null, $s['allowed_origins']);
        if ($loader === null) {
            return $skip('url-cargador-no-permitida');
        }

        $config = self::resolveConfig($s, $path, $request['itemid'] ?? null);
        if ($config === null && $s['fallback'] !== 'routes') {
            return $skip('sin-configuracion');
        }

        if (self::hasLoader($html, $loader)) {
            return $skip('cargador-ya-presente');
        }

        $pos = self::findBodyClose($html);
        if ($pos === null) {
            return $skip('sin-body');
        }

        $nonce = isset($request['csp_nonce']) && \is_string($request['csp_nonce']) && preg_match('/^[A-Za-z0-9+\/=_-]{8,128}$/D', $request['csp_nonce'])
            ? $request['csp_nonce'] : null;

        $tag = self::buildTag($loader, $config, $nonce);
        $out = substr($html, 0, $pos) . $tag . substr($html, $pos);

        // Comprobación byte a byte: lo de antes y lo de después del punto de inserción, idénticos.
        if (\strlen($out) !== \strlen($html) + \strlen($tag)
            || substr($out, 0, $pos) !== substr($html, 0, $pos)
            || substr($out, $pos, \strlen($tag)) !== $tag
            || substr($out, $pos + \strlen($tag)) !== substr($html, $pos)) {
            return $skip('comprobacion-fallida');
        }

        return ['html' => $out, 'injected' => true, 'reason' => 'insertado', 'config' => $config];
    }

    /** La línea que se inserta (con salto de línea final, para que quede «una línea antes de </body>»). */
    public static function buildTag(string $loaderUrl, ?string $config, ?string $nonce = null): string
    {
        $e   = static fn (string $v): string => htmlspecialchars($v, ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML5, 'UTF-8');
        $tag = '<script src="' . $e($loaderUrl) . '"';
        if ($config !== null) {
            $tag .= ' data-rufi-config="' . $e($config) . '"';
        }
        if ($nonce !== null) {
            $tag .= ' nonce="' . $e($nonce) . '"';
        }

        return $tag . " defer></script>\n";
    }

    public static function isValidConfigName(mixed $name): bool
    {
        return \is_string($name) && preg_match(self::CONFIG_NAME_PATTERN, $name) === 1;
    }

    /**
     * Ruta normalizada, igual que normalizePath() de spec/reference/routes.mjs (vectores en
     * spec/vectors/routes.json): solo el camino, sin ?consulta ni #ancla, sin barra final (salvo
     * «/»), sin segmentos vacíos, «.» ni «..». null si no es aceptable.
     */
    public static function normalizePath(string $input): ?string
    {
        if ($input === '' || \strlen($input) > self::MAX_PATH) {
            return null;
        }
        $p = explode('?', explode('#', $input, 2)[0], 2)[0];
        if (!str_starts_with($p, '/') || str_starts_with($p, '//')) {
            return null;
        }
        // decodeURIComponent falla con «%» sin dos dígitos hexadecimales o con UTF-8 inválido.
        if (preg_match('/%(?![0-9A-Fa-f]{2})/', $p)) {
            return null;
        }
        $dec = rawurldecode($p);
        if (!mb_check_encoding($dec, 'UTF-8') || preg_match('/[\x00-\x1f\\\\]/', $dec)) {
            return null;
        }
        $segs = array_values(array_filter(explode('/', $dec), static fn (string $s): bool => $s !== ''));
        foreach ($segs as $s) {
            if ($s === '.' || $s === '..') {
                return null;
            }
        }

        return '/' . implode('/', $segs);
    }

    /** ¿Está $path en $prefix o por debajo? Por segmentos: «/hipotecas» cubre «/hipotecas/x», no «/hipotecasx». */
    public static function pathUnder(string $path, string $prefix): bool
    {
        if ($prefix === '/') {
            return true;
        }

        return $path === $prefix || str_starts_with($path, $prefix . '/');
    }

    /**
     * URL del cargador aceptable o null. Se admiten:
     *  - rutas desde la raíz del mismo sitio: «/rufi/rufi.js» (nunca «//host», ni relativas «rufi.js»);
     *  - URL absolutas https (http solo si coincide con el origen de la página) cuyo origen sea el de
     *    la página o esté en la lista de orígenes permitidos.
     * Siempre: sin espacios, comillas, «<», «>», «\», «#», credenciales ni segmentos «.»/«..», y
     * el camino termina en «.js».
     *
     * @param string[] $allowedOrigins orígenes ya normalizados
     */
    public static function validateLoaderUrl(string $url, ?string $requestOrigin, array $allowedOrigins = []): ?string
    {
        $url = trim($url, " \t\r\n");
        if ($url === '' || \strlen($url) > self::MAX_PATH) {
            return null;
        }
        // Lista blanca de caracteres: deja fuera comillas, <, >, \, espacios, #, @ y controles.
        if (!preg_match('~^[A-Za-z0-9._\~\-/%?=&:]+$~D', $url) || preg_match('/%(?![0-9A-Fa-f]{2})/', $url)) {
            return null;
        }

        if (str_starts_with($url, '/')) {
            if (str_starts_with($url, '//')) {
                return null;
            }
            $path = explode('?', $url, 2)[0];
        } else {
            $parts = parse_url($url);
            if (!\is_array($parts) || !isset($parts['scheme'], $parts['host']) || isset($parts['user']) || isset($parts['pass']) || isset($parts['fragment'])) {
                return null;
            }
            $origin = self::normalizeOrigin($parts['scheme'] . '://' . $parts['host'] . (isset($parts['port']) ? ':' . $parts['port'] : ''));
            if ($origin === null) {
                return null;
            }
            $same    = $requestOrigin !== null && self::normalizeOrigin($requestOrigin) === $origin;
            $allowed = \in_array($origin, $allowedOrigins, true);
            if (!$same && !$allowed) {
                return null;
            }
            if (str_starts_with($origin, 'http://') && !$same) {
                return null; // http solo para el mismo origen (p. ej. un sitio de pruebas local)
            }
            if (!str_starts_with($origin, 'https://') && !str_starts_with($origin, 'http://')) {
                return null;
            }
            $path = $parts['path'] ?? '';
        }

        if (!str_starts_with($path, '/') || !str_ends_with(strtolower($path), '.js')) {
            return null;
        }
        foreach (explode('/', rawurldecode($path)) as $seg) {
            if ($seg === '.' || $seg === '..') {
                return null;
            }
        }

        return $url;
    }

    /** «https://Ejemplo.es:443/» → «https://ejemplo.es». null si no es un origen http(s) válido. */
    public static function normalizeOrigin(string $origin): ?string
    {
        $origin = strtolower(rtrim(trim($origin, " \t\r\n"), '/'));
        if (!preg_match('~^(https?)://([a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?)(?::([0-9]{1,5}))?$~D', $origin, $m)) {
            return null;
        }
        $port = $m[3] ?? '';
        if (($m[1] === 'https' && $port === '443') || ($m[1] === 'http' && $port === '80')) {
            $port = '';
        }

        return $m[1] . '://' . $m[2] . ($port !== '' ? ':' . $port : '');
    }

    /**
     * ¿La página ya incluye el cargador? Se busca en las etiquetas <script> de apertura: misma ruta
     * que el cargador configurado, una ruta que acabe en «/rufi/rufi.js» o cualquier
     * data-rufi-config. Es conservador: un cargador comentado también cuenta (mejor no insertar).
     */
    public static function hasLoader(string $html, string $loaderUrl): bool
    {
        if (stripos($html, 'rufi') === false) {
            return false;
        }
        $loaderPath = self::urlPath($loaderUrl);
        if (!preg_match_all('/<script\b[^>]*>/i', $html, $m)) {
            return false;
        }
        foreach ($m[0] as $tag) {
            if (preg_match('/\sdata-rufi-config\b/i', $tag)) {
                return true;
            }
            if (preg_match('/\ssrc\s*=\s*(?:"([^"]*)"|\'([^\']*)\'|([^\s>]+))/i', $tag, $a)) {
                $src  = html_entity_decode(($a[1] ?? '') . ($a[2] ?? '') . ($a[3] ?? ''), ENT_QUOTES | ENT_HTML5, 'UTF-8');
                $path = self::urlPath($src);
                if ($path !== '' && ($path === $loaderPath || str_ends_with(strtolower($path), '/rufi/rufi.js'))) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Posición del último «</body>» real: se saltan comentarios, declaraciones (<!…>, <?…>),
     * atributos de etiquetas y el contenido de <script>, <style>, <textarea>, <template>, etc.
     * null si no hay ninguno.
     */
    public static function findBodyClose(string $html): ?int
    {
        $len  = \strlen($html);
        $i    = 0;
        $last = null;
        while ($i < $len && ($lt = strpos($html, '<', $i)) !== false) {
            $next = $html[$lt + 1] ?? '';

            if ($next === '!') {
                if (substr_compare($html, '<!--', $lt, 4) === 0) {
                    $end = strpos($html, '-->', $lt + 4);
                    if ($end === false) {
                        break; // comentario sin cerrar: el resto es comentario
                    }
                    $i = $end + 3;
                    continue;
                }
                if (substr_compare($html, '<![CDATA[', $lt, 9) === 0) {
                    $end = strpos($html, ']]>', $lt + 9);
                    if ($end === false) {
                        break;
                    }
                    $i = $end + 3;
                    continue;
                }
                $end = strpos($html, '>', $lt + 2);
                if ($end === false) {
                    break;
                }
                $i = $end + 1;
                continue;
            }
            if ($next === '?') {
                $end = strpos($html, '>', $lt + 2);
                if ($end === false) {
                    break;
                }
                $i = $end + 1;
                continue;
            }
            if ($next === '/') {
                if (preg_match('/\G<\/body(?=[\s\/>])/i', $html, $mm, 0, $lt)) {
                    $last = $lt;
                }
                $end = strpos($html, '>', $lt + 2);
                if ($end === false) {
                    break;
                }
                $i = $end + 1;
                continue;
            }
            if (preg_match('/\G<([A-Za-z][A-Za-z0-9-]*)/', $html, $mm, 0, $lt)) {
                $name = strtolower($mm[1]);
                $end  = self::tagEnd($html, $lt + 1 + \strlen($mm[1]));
                if ($end === null) {
                    break;
                }
                $i = $end + 1;
                if ($name === 'plaintext') {
                    break; // todo lo que sigue es texto
                }
                if (\in_array($name, self::RAW_TEXT, true)) { // en HTML, «<script/>» no se cierra solo
                    $close = self::findClosing($html, $name, $i);
                    if ($close === null) {
                        break; // sin cierre: el resto es contenido del elemento
                    }
                    $i = $close;
                }
                continue;
            }
            $i = $lt + 1; // «<» suelto en el texto
        }

        return $last;
    }

    /** Ajustes del plugin saneados. Las entradas no válidas se ignoran (nunca se insertan). */
    public static function normalizeSettings(array $settings): array
    {
        // Solo se recortan espacios y saltos de línea del formulario; un NUL u otro control invalida el valor.
        $trim = static fn (string $v): string => trim($v, " \t\r\n");
        $lines = static function (mixed $v) use ($trim): array {
            if (\is_string($v)) {
                $v = preg_split('/\r\n|\r|\n/', $v) ?: [];
            }
            if (!\is_array($v)) {
                return [];
            }

            return array_values(array_filter(array_map(static fn ($x): string => \is_scalar($x) ? $trim((string) $x) : '', $v), static fn (string $x): bool => $x !== '' && !str_starts_with($x, '#')));
        };
        $rows = static function (mixed $v): array {
            if (\is_object($v)) {
                $v = get_object_vars($v);
            }

            return \is_array($v) ? array_values(array_map(static fn ($r): array => \is_object($r) ? get_object_vars($r) : (\is_array($r) ? $r : []), $v)) : [];
        };

        $excluded = [];
        foreach ($lines($settings['excluded_paths'] ?? []) as $p) {
            $n = self::normalizePath($p);
            if ($n !== null) {
                $excluded[] = $n;
            }
        }

        $origins = [];
        foreach ($lines($settings['allowed_origins'] ?? []) as $o) {
            $n = self::normalizeOrigin($o);
            if ($n !== null) {
                $origins[] = $n;
            }
        }

        $urlMap = [];
        foreach ($rows($settings['url_map'] ?? []) as $r) {
            $match  = ($r['match'] ?? 'exact') === 'prefix' ? 'prefix' : 'exact';
            $path   = self::normalizePath($trim((string) ($r['path'] ?? '')));
            $config = $trim((string) ($r['config'] ?? ''));
            if ($path !== null && self::isValidConfigName($config)) {
                $urlMap[] = ['match' => $match, 'path' => $path, 'config' => $config];
            }
        }

        $menuMap = [];
        foreach ($rows($settings['menu_map'] ?? []) as $r) {
            $id     = filter_var($r['itemid'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
            $config = $trim((string) ($r['config'] ?? ''));
            if ($id !== false && self::isValidConfigName($config)) {
                $menuMap[] = ['itemid' => $id, 'config' => $config];
            }
        }

        $enabled = $settings['enabled'] ?? false;

        return [
            'enabled'         => $enabled === true || $enabled === 1 || $enabled === '1',
            'loader_url'      => \is_string($settings['loader_url'] ?? null) && $trim($settings['loader_url']) !== '' ? $settings['loader_url'] : self::DEFAULT_LOADER_URL,
            'allowed_origins' => $origins,
            'url_map'         => $urlMap,
            'menu_map'        => $menuMap,
            'excluded_paths'  => $excluded,
            'fallback'        => ($settings['fallback'] ?? 'none') === 'routes' ? 'routes' : 'none',
        ];
    }

    /** Orden: reglas por URL (en su orden; gana la primera) y después el elemento de menú activo. */
    public static function resolveConfig(array $normalizedSettings, string $path, mixed $itemid): ?string
    {
        foreach ($normalizedSettings['url_map'] as $r) {
            if ($r['match'] === 'exact' ? $path === $r['path'] : self::pathUnder($path, $r['path'])) {
                return $r['config'];
            }
        }
        $id = filter_var($itemid, FILTER_VALIDATE_INT);
        if ($id !== false) {
            foreach ($normalizedSettings['menu_map'] as $r) {
                if ($r['itemid'] === $id) {
                    return $r['config'];
                }
            }
        }

        return null;
    }

    /** Motivo para no tocar la respuesta, o null si es una página HTML pública normal. */
    private static function requestSkipReason(array $r, string $html): ?string
    {
        if (($r['client'] ?? null) !== 'site') {
            return 'no-es-sitio';
        }
        if (!empty($r['is_ajax']) || strtolower((string) ($r['option'] ?? '')) === 'com_ajax') {
            return 'ajax';
        }
        $format = strtolower((string) ($r['format'] ?? ''));
        if ($format !== '' && $format !== 'html') {
            return 'formato-no-html';
        }
        if (\in_array(strtolower((string) ($r['tmpl'] ?? '')), ['component', 'raw'], true)) {
            return 'tmpl-' . strtolower((string) $r['tmpl']);
        }
        $doc = $r['document_type'] ?? null;
        if ($doc !== null && strtolower((string) $doc) !== 'html') {
            return strtolower((string) $doc) === 'error' ? 'pagina-de-error' : 'documento-no-html';
        }
        $status = (int) ($r['status'] ?? 200);
        if ($status < 200 || $status > 299) {
            return 'pagina-de-error';
        }
        $ct = $r['content_type'] ?? null;
        if ($ct !== null && $ct !== '' && strtolower(trim(explode(';', (string) $ct, 2)[0])) !== 'text/html') {
            return 'no-html';
        }
        $start = ltrim(substr($html, 0, 64), "\xEF\xBB\xBF \t\r\n");
        if ($start === '' || $start[0] === '{' || $start[0] === '[') {
            return 'no-html';
        }

        return null;
    }

    /** Fin («>») de una etiqueta de apertura, respetando valores de atributo entre comillas. */
    private static function tagEnd(string $html, int $from): ?int
    {
        $len = \strlen($html);
        for ($j = $from; $j < $len; $j++) {
            $c = $html[$j];
            if ($c === '>') {
                return $j;
            }
            if ($c === '=') {
                $k = $j + 1;
                while ($k < $len && strpos(" \t\r\n\f", $html[$k]) !== false) {
                    $k++;
                }
                if ($k < $len && ($html[$k] === '"' || $html[$k] === "'")) {
                    $q = strpos($html, $html[$k], $k + 1);
                    if ($q === false) {
                        return null;
                    }
                    $j = $q;
                }
            }
        }

        return null;
    }

    /** Posición justo después de «</name …>», buscando desde $from. */
    private static function findClosing(string $html, string $name, int $from): ?int
    {
        while (preg_match('/<\/' . $name . '(?=[\s\/>])/i', $html, $m, PREG_OFFSET_CAPTURE, $from)) {
            $end = strpos($html, '>', $m[0][1]);

            return $end === false ? null : $end + 1;
        }

        return null;
    }

    private static function urlPath(string $url): string
    {
        $url = trim($url);
        if (preg_match('~^[a-z][a-z0-9+.-]*:~i', $url) || str_starts_with($url, '//')) {
            $p = parse_url(str_starts_with($url, '//') ? 'https:' . $url : $url, PHP_URL_PATH);

            return \is_string($p) ? $p : '';
        }

        return explode('#', explode('?', $url, 2)[0], 2)[0];
    }
}
