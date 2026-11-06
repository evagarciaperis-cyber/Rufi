<?php

/**
 * Pruebas aisladas del plugin de Joomla (fase F). Se ejecutan con PHP a secas, sin PHPUnit ni
 * Joomla:
 *
 *     php tests/php/run.php
 *
 * - injector.test.php: Helper\Injector (puro, sin Joomla).
 * - static.test.php:   manifiesto XML, idiomas y estructura del plugin.
 * - harness.test.php:  SIMULACIÓN del evento onAfterRender con clases falsas de Joomla
 *                      (no es un Joomla real; solo comprueba que Extension\Rufi usa bien el Helper).
 *
 * Sale con código 1 si falla alguna.
 */

declare(strict_types=1);

\define('_JEXEC', 1);
\define('RUFI_REPO', \dirname(__DIR__, 2));
\define('RUFI_PLUGIN', RUFI_REPO . '/integrations/joomla/plg_system_rufi');

final class T
{
    public static int $pass = 0;
    public static array $fail = [];
    public static string $group = '';

    public static function group(string $name): void
    {
        self::$group = $name;
        echo "\n# {$name}\n";
    }

    public static function ok(bool $cond, string $name, string $detail = ''): void
    {
        if ($cond) {
            self::$pass++;
            echo "✓ {$name}\n";
        } else {
            self::$fail[] = self::$group . ' › ' . $name;
            echo "✗ {$name}" . ($detail !== '' ? "\n    {$detail}" : '') . "\n";
        }
    }

    public static function eq(mixed $actual, mixed $expected, string $name): void
    {
        self::ok($actual === $expected, $name, 'esperado ' . var_export($expected, true) . ', obtenido ' . var_export($actual, true));
    }
}

$only = $argv[1] ?? null;
foreach (['injector', 'static', 'harness'] as $suite) {
    if ($only !== null && $only !== $suite) {
        continue;
    }
    require __DIR__ . "/{$suite}.test.php";
}

$total = T::$pass + \count(T::$fail);
echo "\n" . T::$pass . "/{$total} superadas\n";
if (T::$fail) {
    echo "Fallos:\n  - " . implode("\n  - ", T::$fail) . "\n";
    exit(1);
}
