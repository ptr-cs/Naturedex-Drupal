<?php

declare(strict_types=1);

namespace Drupal\naturedex_core\EventSubscriber;

use Drupal\Core\Session\AccountInterface;
use Drupal\naturedex_core\Status;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;
use Symfony\Component\HttpKernel\Event\ResponseEvent;
use Symfony\Component\HttpKernel\KernelEvents;

/**
 * Lets CloudFront keep the anonymous /status page for five minutes.
 *
 * SiteController::status() keeps the page out of Drupal's own page cache, which
 * would otherwise hold it until the next content save, so Drupal marks the
 * response uncacheable. The page is the same for every anonymous visitor, so a
 * shared cache may still keep it as long as the GitHub data it shows.
 */
final class StatusCacheSubscriber implements EventSubscriberInterface {

  public function __construct(
    private readonly AccountInterface $currentUser,
    private readonly Status $status,
  ) {}

  public static function getSubscribedEvents(): array {
    // After Drupal's FinishResponseSubscriber, which runs at priority 0.
    return [KernelEvents::RESPONSE => ['onResponse', -100]];
  }

  public function onResponse(ResponseEvent $event): void {
    $maxAge = $this->status->maxAge();
    if (
      !$event->isMainRequest()
      || $event->getRequest()->attributes->get('_route') !== 'naturedex.status'
      || !$event->getResponse()->isOk()
      || !$this->currentUser->isAnonymous()
      || $maxAge === 0
    ) {
      return;
    }
    $headers = $event->getResponse()->headers;
    $headers->set('Cache-Control', "public, max-age=0, s-maxage=$maxAge");
    $headers->remove('Expires');
  }

}
