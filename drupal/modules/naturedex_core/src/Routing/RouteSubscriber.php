<?php

declare(strict_types=1);

namespace Drupal\naturedex_core\Routing;

use Drupal\Core\Routing\RouteSubscriberBase;
use Symfony\Component\Routing\RouteCollection;

/**
 * Closes Drupal's generic term pages. Groups, regions, and categories are
 * shown through the guide's filters and the journal, so a bare term listing
 * would only be a second, unstyled way to reach the same content.
 */
final class RouteSubscriber extends RouteSubscriberBase {

  protected function alterRoutes(RouteCollection $collection): void {
    $collection->get('entity.taxonomy_term.canonical')?->setRequirement('_permission', 'access taxonomy overview');
  }

}
