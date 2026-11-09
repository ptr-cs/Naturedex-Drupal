<?php

declare(strict_types=1);

namespace Drupal\naturedex_core;

use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\node\NodeInterface;
use Symfony\Component\HttpFoundation\RequestStack;

/**
 * Maps the current route to one of the site's named views and its heading.
 *
 * Error pages are subrequests, so "the address the visitor asked for" comes
 * from the main request.
 */
final class PageContext {

  private const JOURNAL = [
    'crumb' => 'FIELD JOURNAL',
    'eyebrow' => 'STORIES FROM THE OUTSIDE',
    'title' => 'Notes from the field.',
    'description' => 'Small observations. Good questions. Stories worth stepping outside for.',
    'stamp' => 'pen',
  ];

  private const HEADINGS = [
    'guide' => [
      'crumb' => 'FIELD GUIDE',
      'eyebrow' => 'VIRGINIA, ONE DISCOVERY AT A TIME',
      'title' => 'Meet your wild neighbors.',
      'description' => 'From the Blue Ridge to the bay. Get to know the wildlife just beyond your doorstep.',
      'stamp' => 'globe',
    ],
    'map' => [
      'crumb' => 'REGION MAP',
      'eyebrow' => 'FOLLOW YOUR CURIOSITY',
      'title' => 'Adventure has a map.',
      'description' => 'From mountain trails to tidal shores. Pick a region and see who lives there.',
      'stamp' => 'globe',
    ],
    'editor' => [
      'crumb' => 'WRITING DESK',
      'eyebrow' => 'A PLACE FOR YOUR OBSERVATIONS',
      'title' => 'Your writing desk.',
      'description' => 'Turn an observation into a story. Save a draft, then publish when you’re ready.',
      'stamp' => '',
    ],
    'about' => [
      'crumb' => 'ABOUT',
      'eyebrow' => 'A FIELD GUIDE, WITH A LITTLE NOSTALGIA',
      'title' => 'Made for the curious.',
      'description' => 'An original, pocket-sized guide to the animals that make Virginia home.',
      'stamp' => 'globe',
    ],
    'account' => [
      'crumb' => 'WRITING DESK',
      'eyebrow' => 'FOR EDITORS AND CONTRIBUTORS',
      'title' => 'Sign in to write.',
      'description' => 'Field notes are written by people with a Naturedex account.',
      'stamp' => '',
    ],
    'not_found' => [
      'crumb' => 'FIELD GUIDE',
      'eyebrow' => 'OFF THE MAP',
      'title' => 'Lost in the tall grass.',
      'description' => 'That page isn’t in this field guide.',
      'stamp' => '',
    ],
    'access_denied' => [
      'crumb' => 'FIELD GUIDE',
      'eyebrow' => 'OFF THE TRAIL',
      'title' => 'This path is closed.',
      'description' => 'Your account can’t open that page.',
      'stamp' => '',
    ],
  ];

  private const LABELS = [
    'guide' => 'Virginia field guide',
    'map' => 'Region map',
    'journal' => 'Field journal',
    'editor' => 'Writing desk',
    'about' => 'About',
    'account' => 'Sign in',
    'not_found' => 'Not found',
    'access_denied' => 'Access denied',
  ];

  public function __construct(
    private readonly RouteMatchInterface $routeMatch,
    private readonly RequestStack $requestStack,
  ) {}

  /**
   * guide, map, journal, article, species, editor, about, page, account,
   * not_found, or access_denied.
   */
  public function view(): string {
    $route = (string) $this->routeMatch->getRouteName();
    $node = $this->node();
    return match (TRUE) {
      $route === 'naturedex.guide' => 'guide',
      $route === 'naturedex.map' => 'map',
      $route === 'naturedex.journal' => 'journal',
      $route === 'naturedex.editor' => 'editor',
      $route === 'naturedex.not_found', $route === 'system.404' => 'not_found',
      $route === 'naturedex.access_denied', $route === 'system.403' => 'access_denied',
      str_starts_with($route, 'user.') => 'account',
      $node?->bundle() === 'field_note' => 'article',
      $node?->bundle() === 'species' => 'species',
      $node?->bundle() === 'page' => $node->get('field_slug')->value === 'about' ? 'about' : 'page',
      default => 'page',
    };
  }

  /**
   * @return array{crumb: string, eyebrow: string, title: string, description: string, stamp: string}
   */
  public function heading(): array {
    $view = $this->view();
    $title = (string) ($this->node()?->label() ?? '');
    if ($this->isJournalAddress() && in_array($view, ['not_found', 'access_denied'], TRUE)) {
      return self::JOURNAL;
    }
    return match ($view) {
      'journal' => self::JOURNAL,
      'article' => ['title' => $title, 'stamp' => ''] + self::JOURNAL,
      'species' => ['crumb' => 'FIELD GUIDE', 'eyebrow' => 'A FIELD GUIDE ENTRY', 'title' => $title, 'description' => '', 'stamp' => ''],
      'page' => ['crumb' => 'FIELD GUIDE', 'eyebrow' => 'NATUREDEX', 'title' => $title, 'description' => '', 'stamp' => ''],
      default => self::HEADINGS[$view],
    };
  }

  /**
   * The browser tab title.
   */
  public function documentTitle(): string {
    $view = $this->view();
    $name = self::LABELS[$view] ?? (string) ($this->node()?->label() ?? '');
    return $name === '' ? 'Naturedex' : "$name · Naturedex";
  }

  /**
   * Whether the visitor asked for an address under /journal/.
   */
  public function isJournalAddress(): bool {
    return str_starts_with((string) $this->requestStack->getMainRequest()?->getPathInfo(), '/journal/');
  }

  /**
   * Whether the visitor asked for the Writing desk itself.
   */
  public function isEditorAddress(): bool {
    return $this->requestStack->getMainRequest()?->getPathInfo() === '/editor';
  }

  public function node(): ?NodeInterface {
    $node = $this->routeMatch->getParameter('node');
    return $node instanceof NodeInterface ? $node : NULL;
  }

}
