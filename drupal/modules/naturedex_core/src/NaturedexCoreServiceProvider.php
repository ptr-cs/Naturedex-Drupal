<?php

declare(strict_types=1);

namespace Drupal\naturedex_core;

use Drupal\Core\DependencyInjection\ContainerBuilder;
use Drupal\Core\DependencyInjection\ServiceProviderBase;
use Drupal\naturedex_core\Session\SessionConfiguration;

/**
 * Adjusts core services for a site that sits behind a shared cache.
 */
final class NaturedexCoreServiceProvider extends ServiceProviderBase {

  /** Signed-in sessions end after this long without a request. */
  public const SESSION_IDLE_SECONDS = 43200;

  public function alter(ContainerBuilder $container): void {
    // A fixed cookie name; see Session\SessionConfiguration.
    $container->getDefinition('session_configuration')->setClass(SessionConfiguration::class);

    // Core keeps a session cookie for 23 days. Here it lasts until the browser
    // closes, and the server forgets a session after 12 idle hours.
    $options = $container->getParameter('session.storage.options');
    $container->setParameter('session.storage.options', [
      'cookie_lifetime' => 0,
      'gc_maxlifetime' => self::SESSION_IDLE_SECONDS,
    ] + $options);

    // "X-Generator: Drupal 11" helps scanners pick targets and nobody else.
    $container->removeDefinition('response_generator_subscriber');
  }

}
