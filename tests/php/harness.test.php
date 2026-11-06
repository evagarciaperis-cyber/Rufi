<?php

/**
 * SIMULACIÓN del evento onAfterRender con clases falsas de Joomla (tests/php/harness/).
 * Comprueba el cableado provider.php → Extension\Rufi → Helper\Injector. No es un Joomla real.
 */

declare(strict_types=1);

require_once __DIR__ . '/harness/joomla-stubs.php';
require_once RUFI_PLUGIN . '/src/Helper/Injector.php';
require_once RUFI_PLUGIN . '/src/Extension/Rufi.php';

use Joomla\CMS\Extension\PluginInterface;
use Joomla\CMS\Factory;
use Joomla\CMS\Plugin\PluginHelper;
use Joomla\CMS\Uri\Uri;
use Joomla\DI\Container;
use Joomla\Event\DispatcherInterface;
use Joomla\Event\FakeDispatcher;
use ReferenceHome\Plugin\System\Rufi\Extension\Rufi;
use RufiTest\FakeApp;

T::group('Simulación del evento (clases falsas de Joomla, no es un Joomla real)');

$html   = "<!DOCTYPE html>\n<html><head><title>t</title></head><body>\n<p>Hola</p>\n<script>var x='</body>';</script>\n</body>\n</html>\n";
$params = json_encode([
    'enabled'        => '1',
    'loader_url'     => '/rufi/rufi.js',
    // Así guarda Joomla un subformulario repetible: objeto con claves url_map0, url_map1…
    'url_map'        => ['url_map0' => ['match' => 'exact', 'path' => '/ICO/aval-ico-valencia.html', 'config' => 'aval-ico-valencia']],
    'menu_map'       => ['menu_map0' => ['itemid' => '205', 'config' => 'blog-hipotecas']],
    'excluded_paths' => "/component/users\n",
    'fallback'       => 'none',
]);

/** Monta el plugin como lo haría Joomla (provider.php + contenedor) y lanza onAfterRender. */
$run = static function (FakeApp $app, string $url, string $paramsJson = '') use ($params): FakeApp {
    Uri::$current          = $url;
    Factory::$application  = $app;
    PluginHelper::$params  = $paramsJson !== '' ? $paramsJson : $params;
    $dispatcher            = new FakeDispatcher();
    $container             = new Container();
    $container->set(DispatcherInterface::class, $dispatcher);
    $provider = require RUFI_PLUGIN . '/services/provider.php';
    $provider->register($container);
    $plugin = $container->get(PluginInterface::class);
    $dispatcher->addSubscriber($plugin);
    $dispatcher->dispatch('onAfterRender');

    return $app;
};

$plugin = (static function () {
    Factory::$application = new FakeApp();
    $c                    = new Container();
    $c->set(DispatcherInterface::class, new FakeDispatcher());
    (require RUFI_PLUGIN . '/services/provider.php')->register($c);

    return $c->get(PluginInterface::class);
})();
T::ok($plugin instanceof Rufi, 'provider.php registra Extension\Rufi como PluginInterface');
T::eq(Rufi::getSubscribedEvents(), ['onAfterRender' => 'onAfterRender'], 'getSubscribedEvents()');

$tag = "<script src=\"/rufi/rufi.js\" data-rufi-config=\"aval-ico-valencia\" defer></script>\n";
$app = $run(new FakeApp(body: $html), 'https://referencehome.es/ICO/aval-ico-valencia.html?utm_source=x');
$pos = strrpos($html, '</body>');
T::eq($app->body, substr($html, 0, $pos) . $tag . substr($html, $pos), 'sitio, URL asignada: inserta una línea ante el </body> real');
T::eq($app->setBodyCalls, 1, 'setBody() una vez');

$again = $run(new FakeApp(body: $app->body), 'https://referencehome.es/ICO/aval-ico-valencia.html');
T::eq([$again->body, $again->setBodyCalls], [$app->body, 0], 'segunda vez: no toca nada (idempotente)');

