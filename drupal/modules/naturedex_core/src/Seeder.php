<?php

declare(strict_types=1);

namespace Drupal\naturedex_core;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\State\StateInterface;
use Drupal\node\NodeInterface;

/**
 * Imports the shared Naturedex seed data into Drupal.
 *
 * Seeds are only ever added. An existing record is never overwritten, and a
 * seed that was imported once and later deleted is not brought back, so the
 * database stays the source of truth after the first run.
 */
final class Seeder {

  private const STATE_KEY = 'naturedex_core.seeded';

  /** @var array<string, true> */
  private array $seeded = [];

  /** @var array<string, int> */
  private array $counts = [];

  /** The account that owns seeded content. */
  private int $author = 1;

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly StateInterface $state,
  ) {}

  /**
   * @return array<string, int> How many records of each kind were created.
   */
  public function seed(string $dataDir): array {
    $this->seeded = array_fill_keys($this->state->get(self::STATE_KEY, []), TRUE);
    $this->counts = ['regions' => 0, 'groups' => 0, 'species' => 0, 'field notes' => 0, 'pages' => 0];
    $species = self::json("$dataDir/species.json");
    $this->author = $this->author();

    foreach (self::json("$dataDir/regions.json") as $weight => $region) {
      $this->term('region', $region['name'], $weight, [
        'field_slug' => $region['id'],
        'field_short_name' => $region['shortName'],
        'field_map_x' => $region['x'],
        'field_map_y' => $region['y'],
        'field_color' => $region['color'],
        'description' => ['value' => $region['description'], 'format' => 'plain_text'],
      ], 'regions', $region['id']);
    }
    foreach (array_values(array_unique(array_column($species, 'group'))) as $weight => $group) {
      $this->term('animal_group', $group, $weight, [], 'groups', $group);
    }
    foreach ($species as $entry) {
      $this->species($entry);
    }
    foreach (self::json("$dataDir/posts.json") as $post) {
      $this->note($post);
    }
    $about = "$dataDir/about.txt";
    if (is_file($about)) {
      $this->create('page', 'about', 'pages', [
        'title' => 'About Naturedex',
        'field_slug' => 'about',
        'field_body' => ['value' => trim((string) file_get_contents($about)), 'format' => 'field_note_text'],
        'status' => 1,
      ]);
    }
    $this->state->set(self::STATE_KEY, array_keys($this->seeded));
    return $this->counts;
  }

  /**
   * @param array<string, mixed> $entry
   */
  private function species(array $entry): void {
    $this->create('species', $entry['id'], 'species', [
      'title' => $entry['name'],
      'field_slug' => $entry['id'],
      'field_dex_number' => $entry['dexNumber'],
      'field_scientific_name' => $entry['scientificName'],
      'field_animal_group' => $this->findTerm('animal_group', 'name', $entry['group']),
      'field_description' => $entry['description'],
      'field_habitats' => $entry['habitats'],
      'field_diet' => $entry['diet'],
      'field_activity' => $entry['activity'],
      'field_length_min' => $entry['size']['lengthCm'][0] ?? NULL,
      'field_length_max' => $entry['size']['lengthCm'][1] ?? NULL,
      'field_weight_min' => $entry['size']['weightKg'][0] ?? NULL,
      'field_weight_max' => $entry['size']['weightKg'][1] ?? NULL,
      'field_size_note' => $entry['size']['note'] ?? '',
      'field_regions' => array_filter(array_map(fn ($id) => $this->findTerm('region', 'field_slug', $id), $entry['regionIds'])),
      'field_region_note' => $entry['regionNote'] ?? '',
      'field_sources' => array_map(static fn ($uri) => ['uri' => $uri], $entry['sourceURLs']),
      'field_sprite' => $entry['sprite'] ?? $entry['id'],
      'status' => 1,
    ]);
  }

  /**
   * @param array<string, mixed> $post
   */
  private function note(array $post): void {
    $category = $post['category'] ?? 'Field notes';
    $created = strtotime($post['publishedAt'] ?? '') ?: time();
    $related = [];
    foreach ($post['relatedSpeciesIds'] ?? [] as $id) {
      $nodes = $this->entityTypeManager->getStorage('node')->loadByProperties(['type' => 'species', 'field_slug' => $id]);
      if ($nodes) {
        $related[] = reset($nodes)->id();
      }
    }
    $this->create('field_note', $post['slug'], 'field notes', [
      'title' => $post['title'],
      'field_slug' => $post['slug'],
      'field_excerpt' => $post['excerpt'] ?? '',
      'field_body' => ['value' => $post['body'], 'format' => 'field_note_text'],
      'field_category' => $this->findTerm('journal_category', 'name', $category)
        ?? $this->term('journal_category', $category, 0, [], NULL, NULL),
      'field_related_species' => $related,
      'status' => ($post['status'] ?? 'published') === 'published' ? 1 : 0,
      'created' => $created,
      'changed' => $created,
    ]);
  }

  /**
   * @param array<string, mixed> $values
   */
  private function create(string $bundle, string $slug, string $kind, array $values): void {
    $key = "node:$bundle:$slug";
    $storage = $this->entityTypeManager->getStorage('node');
    if (isset($this->seeded[$key]) || $storage->loadByProperties(['type' => $bundle, 'field_slug' => $slug])) {
      $this->seeded[$key] = TRUE;
      return;
    }
    $node = $storage->create(['type' => $bundle, 'uid' => $this->author] + $values);
    assert($node instanceof NodeInterface);
    $node->setRevisionLogMessage('Imported from Naturedex seed data.');
    $node->save();
    $this->seeded[$key] = TRUE;
    $this->counts[$kind]++;
  }

  /**
   * Seeded notes are bylined to a blocked account that cannot sign in, so the
   * public journal never shows the administrator's username.
   */
  private function author(): int {
    $storage = $this->entityTypeManager->getStorage('user');
    $existing = $storage->loadByProperties(['name' => 'Naturedex field team']);
    if ($existing) {
      return (int) reset($existing)->id();
    }
    $account = $storage->create(['name' => 'Naturedex field team', 'status' => 0]);
    $account->save();
    return (int) $account->id();
  }

  /**
   * @param array<string, mixed> $values
   */
  private function term(string $vocabulary, string $name, int $weight, array $values, ?string $kind, ?string $key): ?int {
    $stateKey = $key === NULL ? NULL : "term:$vocabulary:$key";
    $lookup = isset($values['field_slug']) ? ['field_slug', $values['field_slug']] : ['name', $name];
    $existing = $this->findTerm($vocabulary, ...$lookup);
    if ($existing || ($stateKey && isset($this->seeded[$stateKey]))) {
      if ($stateKey) {
        $this->seeded[$stateKey] = TRUE;
      }
      return $existing;
    }
    $term = $this->entityTypeManager->getStorage('taxonomy_term')->create(['vid' => $vocabulary, 'name' => $name, 'weight' => $weight] + $values);
    $term->save();
    if ($stateKey) {
      $this->seeded[$stateKey] = TRUE;
    }
    if ($kind) {
      $this->counts[$kind]++;
    }
    return (int) $term->id();
  }

  private function findTerm(string $vocabulary, string $field, string $value): ?int {
    $terms = $this->entityTypeManager->getStorage('taxonomy_term')->loadByProperties(['vid' => $vocabulary, $field => $value]);
    return $terms ? (int) reset($terms)->id() : NULL;
  }

  /**
   * @return list<array<string, mixed>>
   */
  private static function json(string $file): array {
    $data = json_decode((string) file_get_contents($file), TRUE, 64, JSON_THROW_ON_ERROR);
    return array_values($data['posts'] ?? $data);
  }

}
