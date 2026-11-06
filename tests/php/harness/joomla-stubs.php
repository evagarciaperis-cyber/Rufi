<?php

/**
 * SIMULACIÓN. Clases FALSAS con los nombres de las de Joomla, reducidas a lo que usa el plugin.
 * Sirven solo para comprobar que services/provider.php y Extension\Rufi conectan bien con
 * Helper\Injector. NO reproducen el comportamiento real de Joomla 6.2 ni lo sustituyen: la
 * instalación en un Joomla real sigue pendiente (docs/20-fase-f-plugin-joomla.md).
 */

declare(strict_types=1);

namespace Joomla\Event {
    interface EventInterface
    {
        public function getName();
    }

    interface SubscriberInterface
    {
        public static function getSubscribedEvents(): array;
    }

    interface DispatcherInterface
    {
    }

    class Event implements EventInterface
    {
        public function __construct(private string $name, private array $arguments = [])
        {
        }

        public function getName()
        {
            return $this->name;
        }
    }

    /** Despachador mínimo: llama a los métodos que declara getSubscribedEvents(). */
    final class FakeDispatcher implements DispatcherInterface
    {
        private array $listeners = [];

        public function addSubscriber(SubscriberInterface $s): void
        {
            foreach ($s::getSubscribedEvents() as $event => $method) {
                $this->listeners[$event][] = [$s, \is_array($method) ? $method[0] : $method];
            }
        }

        public function dispatch(string $name, ?EventInterface $event = null): EventInterface
        {
            $event ??= new Event($name);
            foreach ($this->listeners[$name] ?? [] as $l) {
                $l($event);
            }

            return $event;
        }
    }
}

namespace Joomla\Registry {
    final class Registry
    {
        private object $data;

        public function __construct(mixed $data = null)
        {
            // Como Joomla: los parámetros llegan en JSON y los subformularios quedan como objetos.
            $this->data = \is_string($data) && $data !== '' ? (json_decode($data) ?? new \stdClass()) : (\is_object($data) ? $data : new \stdClass());
        }

        public function get(string $path, mixed $default = null): mixed
        {
            return property_exists($this->data, $path) && $this->data->{$path} !== null && $this->data->{$path} !== '' ? $this->data->{$path} : $default;
        }
    }
}

namespace Joomla\CMS\Extension {
    interface PluginInterface
    {
    }
}

namespace Joomla\CMS\Plugin {
    use Joomla\CMS\Extension\PluginInterface;
    use Joomla\Event\DispatcherInterface;
    use Joomla\Registry\Registry;

    abstract class CMSPlugin implements PluginInterface
    {
        public $params;
        protected $autoloadLanguage = false;
        private $application;

        public function __construct(DispatcherInterface $dispatcher, array $config = [])
        {
            $this->params = new Registry($config['params'] ?? '');
        }

        public function setApplication($application): void
        {
            $this->application = $application;
        }

        protected function getApplication()
        {
            return $this->application;
        }
    }

    final class PluginHelper
    {
        public static string $params = '{}';

        public static function getPlugin(string $type, ?string $plugin = null): object
        {
            return (object) ['type' => $type, 'name' => $plugin, 'params' => self::$params];
        }
    }
}

namespace Joomla\CMS {
    final class Factory
    {
        public static $application;

        public static function getApplication()
        {
            return self::$application;
        }
    }
}

namespace Joomla\CMS\Uri {
    final class Uri
    {
        public static string $current = 'https://referencehome.es/';
        public static string $basePath = '';

        public static function getInstance(): self
        {
            return new self();
        }

        public function getPath(): string
        {
            return (string) parse_url(self::$current, PHP_URL_PATH);
        }

        public function toString(array $parts): string
        {
            $u = parse_url(self::$current);

            return $u['scheme'] . '://' . $u['host'] . (isset($u['port']) ? ':' . $u['port'] : '');
        }

        public static function base(bool $pathonly = false): string
        {
            return $pathonly ? self::$basePath : 'https://referencehome.es' . self::$basePath . '/';
        }
    }
}

namespace Joomla\DI {
    interface ServiceProviderInterface
    {
        public function register(Container $container);
    }

    final class Container
    {
        private array $factories = [];
        private array $values = [];

        public function set(string $key, mixed $value): void
        {
            $this->factories[$key] = $value;
        }

        public function get(string $key): mixed
        {
            if (!\array_key_exists($key, $this->values)) {
                $f                  = $this->factories[$key];
                $this->values[$key] = $f instanceof \Closure ? $f($this) : $f;
            }

            return $this->values[$key];
        }
    }
}

namespace RufiTest {
    /** Aplicación falsa: solo los métodos que llama Extension\Rufi. */
    final class FakeApp
    {
        public int $getBodyCalls = 0;
        public int $setBodyCalls = 0;
        public bool $throwOnGetBody = false;

        public function __construct(
            public string $client = 'site',
            public string $body = '',
            public array $query = [],
            public array $server = [],
            public ?string $docType = 'html',
            public ?int $itemid = null,
            public array $headers = [],
            public ?string $nonce = null,
        ) {
        }

        public function isClient(string $c): bool
        {
            return $this->client === $c;
        }

        public function getBody()
        {
            $this->getBodyCalls++;
            if ($this->throwOnGetBody) {
                throw new \RuntimeException('fallo simulado');
            }

            return $this->body;
        }

        public function setBody($b): void
        {
            $this->setBodyCalls++;
            $this->body = $b;
        }

        public function getHeaders(): array
        {
            return $this->headers;
        }

        public function get(string $k, $d = null)
        {
            return $k === 'csp_nonce' ? $this->nonce : $d;
        }

        public function getInput(): object
        {
            $q = $this->query;
            $s = $this->server;

            return new class ($q, $s) {
                public object $server;

                public function __construct(private array $q, array $s)
                {
                    $this->server = new class ($s) {
                        public function __construct(private array $s)
                        {
                        }

                        public function getString(string $k, string $d = ''): string
                        {
                            return (string) ($this->s[$k] ?? $d);
                        }
                    };
                }

                public function getCmd(string $k, string $d = ''): string
                {
                    return preg_replace('/[^A-Z0-9_.-]/i', '', (string) ($this->q[$k] ?? $d));
                }
            };
        }

        public function getDocument(): ?object
        {
            if ($this->docType === null) {
                return null;
            }
            $t = $this->docType;

            return new class ($t) {
                public function __construct(private string $t)
                {
                }

                public function getType(): string
                {
                    return $this->t;
                }

                public function getMimeEncoding(): string
                {
                    return $this->t === 'json' ? 'application/json' : 'text/html';
                }
            };
        }

        public function getMenu(): object
        {
            $id = $this->itemid;

            return new class ($id) {
                public function __construct(private ?int $id)
                {
                }

                public function getActive(): ?object
                {
                    return $this->id === null ? null : (object) ['id' => $this->id];
                }
            };
        }
    }
}
