<?php

/**
 * Rufi · registro del plugin en el contenedor de servicios de Joomla (convención J4/5/6).
 *
 * Forma del constructor (dispatcher + configuración) y setApplication(): la de los plugins del
 * núcleo de Joomla 4.2–5.x. Se espera que siga siendo válida en Joomla 6.2, pero NO se ha probado en
 * un Joomla real (ver docs/20-fase-f-plugin-joomla.md, «Compatibilidad»).
 *
 * @copyright  Reference Home
 * @license    Propietaria (UNLICENSED)
 */

\defined('_JEXEC') or die;

use Joomla\CMS\Extension\PluginInterface;
use Joomla\CMS\Factory;
use Joomla\CMS\Plugin\PluginHelper;
use Joomla\DI\Container;
use Joomla\DI\ServiceProviderInterface;
use Joomla\Event\DispatcherInterface;
use ReferenceHome\Plugin\System\Rufi\Extension\Rufi;

return new class () implements ServiceProviderInterface {
    public function register(Container $container): void
    {
        $container->set(
            PluginInterface::class,
            static function (Container $container) {
                $plugin = new Rufi(
                    $container->get(DispatcherInterface::class),
                    (array) PluginHelper::getPlugin('system', 'rufi')
                );
                $plugin->setApplication(Factory::getApplication());

                return $plugin;
            }
        );
    }
};
