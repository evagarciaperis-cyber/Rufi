<?php

/**
 * Comprobaciones estáticas del plugin: manifiesto, estructura, idiomas y sintaxis PHP.
 * No sustituyen a una instalación real en Joomla (no hecha: ver docs/20-fase-f-plugin-joomla.md).
 */

declare(strict_types=1);

T::group('Estructura y manifiesto');

$xmlPath = RUFI_PLUGIN . '/rufi.xml';
$prev    = libxml_use_internal_errors(true);
$xml     = simplexml_load_file($xmlPath);
T::ok($xml !== false, 'rufi.xml es XML bien formado', implode(' ', array_map(static fn ($e) => trim($e->message), libxml_get_errors())));
libxml_use_internal_errors($prev);

if ($xml !== false) {
    T::eq((string) $xml->getName(), 'extension', 'raíz <extension>');
    T::eq((string) $xml['type'], 'plugin', 'type="plugin"');
    T::eq((string) $xml['group'], 'system', 'group="system"');
    T::eq((string) $xml['method'], 'upgrade', 'method="upgrade"');
    T::eq((string) $xml->name, 'plg_system_rufi', '<name>');
    T::ok((bool) preg_match('/^\d+\.\d+\.\d+$/', (string) $xml->version), '<version> semántica: ' . $xml->version);
    T::eq((string) $xml->namespace, 'ReferenceHome\\Plugin\\System\\Rufi', 'namespace del plugin');
    T::eq((string) $xml->namespace['path'], 'src', 'namespace path="src"');

    $pluginAttr = null;
    $listed     = [];
    foreach ($xml->files->children() as $node) {
        $listed[] = (string) $node;
        if (isset($node['plugin'])) {
            $pluginAttr = (string) $node['plugin'];
        }
        T::ok(file_exists(RUFI_PLUGIN . '/' . $node), "<files> {$node->getName()} «{$node}» existe");
    }
    T::eq($pluginAttr, 'rufi', 'elemento plugin="rufi" en <files> (nombre del plugin)');
    T::ok(\in_array('services', $listed, true) && \in_array('src', $listed, true), '<files> incluye services y src');

    foreach ($xml->languages->language as $lang) {
        T::ok(is_file(RUFI_PLUGIN . '/' . $xml->languages['folder'] . '/' . $lang), "idioma {$lang['tag']}: {$lang}");
    }

    // Campos pedidos en la fase F.
    $fields = [];
    foreach ($xml->xpath('//config/fields[@name="params"]//field') as $f) {
        $fields[(string) $f['name']] = $f;
    }
    foreach (['enabled', 'loader_url', 'allowed_origins', 'url_map', 'menu_map', 'excluded_paths', 'fallback', 'note_site'] as $name) {
        T::ok(isset($fields[$name]), "campo {$name}");
    }
    T::eq((string) ($fields['loader_url']['default'] ?? ''), '/rufi/rufi.js', 'URL del cargador por defecto /rufi/rufi.js');
    T::eq((string) ($fields['enabled']['default'] ?? ''), '0', 'interruptor general apagado por defecto');
    T::eq((string) ($fields['fallback']['default'] ?? ''), 'none', 'sin configuración: no insertar (por defecto)');
    T::eq((string) ($fields['itemid']['type'] ?? ''), 'menuitem', 'elemento de menú con el campo menuitem');

    // Todas las claves de idioma usadas en el manifiesto existen en los dos idiomas.
    preg_match_all('/\b(PLG_SYSTEM_RUFI[A-Z0-9_]*)\b/', (string) file_get_contents($xmlPath), $m);
    $used = array_values(array_unique($m[1]));
}

T::group('Idiomas');

$keys = [];
foreach (['es-ES', 'en-GB'] as $tag) {
    foreach (['plg_system_rufi.ini', 'plg_system_rufi.sys.ini'] as $file) {
        $path = RUFI_PLUGIN . "/language/{$tag}/{$file}";
        $raw  = (string) file_get_contents($path);
        $ini  = @parse_ini_string($raw, false, INI_SCANNER_RAW);
        T::ok(\is_array($ini) && $ini !== [], "{$tag}/{$file}: se puede leer como INI");
        $bad = [];
        foreach (preg_split('/\R/', $raw) as $n => $line) {
            if ($line === '' || $line[0] === ';') {
                continue;
            }
            if (!preg_match('/^[A-Z0-9_]+="[^"]*"$/', $line)) {
                $bad[] = $n + 1;
            }
        }
        T::ok($bad === [], "{$tag}/{$file}: formato CLAVE=\"valor\" sin comillas dobles dentro", 'líneas ' . implode(',', $bad));
        T::ok(mb_check_encoding($raw, 'UTF-8') && !str_starts_with($raw, "\xEF\xBB\xBF"), "{$tag}/{$file}: UTF-8 sin BOM");
        $keys[$tag][$file] = \is_array($ini) ? array_keys($ini) : [];
    }
}
T::eq($keys['es-ES'], $keys['en-GB'], 'las mismas claves en es-ES y en-GB');
foreach ($used ?? [] as $k) {
    T::ok(\in_array($k, $keys['es-ES']['plg_system_rufi.ini'], true) && \in_array($k, $keys['en-GB']['plg_system_rufi.ini'], true), "clave {$k} traducida");
}
foreach (['PLG_SYSTEM_RUFI', 'PLG_SYSTEM_RUFI_XML_DESCRIPTION'] as $k) {
    T::ok(\in_array($k, $keys['es-ES']['plg_system_rufi.sys.ini'], true) && \in_array($k, $keys['en-GB']['plg_system_rufi.sys.ini'], true), "{$k} en .sys.ini");
}

T::group('PHP');

$php = [];
foreach ([RUFI_PLUGIN, __DIR__] as $dir) {
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS));
    foreach ($it as $f) {
        if ($f->getExtension() === 'php') {
            $php[] = $f->getPathname();
        }
    }
}
sort($php);
foreach ($php as $file) {
    $out  = [];
    $code = 0;
    exec(escapeshellarg(PHP_BINARY) . ' -l ' . escapeshellarg($file) . ' 2>&1', $out, $code);
    T::ok($code === 0, 'php -l ' . substr($file, \strlen(RUFI_REPO) + 1), implode(' ', $out));
}
foreach ($php as $file) {
    if (!str_starts_with($file, RUFI_PLUGIN)) {
        continue;
    }
    $src = (string) file_get_contents($file);
    T::ok(str_contains($src, "\\defined('_JEXEC') or die;"), 'protección _JEXEC en ' . substr($file, \strlen(RUFI_PLUGIN) + 1));
}

$injector = (string) file_get_contents(RUFI_PLUGIN . '/src/Helper/Injector.php');
T::ok(!preg_match('/^\s*use\s+Joomla\\\\/m', $injector) && !preg_match('/\\\\?Joomla\\\\(CMS|Event|Registry|DI)\\\\/', $injector), 'Helper\\Injector no depende de Joomla');

$ext = (string) file_get_contents(RUFI_PLUGIN . '/src/Extension/Rufi.php');
T::ok(str_contains($ext, 'namespace ReferenceHome\\Plugin\\System\\Rufi\\Extension;'), 'Extension\\Rufi en el namespace del manifiesto');
T::ok(str_contains($ext, 'implements SubscriberInterface') && str_contains($ext, "'onAfterRender' => 'onAfterRender'"), 'se suscribe a onAfterRender');
T::ok(!preg_match('/\bJFactory\b|\bJPlugin\b|\$app->input\b|Factory::getApplication\(\)/', $ext), 'sin API heredada (JFactory, JPlugin, $app->input, Factory en la clase)');
