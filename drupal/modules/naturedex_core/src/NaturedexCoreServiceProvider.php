<?php

declare(strict_types=1);

namespace Drupal\naturedex_core;

use Drupal\Core\DependencyInjection\ContainerBuilder;
use Drupal\Core\DependencyInjection\ServiceProviderBase;
use Drupal\naturedex_core\Session\SessionConfiguration;

/**
 * Gives the session cookie a fixed name; see Session\SessionConfiguration.
 */
final class NaturedexCoreServiceProvider extends ServiceProviderBase {

  public function alter(ContainerBuilder $container): void {
    $container->getDefinition('session_configuration')->setClass(SessionConfiguration::class);
  }

}
