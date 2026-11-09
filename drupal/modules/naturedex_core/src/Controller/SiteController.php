<?php

declare(strict_types=1);

namespace Drupal\naturedex_core\Controller;

use Drupal\Component\Serialization\Json;
use Drupal\Core\Access\CsrfRequestHeaderAccessCheck;
use Drupal\Core\Access\CsrfTokenGenerator;
use Drupal\Core\Controller\ControllerBase;
use Drupal\Core\Render\Markup;
use Drupal\Core\Url;
use Drupal\naturedex_core\PageContext;
use Drupal\naturedex_core\Records;
use Symfony\Component\HttpFoundation\RedirectResponse;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;

/**
 * The site's own pages. Field notes, species, and About are nodes, rendered
 * through NaturedexHooks::nodeView().
 */
final class SiteController extends ControllerBase {

  private const JOURNAL_PAGE_SIZE = 12;

  public function __construct(
    private readonly Records $records,
    private readonly PageContext $pageContext,
    private readonly CsrfTokenGenerator $csrfToken,
  ) {}

  public function guide(): array {
    return $this->guideLayout(FALSE);
  }

  public function map(): array {
    return $this->guideLayout(TRUE);
  }

  public function journal(): array {
    $storage = $this->entityTypeManager()->getStorage('node');
    $ids = $storage->getQuery()
      ->accessCheck(TRUE)
      ->condition('type', 'field_note')
      ->condition('status', 1)
      ->sort('created', 'DESC')
      ->sort('nid', 'DESC')
      ->pager(self::JOURNAL_PAGE_SIZE)
      ->execute();
    return [
      '#theme' => 'naturedex_journal',
      '#cards' => array_map($this->records->card(...), array_values($storage->loadMultiple($ids))),
      '#pager' => ['#type' => 'pager'],
      '#cache' => ['tags' => Records::CACHE_TAGS, 'contexts' => ['url.query_args.pagers']],
    ];
  }

  /**
   * The Writing desk. The only page carrying a CSRF token, so every public
   * page stays cacheable.
   */
  public function editor(): array|RedirectResponse {
    $account = $this->currentUser();
    if ($account->isAnonymous()) {
      return new RedirectResponse(Url::fromRoute('user.login', [], ['query' => ['destination' => '/editor']])->toString());
    }
    if (!$account->hasPermission('use naturedex writing desk')) {
      throw new AccessDeniedHttpException();
    }
    $config = [
      // The client appends "posts" and "posts/{id}" to this root.
      'root' => preg_replace('#posts$#', '', Url::fromRoute('naturedex.api.posts')->toString()),
      'csrfToken' => $this->csrfToken->get(CsrfRequestHeaderAccessCheck::TOKEN_KEY),
      'tokenUrl' => Url::fromRoute('system.csrftoken')->toString(),
    ];
    return [
      '#theme' => 'naturedex_desk',
      '#config' => Markup::create(Json::encode($config)),
      '#species' => $this->records->species(),
      '#can_publish' => $account->hasPermission('administer node published status'),
      '#account_name' => $account->getDisplayName(),
      '#cache' => ['max-age' => 0],
    ];
  }

  public function notFound(): array {
    return ['#theme' => 'naturedex_error', '#kind' => $this->pageContext->isJournalAddress() ? 'journal' : 'not_found', '#cache' => ['contexts' => ['url.path']]];
  }

  public function accessDenied(): array {
    $kind = match (TRUE) {
      $this->pageContext->isJournalAddress() => 'journal',
      $this->pageContext->isEditorAddress() => 'editor',
      default => 'access_denied',
    };
    return ['#theme' => 'naturedex_error', '#kind' => $kind, '#cache' => ['contexts' => ['url.path']]];
  }

  private function guideLayout(bool $isMap): array {
    return [
      '#theme' => 'naturedex_guide',
      '#species' => $this->records->species(),
      '#regions' => $this->records->regions(),
      '#groups' => $this->records->groups(),
      '#recent' => array_map($this->records->card(...), $this->records->recentNotes(2)),
      '#is_map' => $isMap,
      '#cardinal' => $this->records->findSpecies('northern-cardinal'),
      '#outline' => $this->records->mapOutline(),
      '#cache' => ['tags' => Records::CACHE_TAGS],
    ];
  }

}
