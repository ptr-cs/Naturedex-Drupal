<?php

declare(strict_types=1);

namespace Drupal\naturedex_core\Hook;

use Drupal\Component\Serialization\Json;
use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Entity\Display\EntityViewDisplayInterface;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Hook\Attribute\Hook;
use Drupal\Core\Hook\Order\Order;
use Drupal\Core\Render\Markup;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\Theme\ThemeManagerInterface;
use Drupal\naturedex_core\PageContext;
use Drupal\naturedex_core\Records;
use Drupal\node\NodeInterface;

final class NaturedexHooks {

  /** Address prefixes for bundles whose path alias follows their slug. */
  private const PREFIXES = ['species' => '/species/', 'field_note' => '/journal/', 'page' => '/'];

  public function __construct(
    private readonly Records $records,
    private readonly PageContext $pageContext,
    private readonly ThemeManagerInterface $themeManager,
  ) {}

  #[Hook('theme')]
  public function theme(): array {
    $hooks = [
      'naturedex_guide' => ['species' => [], 'regions' => [], 'groups' => [], 'recent' => [], 'is_map' => FALSE, 'cardinal' => NULL, 'outline' => ''],
      'naturedex_journal' => ['cards' => [], 'pager' => NULL],
      'naturedex_article' => ['note' => [], 'body' => NULL, 'related' => [], 'regions' => []],
      'naturedex_species_page' => ['species' => [], 'regions' => [], 'edit_url' => NULL],
      'naturedex_page' => ['body' => NULL, 'deer' => NULL, 'edit_url' => NULL],
      'naturedex_desk' => ['config' => '', 'species' => [], 'can_publish' => FALSE, 'account_name' => ''],
      'naturedex_error' => ['kind' => 'not_found'],
      'naturedex_sidebar' => ['items' => [], 'total' => 0],
      'naturedex_topbar' => ['crumb' => ''],
      'naturedex_heading' => ['heading' => []],
      'naturedex_page_bottom' => ['data' => ''],
    ];
    return array_map(static fn (array $variables) => ['variables' => $variables], $hooks);
  }

  /**
   * Adds the slug rules to every bundle that has a slug.
   */
  #[Hook('entity_bundle_field_info_alter')]
  public function bundleFieldInfoAlter(array &$fields, EntityTypeInterface $entityType, string $bundle): void {
    if (isset($fields['field_slug'])) {
      $fields['field_slug']->addConstraint('NaturedexSlug');
    }
  }

  /**
   * Keeps each node's address in step with its slug: /species/{slug},
   * /journal/{slug}, or /{slug} for pages.
   */
  #[Hook('node_presave')]
  public function nodePresave(NodeInterface $node): void {
    $prefix = self::PREFIXES[$node->bundle()] ?? NULL;
    $slug = $node->hasField('field_slug') ? $node->get('field_slug')->value : NULL;
    if ($prefix && $slug) {
      $node->get('path')->alias = $prefix . $slug;
    }
  }

  /**
   * Whoever may edit any node of a type may also read its unpublished ones,
   * so editors can review drafts. Core grants this only through node access
   * modules or content moderation.
   */
  #[Hook('node_access')]
  public function nodeAccess(NodeInterface $node, string $operation, AccountInterface $account): AccessResultInterface {
    if ($operation !== 'view' || $node->isPublished()) {
      return AccessResult::neutral();
    }
    return AccessResult::allowedIfHasPermission($account, 'edit any ' . $node->bundle() . ' content')->addCacheableDependency($node);
  }

  /**
   * Renders the full view of each Naturedex bundle from its normalized record.
   */
  #[Hook('node_view')]
  public function nodeView(array &$build, NodeInterface $node, EntityViewDisplayInterface $display, string $viewMode): void {
    if ($viewMode !== 'full') {
      return;
    }
    $editUrl = $node->access('update') ? $node->toUrl('edit-form')->toString() : NULL;
    $content = match ($node->bundle()) {
      'species' => [
        '#theme' => 'naturedex_species_page',
        '#species' => $this->records->speciesRecord($node),
        '#regions' => $this->records->regions(),
        '#edit_url' => $editUrl,
      ],
      'field_note' => [
        '#theme' => 'naturedex_article',
        '#note' => [
          'category' => (string) ($node->get('field_category')->entity?->label() ?? ''),
          'author' => (string) ($node->getOwner()?->getDisplayName() ?? ''),
          'created' => (int) $node->getCreatedTime(),
          'excerpt' => (string) $node->get('field_excerpt')->value,
          'published' => $node->isPublished(),
          'edit_url' => $editUrl,
        ],
        '#body' => $node->get('field_body')->view(['label' => 'hidden']),
        '#related' => $this->records->relatedSpecies($node),
        '#regions' => $this->records->regions(),
      ],
      'page' => [
        '#theme' => 'naturedex_page',
        '#body' => $node->get('field_body')->view(['label' => 'hidden']),
        '#deer' => $node->get('field_slug')->value === 'about' ? $this->records->findSpecies('white-tailed-deer') : NULL,
        '#edit_url' => $editUrl,
      ],
      default => NULL,
    };
    if ($content) {
      $build['naturedex'] = $content + ['#cache' => ['tags' => Records::CACHE_TAGS, 'contexts' => ['user.permissions']]];
    }
  }

  /**
   * The toolbar would sit over the fixed app shell; the admin theme keeps it.
   * Runs last, after the toolbar module has added it.
   */
  #[Hook('page_top', order: Order::Last)]
  public function pageTop(array &$pageTop): void {
    if ($this->isSiteTheme()) {
      unset($pageTop['toolbar']);
    }
  }

  /**
   * Compact species and region records for filtering, printed as inert JSON so
   * public pages stay identical for every visitor.
   */
  #[Hook('page_bottom')]
  public function pageBottom(array &$pageBottom): void {
    if (!$this->isSiteTheme()) {
      return;
    }
    $species = array_map(static fn (array $entry) => array_intersect_key($entry, array_flip(['id', 'dexNumber', 'name', 'scientificName', 'group', 'habitats', 'regionIds'])), $this->records->species());
    $pageBottom['naturedex'] = [
      '#theme' => 'naturedex_page_bottom',
      // Json::encode() escapes <, >, and &, so the data cannot end the element.
      '#data' => Markup::create(Json::encode(['species' => $species, 'regions' => $this->records->regions()])),
      '#cache' => ['tags' => Records::CACHE_TAGS],
    ];
  }

  #[Hook('page_attachments_alter')]
  public function pageAttachmentsAlter(array &$attachments): void {
    if (!$this->isSiteTheme()) {
      return;
    }
    $attachments['#attached']['html_head'] = array_values(array_filter(
      $attachments['#attached']['html_head'] ?? [],
      static fn (array $item) => ($item[1] ?? '') !== 'system_meta_generator',
    ));
  }

  #[Hook('preprocess_html')]
  public function preprocessHtml(array &$variables): void {
    if (!$this->isSiteTheme()) {
      return;
    }
    $variables['naturedex_title'] = $this->pageContext->documentTitle();
    $variables['naturedex_view'] = $this->pageContext->view();
    $node = $this->pageContext->node();
    $variables['naturedex_description'] = $node?->bundle() === 'field_note'
      ? (string) $node->get('field_excerpt')->value
      : 'A little curiosity. A whole wild world. Explore Virginia’s wildlife, keep a field collection, and read field notes in Naturedex.';
  }

  private function isSiteTheme(): bool {
    return $this->themeManager->getActiveTheme()->getName() === 'naturedex';
  }

}
