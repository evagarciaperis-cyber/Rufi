<?php

/**
 * Rufi · plugin de sistema para Joomla 6.
 *
 * Inserta en las páginas públicas la línea del cargador central de Rufi
 * (`<script src="/rufi/rufi.js" data-rufi-config="<nombre>" defer></script>`) justo antes de
 * </body>, en el evento onAfterRender. No modifica plantillas, artículos ni base de datos: la
 * inserción se hace en memoria sobre la respuesta, así que desactivar o desinstalar el plugin deja
 * las páginas exactamente como estaban (salvo copias en caché, ver docs/20-fase-f-plugin-joomla.md).
 *
 * Toda la lógica de decisión e inserción está en Helper\Injector (sin dependencias de Joomla,
 * probado aparte en tests/php/). Esta clase solo traduce Joomla → datos y nunca rompe la página:
 * cualquier excepción deja la respuesta intacta.
 *
 * @copyright  Reference Home
 * @license    Propietaria (UNLICENSED)
 */

declare(strict_types=1);

namespace ReferenceHome\Plugin\System\Rufi\Extension;

\defined('_JEXEC') or die;

use Joomla\CMS\Plugin\CMSPlugin;
use Joomla\CMS\Uri\Uri;
use Joomla\Event\EventInterface;
use Joomla\Event\SubscriberInterface;
use ReferenceHome\Plugin\System\Rufi\Helper\Injector;

final class Rufi extends CMSPlugin implements SubscriberInterface
{
    /** En el sitio público no hace falta cargar los textos del plugin. */
    protected $autoloadLanguage = false;

    public static function getSubscribedEvents(): array
    {
        return ['onAfterRender' => 'onAfterRender'];
    }

    public function onAfterRender(?EventInterface $event = null): void
    {
        $app = $this->getApplication();

        // Nunca en el área de administración ni en la API: es lo primero que se comprueba.
        if ($app === null || !$app->isClient('site')) {
            return;
        }

        try {
            $body = $app->getBody();
            if (!\is_string($body) || $body === '') {
                return;
            }
            $result = Injector::process($body, $this->settings(), $this->requestContext($app));
            if ($result['injected']) {
                $app->setBody($result['html']);
            }
        } catch (\Throwable $e) {
            // La página siempre es más importante que Rufi: si algo falla, se deja tal cual.
            return;
        }
    }

    /** Ajustes del plugin como datos simples (los subformularios llegan como objetos). */
    private function settings(): array
    {
        $p       = $this->params;
        $toArray = static fn (mixed $v): array => \is_array($v) || \is_object($v) ? (json_decode((string) json_encode($v), true) ?: []) : [];

        return [
            'enabled'         => (string) $p->get('enabled', '0'),
            'loader_url'      => (string) $p->get('loader_url', Injector::DEFAULT_LOADER_URL),
            'allowed_origins' => (string) $p->get('allowed_origins', ''),
            'url_map'         => $toArray($p->get('url_map', [])),
            'menu_map'        => $toArray($p->get('menu_map', [])),
            'excluded_paths'  => (string) $p->get('excluded_paths', ''),
            'fallback'        => (string) $p->get('fallback', 'none'),
        ];
    }

    /** Resumen de la petición y de la respuesta que necesita el inyector. */
    private function requestContext(object $app): array
    {
        $input  = $app->getInput();
        $uri    = Uri::getInstance();
        $doc    = $app->getDocument();
        $active = null;
        if (method_exists($app, 'getMenu')) {
            $menu   = $app->getMenu();
            $active = $menu ? $menu->getActive() : null;
        }

        $status      = null;
        $contentType = null;
        foreach ((array) $app->getHeaders() as $h) {
            $name = strtolower((string) ($h['name'] ?? ''));
            if ($name === 'status') {
                $status = (int) $h['value'];
            } elseif ($name === 'content-type') {
                $contentType = (string) $h['value'];
            }
        }
        if ($status === null) {
            $code   = http_response_code();
            $status = \is_int($code) && $code > 0 ? $code : 200;
        }
        if ($contentType === null && $doc !== null && method_exists($doc, 'getMimeEncoding')) {
            $contentType = (string) $doc->getMimeEncoding();
        }

        $nonce = method_exists($app, 'get') ? $app->get('csp_nonce') : null;

        return [
            'client'        => 'site',
            'path'          => (string) $uri->getPath(),
            'base_path'     => (string) Uri::base(true),
            'origin'        => (string) $uri->toString(['scheme', 'host', 'port']),
            'itemid'        => $active !== null && isset($active->id) ? (int) $active->id : null,
            'format'        => (string) $input->getCmd('format', ''),
            'tmpl'          => (string) $input->getCmd('tmpl', ''),
            'option'        => (string) $input->getCmd('option', ''),
            'is_ajax'       => strtolower((string) $input->server->getString('HTTP_X_REQUESTED_WITH', '')) === 'xmlhttprequest',
            'document_type' => $doc !== null && method_exists($doc, 'getType') ? (string) $doc->getType() : null,
            'content_type'  => $contentType,
            'status'        => $status,
            'csp_nonce'     => \is_string($nonce) && $nonce !== '' ? $nonce : null,
        ];
    }
}
