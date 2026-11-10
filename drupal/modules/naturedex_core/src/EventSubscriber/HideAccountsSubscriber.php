<?php

declare(strict_types=1);

namespace Drupal\naturedex_core\EventSubscriber;

use Symfony\Component\EventDispatcher\EventSubscriberInterface;
use Symfony\Component\HttpKernel\Event\ExceptionEvent;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Symfony\Component\HttpKernel\KernelEvents;

/**
 * Answers "not found" for account pages a visitor may not see.
 *
 * Core returns 403 for /user/1 and 404 for an ID that doesn't exist, so anyone
 * can count the accounts and find the administrator's. Here both are 404.
 */
final class HideAccountsSubscriber implements EventSubscriberInterface {

  public static function getSubscribedEvents(): array {
    // Before core's exception subscribers turn the 403 into a page.
    return [KernelEvents::EXCEPTION => ['onException', 100]];
  }

  public function onException(ExceptionEvent $event): void {
    $request = $event->getRequest();
    if (
      $event->getThrowable() instanceof AccessDeniedHttpException
      && str_starts_with((string) $request->attributes->get('_route'), 'entity.user.')
      && $request->attributes->has('user')
    ) {
      $event->setThrowable(new NotFoundHttpException());
    }
  }

}
