<?php

declare(strict_types=1);

namespace Drupal\naturedex_core\Session;

use Drupal\Core\Session\SessionConfiguration as CoreSessionConfiguration;
use Symfony\Component\HttpFoundation\Request;

/**
 * Names the session cookie SSESSnaturedex (SESSnaturedex over plain HTTP).
 *
 * Drupal derives the name from a hash of the host, which isn't known until
 * CloudFront creates the distribution. CloudFront needs the exact name to keep
 * signed-in visitors out of the shared page cache.
 */
final class SessionConfiguration extends CoreSessionConfiguration {

  public const NAME = 'naturedex';

  protected function getName(Request $request) {
    return ($request->isSecure() ? 'SSESS' : 'SESS') . self::NAME;
  }

}
