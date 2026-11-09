<?php

declare(strict_types=1);

namespace Drupal\naturedex_core;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Extension\ModuleExtensionList;
use Drupal\Core\File\FileUrlGeneratorInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\Url;
use Drupal\node\NodeInterface;
use Drupal\taxonomy\TermInterface;

/**
 * Normalized records shared by the templates and the Writing desk API.
 *
 * Templates and JSON both read these arrays, never raw entities, so the two can
 * not describe the same animal differently. Every page that prints them adds
 * self::CACHE_TAGS, and Drupal clears those pages when any of these entities
 * is saved.
 */
final class Records {

  public const CACHE_TAGS = [
    'node_list:species',
    'node_list:field_note',
    'taxonomy_term_list:region',
    'taxonomy_term_list:animal_group',
    'taxonomy_term_list:journal_category',
  ];

  /** @var list<array<string, mixed>>|null */
  private ?array $species = NULL;

  /** @var list<array<string, mixed>>|null */
  private ?array $regions = NULL;

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly ModuleExtensionList $moduleList,
    private readonly FileUrlGeneratorInterface $fileUrlGenerator,
  ) {}

  /**
   * Published species in dex order.
   *
   * @return list<array<string, mixed>>
   */
  public function species(): array {
    if ($this->species === NULL) {
      $storage = $this->entityTypeManager->getStorage('node');
      $ids = $storage->getQuery()
        ->accessCheck(FALSE)
        ->condition('type', 'species')
        ->condition('status', 1)
        ->sort('field_dex_number')
        ->sort('nid')
        ->execute();
      $this->species = array_values(array_map($this->speciesRecord(...), $storage->loadMultiple($ids)));
    }
    return $this->species;
  }

  /**
   * @return array<string, mixed>|null
   */
  public function findSpecies(string $id): ?array {
    foreach ($this->species() as $species) {
      if ($species['id'] === $id) {
        return $species;
      }
    }
    return NULL;
  }

  /**
   * A species node by its ID, published or not.
   */
  public function speciesNode(string $id): ?NodeInterface {
    $nodes = $this->entityTypeManager->getStorage('node')->loadByProperties(['type' => 'species', 'field_slug' => $id]);
    return $nodes ? reset($nodes) : NULL;
  }

  /**
   * @return array<string, mixed>
   */
  public function speciesRecord(NodeInterface $node): array {
    $group = $node->get('field_animal_group')->entity;
    $regions = $node->get('field_regions')->referencedEntities();
    usort($regions, static fn (TermInterface $a, TermInterface $b) => [$a->getWeight(), $a->id()] <=> [$b->getWeight(), $b->id()]);
    $id = (string) $node->get('field_slug')->value;
    return [
      'id' => $id,
      'nid' => (int) $node->id(),
      'dexNumber' => (int) $node->get('field_dex_number')->value,
      'name' => (string) $node->label(),
      'scientificName' => (string) $node->get('field_scientific_name')->value,
      'group' => $group ? (string) $group->label() : '',
      'description' => (string) $node->get('field_description')->value,
      'habitats' => self::values($node, 'field_habitats'),
      'diet' => self::values($node, 'field_diet'),
      'activity' => (string) $node->get('field_activity')->value,
      'size' => [
        'lengthCm' => self::range($node, 'field_length_min', 'field_length_max'),
        'weightKg' => self::range($node, 'field_weight_min', 'field_weight_max'),
        'note' => (string) $node->get('field_size_note')->value,
      ],
      'regionIds' => array_map(static fn (TermInterface $term) => (string) $term->get('field_slug')->value, $regions),
      'regionNote' => (string) $node->get('field_region_note')->value,
      'sourceURLs' => array_map(static fn (array $item) => (string) $item['uri'], $node->get('field_sources')->getValue()),
      'url' => $node->toUrl()->toString(),
    ] + $this->spriteUrls((string) ($node->get('field_sprite')->value ?: $id));
  }

  /**
   * Regions from west to east.
   *
   * @return list<array<string, mixed>>
   */
  public function regions(): array {
    if ($this->regions === NULL) {
      $this->regions = array_map(static fn (TermInterface $term) => [
        'id' => (string) $term->get('field_slug')->value,
        'name' => (string) $term->label(),
        'shortName' => (string) $term->get('field_short_name')->value,
        'x' => (float) $term->get('field_map_x')->value,
        'y' => (float) $term->get('field_map_y')->value,
        'color' => (string) $term->get('field_color')->value,
        'description' => trim(strip_tags((string) $term->getDescription())),
      ], $this->terms('region'));
    }
    return $this->regions;
  }

  /**
   * @return list<string>
   */
  public function groups(): array {
    return array_map(static fn (TermInterface $term) => (string) $term->label(), $this->terms('animal_group'));
  }

  /**
   * Published field notes, newest first.
   *
   * @return list<\Drupal\node\NodeInterface>
   */
  public function recentNotes(int $limit): array {
    $storage = $this->entityTypeManager->getStorage('node');
    $ids = $storage->getQuery()
      ->accessCheck(TRUE)
      ->condition('type', 'field_note')
      ->condition('status', 1)
      ->sort('created', 'DESC')
      ->sort('nid', 'DESC')
      ->range(0, $limit)
      ->execute();
    return array_values($storage->loadMultiple($ids));
  }

  /**
   * What a journal card shows.
   *
   * @return array<string, mixed>
   */
  public function card(NodeInterface $note): array {
    $related = $this->relatedSpecies($note);
    return [
      'title' => (string) $note->label(),
      'url' => $note->toUrl()->toString(),
      'excerpt' => (string) $note->get('field_excerpt')->value,
      'category' => (string) ($note->get('field_category')->entity?->label() ?? 'Field notes'),
      // The first related animal, or else the first entry in the guide.
      'art' => $related[0] ?? $this->species()[0] ?? NULL,
    ];
  }

  /**
   * Published species linked to a note, as records. Links are entity
   * references, so renaming a species or changing its ID cannot break them.
   *
   * @return list<array<string, mixed>>
   */
  public function relatedSpecies(NodeInterface $note): array {
    $found = [];
    foreach ($note->get('field_related_species')->referencedEntities() as $species) {
      if ($species instanceof NodeInterface && $species->isPublished()) {
        $found[] = $this->speciesRecord($species);
      }
    }
    return $found;
  }

  /**
   * A field note as the Writing desk API returns it.
   *
   * @return array<string, mixed>
   */
  public function post(NodeInterface $note, AccountInterface $account): array {
    $published = $note->isPublished();
    $record = [
      'id' => (string) $note->id(),
      'slug' => (string) $note->get('field_slug')->value,
      'title' => (string) $note->label(),
      'excerpt' => (string) $note->get('field_excerpt')->value,
      'body' => (string) $note->get('field_body')->value,
      'status' => $published ? 'published' : 'draft',
      'category' => (string) ($note->get('field_category')->entity?->label() ?? ''),
      'relatedSpeciesIds' => array_values(array_map(
        static fn (NodeInterface $species) => (string) $species->get('field_slug')->value,
        array_filter($note->get('field_related_species')->referencedEntities(), static fn ($entity) => $entity instanceof NodeInterface),
      )),
      'author' => (string) ($note->getOwner()?->getDisplayName() ?? ''),
      'createdAt' => date('c', (int) $note->getCreatedTime()),
      'updatedAt' => date('c', (int) $note->getChangedTime()),
      'publishedAt' => $published ? date('c', (int) $note->getCreatedTime()) : NULL,
      'url' => $note->toUrl()->toString(),
    ];
    if ($note->access('update', $account)) {
      $record['editUrl'] = $note->toUrl('edit-form')->toString();
    }
    return $record;
  }

  /**
   * The Virginia outline as an SVG path, projected here so the map needs no
   * extra request and draws without JavaScript.
   */
  public function mapOutline(): string {
    $fallback = 'M38,324 L95,278 L150,278 L198,227 L242,230 L292,164 L338,178 L366,119 L409,133 L426,88 L466,111 L476,158 L506,165 L509,203 L549,219 L568,259 L598,278 L593,321 L38,324Z';
    $file = $this->moduleList->getPath('naturedex_core') . '/assets/map/virginia.geojson';
    $data = is_file($file) ? json_decode((string) file_get_contents($file), TRUE) : NULL;
    $geometry = $data['geometry'] ?? $data['features'][0]['geometry'] ?? NULL;
    if (!$geometry) {
      return $fallback;
    }
    $polygons = $geometry['type'] === 'MultiPolygon' ? $geometry['coordinates'] : [$geometry['coordinates']];
    $rings = [];
    foreach ($polygons as $polygon) {
      foreach ($polygon as $ring) {
        $points = [];
        foreach ($ring as $index => $point) {
          $x = (($point[0] + 83.8) / 8.7) * 620 + 30;
          $y = ((39.6 - $point[1]) / 3.2) * 300 + 40;
          $points[] = sprintf('%s%.1f,%.1f', $index ? 'L' : 'M', $x, $y);
        }
        $rings[] = implode(' ', $points) . 'Z';
      }
    }
    return implode(' ', $rings);
  }

  /**
   * Bundled art for a sprite name, with a placeholder for species added in
   * Drupal without art.
   *
   * @return array{sprite: string, animatedSprite: ?string}
   */
  private function spriteUrls(string $name): array {
    $base = $this->moduleList->getPath('naturedex_core') . '/assets';
    $name = preg_replace('/[^a-z0-9-]/', '', strtolower($name));
    if ($name === '' || !is_file("$base/sprites/$name.svg")) {
      return ['sprite' => $this->fileUrlGenerator->generateString("$base/placeholder-sprite.svg"), 'animatedSprite' => NULL];
    }
    return [
      'sprite' => $this->fileUrlGenerator->generateString("$base/sprites/$name.svg"),
      'animatedSprite' => is_file("$base/sprites/animated/$name.svg") ? $this->fileUrlGenerator->generateString("$base/sprites/animated/$name.svg") : NULL,
    ];
  }

  /**
   * @return list<\Drupal\taxonomy\TermInterface>
   */
  private function terms(string $vocabulary): array {
    $storage = $this->entityTypeManager->getStorage('taxonomy_term');
    $ids = $storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('vid', $vocabulary)
      ->condition('status', 1)
      ->sort('weight')
      ->sort('tid')
      ->execute();
    return array_values($storage->loadMultiple($ids));
  }

  /**
   * @return list<string>
   */
  private static function values(NodeInterface $node, string $field): array {
    return array_values(array_map(static fn (array $item) => (string) $item['value'], $node->get($field)->getValue()));
  }

  /**
   * @return array{0: float, 1: float}|null
   */
  private static function range(NodeInterface $node, string $min, string $max): ?array {
    $low = $node->get($min)->value;
    $high = $node->get($max)->value;
    return is_numeric($low) && is_numeric($high) ? [(float) $low, (float) $high] : NULL;
  }

}