$menu = $run(new FakeApp(body: $html, itemid: 205), 'https://referencehome.es/blog/hipotecas/articulo');
T::ok(str_contains($menu->body, 'data-rufi-config="blog-hipotecas"'), 'elemento de menú (subformulario guardado como objeto)');

$admin = $run(new FakeApp(client: 'administrator', body: $html), 'https://referencehome.es/administrator/index.php');
T::eq([$admin->body, $admin->getBodyCalls, $admin->setBodyCalls], [$html, 0, 0], 'administración: ni siquiera lee la respuesta');

$cases = [
    'API (cliente api)'      => [new FakeApp(client: 'api', body: $html), 'https://referencehome.es/ICO/aval-ico-valencia.html'],
    'format=json'            => [new FakeApp(body: $html, query: ['format' => 'json']), 'https://referencehome.es/ICO/aval-ico-valencia.html'],
    'AJAX'                   => [new FakeApp(body: $html, server: ['HTTP_X_REQUESTED_WITH' => 'XMLHttpRequest']), 'https://referencehome.es/ICO/aval-ico-valencia.html'],
    'tmpl=component'         => [new FakeApp(body: $html, query: ['tmpl' => 'component']), 'https://referencehome.es/ICO/aval-ico-valencia.html'],
    'documento JSON'         => [new FakeApp(body: '{"a":1}', docType: 'json'), 'https://referencehome.es/ICO/aval-ico-valencia.html'],
    'página de error (tipo)' => [new FakeApp(body: $html, docType: 'error'), 'https://referencehome.es/ICO/aval-ico-valencia.html'],
    'cabecera Status 404'    => [new FakeApp(body: $html, headers: [['name' => 'status', 'value' => '404']]), 'https://referencehome.es/ICO/aval-ico-valencia.html'],
    'Content-Type JSON'      => [new FakeApp(body: $html, headers: [['name' => 'Content-Type', 'value' => 'application/json']]), 'https://referencehome.es/ICO/aval-ico-valencia.html'],
    'ruta excluida'          => [new FakeApp(body: $html, itemid: 205), 'https://referencehome.es/component/users/login'],
    'sin asignación'         => [new FakeApp(body: $html), 'https://referencehome.es/otra-pagina'],
];
foreach ($cases as $name => [$a, $url]) {
    $before = $a->body;
    $r      = $run($a, $url);
    T::eq([$r->body, $r->setBodyCalls], [$before, 0], "{$name}: intacto");
}

$off = $run(new FakeApp(body: $html), 'https://referencehome.es/ICO/aval-ico-valencia.html', json_encode(['enabled' => '0'] + json_decode($params, true)));
T::eq($off->setBodyCalls, 0, 'interruptor general en No: intacto');
$empty = $run(new FakeApp(body: $html), 'https://referencehome.es/ICO/aval-ico-valencia.html', '{}');
T::eq($empty->setBodyCalls, 0, 'recién instalado (sin ajustes guardados): no inserta');

$boom                 = new FakeApp(body: $html);
$boom->throwOnGetBody = true;
$threw                = false;
try {
    $run($boom, 'https://referencehome.es/ICO/aval-ico-valencia.html');
} catch (\Throwable $e) {
    $threw = true;
}
T::ok(!$threw && $boom->setBodyCalls === 0, 'una excepción interna no rompe la página');

$csp = $run(new FakeApp(body: $html, nonce: 'Q2xhdWRlTm9uY2U='), 'https://referencehome.es/ICO/aval-ico-valencia.html');
T::ok(str_contains($csp->body, 'nonce="Q2xhdWRlTm9uY2U="'), 'usa el nonce de CSP de la aplicación si existe');

Uri::$basePath = '/web';
$sub           = $run(new FakeApp(body: $html), 'https://referencehome.es/web/administrator/index.php', json_encode(['enabled' => '1', 'fallback' => 'routes']));
T::eq($sub->setBodyCalls, 0, 'Joomla en subcarpeta: /web/administrator excluida aunque el cliente dijera site');
Uri::$basePath = '';
