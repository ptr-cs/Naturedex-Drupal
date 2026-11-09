<?php

declare(strict_types=1);

namespace Drupal\naturedex_core\EventSubscriber;

use Symfony\Component\EventDispatcher\EventSubscriberInterface;
use Symfony\Component\HttpKernel\Event\ResponseEvent;
use Symfony\Component\HttpKernel\KernelEvents;

/**
 * Lets a shared cache such as CloudFront keep anonymous pages, but not
 * browsers.
 *
 * Drupal marks a cacheable anonymous page "public, max-age=N", where N is the
 * page cache maximum age (0 locally, so this does nothing there). Drupal clears
 * its own cache on every save, but a browser could keep showing an old page for
 * N seconds, so the age moves to s-maxage. Missing pages are kept for a minute.
 */
final class SharedCacheSubscriber implements EventSubscriberInterface {

  public static function getSubscribedEvents(): array {
    // After Drupal's FinishResponseSubscriber, which runs at priority 0.
    return [KernelEvents::RESPONSE => ['onResponse', -100]];
  }

  public function onResponse(ResponseEvent $event): void {
    $response = $event->getResponse();
    $headers = $response->headers;
    $age = (int) $headers->getCacheControlDirective('max-age');
    if (!$headers->hasCacheControlDirective('public') || $age === 0 || $headers->hasCacheControlDirective('s-maxage')) {
      return;
    }
    $response->setSharedMaxAge($response->isClientError() ? min(60, $age) : $age);
    $response->setMaxAge(0);
    $headers->remove('Expires');
  }

}
