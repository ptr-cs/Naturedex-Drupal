<?php

declare(strict_types=1);

namespace Drupal\naturedex_core\StackMiddleware;

use Drupal\Core\Site\Settings;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\HttpKernelInterface;

/**
 * Restores what the plain-HTTP hop from the load balancer loses.
 *
 * On AWS, requests arrive CloudFront -> load balancer -> Drupal over HTTP, from
 * the load balancer's address. Only the load balancer can reach the container
 * and only CloudFront can reach the load balancer, so CloudFront's own headers
 * are trustworthy there. They restore the visitor's scheme (secure cookies and
 * https links) and address (login flood control would otherwise count every
 * visitor as one).
 *
 * Drupal's reverse-proxy settings can't do this: the load balancer overwrites
 * X-Forwarded-Proto with "http", and appends CloudFront's own address to
 * X-Forwarded-For. This runs before the page cache, which keys on the scheme.
 * It does nothing unless settings.php sets naturedex_cloudfront.
 */
final class CloudFrontMiddleware implements HttpKernelInterface {

  public function __construct(private readonly HttpKernelInterface $httpKernel) {}

  public function handle(Request $request, int $type = self::MAIN_REQUEST, bool $catch = TRUE): Response {
    if ($type === self::MAIN_REQUEST && Settings::get('naturedex_cloudfront', FALSE)) {
      self::apply($request);
    }
    return $this->httpKernel->handle($request, $type, $catch);
  }

  public static function apply(Request $request): void {
    if ($request->headers->get('CloudFront-Forwarded-Proto') === 'https') {
      $request->server->set('HTTPS', 'on');
      $request->server->set('SERVER_PORT', '443');
    }
    if (preg_match('/^(.+):\d+$/', (string) $request->headers->get('CloudFront-Viewer-Address'), $match)
      && filter_var($match[1], FILTER_VALIDATE_IP)) {
      $request->server->set('REMOTE_ADDR', $match[1]);
    }
  }

}
