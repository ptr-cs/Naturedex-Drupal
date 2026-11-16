<?php

declare(strict_types=1);

namespace Drupal\naturedex_core;

use Drupal\Core\Config\ConfigFactoryInterface;
use Drupal\Core\Config\FileStorage;
use Drupal\Core\Config\ImmutableConfig;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\State\StateInterface;
use Drupal\node\NodeInterface;
use Drupal\user\Entity\Role;

/**
 * Site-wide wording, and the upgrade that makes it and page headings editable.
 *
 * Site copy (the sidebar tagline, the footer line, and the default search
 * description) is the naturedex_core.site_copy configuration, edited at
 * /admin/config/content/naturedex-copy. Each page's eyebrow, heading, and
 * introduction are fields on the page.
 */
final class SiteCopy {

  public const CONFIG = 'naturedex_core.site_copy';

  public const PERMISSION = 'edit naturedex site copy';

  /** The copy a new site starts with, and what shows if a value is missing. */
  public const DEFAULTS = [
    'tagline' => "A little curiosity.\nA whole wild world.",
    'footer_motto' => 'Take only memories. Leave only footprints.',
    'meta_description' => 'A little curiosity. A whole wild world. Explore Virginia’s wildlife, keep a field collection, and read field notes in Naturedex.',
  ];

  /** The page fields this adds, as their config/install names. */
  private const PAGE_FIELDS = ['field_eyebrow', 'field_heading', 'field_intro'];

  private const STATE_KEY = 'naturedex_core.copy_version';

  private const VERSION = 1;

  public function __construct(
    private readonly ConfigFactoryInterface $configFactory,
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly StateInterface $state,
  ) {}

  /**
   * The configuration, for its values and its cache tag.
   */
  public function config(): ImmutableConfig {
    return $this->configFactory->get(self::CONFIG);
  }

  public function get(string $key): string {
    $value = trim((string) $this->config()->get($key));
    return $value !== '' ? $value : self::DEFAULTS[$key];
  }

  /**
   * A page's eyebrow, heading (its title when blank), and introduction.
   *
   * @return array{eyebrow: string, title: string, description: string}
   */
  public static function pageHeading(NodeInterface $node): array {
    $field = static fn (string $name) => $node->hasField($name) ? trim((string) $node->get($name)->value) : '';
    return [
      'eyebrow' => $field('field_eyebrow') ?: 'NATUREDEX',
      'title' => $field('field_heading') ?: (string) $node->label(),
      'description' => $field('field_intro'),
    ];
  }

  /**
   * Brings a site installed before editable copy up to date. Safe to run on
   * every release: it only adds what is missing and never changes an edit.
   *
   * There is no Drush in the image to run update hooks, so the setup and
   * rebuild tasks call this instead.
   */
  public function upgrade(): void {
    $config = $this->configFactory->getEditable(self::CONFIG);
    if ($config->isNew()) {
      $config->setData(['langcode' => 'en'] + self::DEFAULTS)->save();
    }
    elseif ($config->get('langcode') === NULL) {
      // Translatable values need a language for the settings form to save.
      $config->set('langcode', 'en')->save();
    }
    if ((int) $this->state->get(self::STATE_KEY, 0) >= self::VERSION) {
      return;
    }

    $install = new FileStorage(dirname(__DIR__) . '/config/install');
    foreach (['field_storage_config' => 'field.storage.node.', 'field_config' => 'field.field.node.page.'] as $type => $prefix) {
      $storage = $this->entityTypeManager->getStorage($type);
      foreach (self::PAGE_FIELDS as $name) {
        $record = $install->read($prefix . $name);
        if ($record && !$storage->load($record['id'])) {
          $storage->createFromStorageRecord($record)->save();
        }
      }
    }

    $display = $this->entityTypeManager->getStorage('entity_form_display')->load('node.page.default');
    $wanted = $install->read('core.entity_form_display.node.page.default');
    if ($display && $wanted) {
      foreach ($wanted['content'] as $name => $component) {
        $display->setComponent($name, $component);
      }
      $display->save();
    }

    Role::load('editor')?->grantPermission(self::PERMISSION)->save();

    // The About page shows the heading it showed before these fields existed.
    $nodes = $this->entityTypeManager->getStorage('node')->loadByProperties(['type' => 'page', 'field_slug' => 'about']);
    $about = reset($nodes);
    if ($about instanceof NodeInterface) {
      $changed = FALSE;
      foreach (Seeder::ABOUT_HEADING as $name => $value) {
        if ($about->hasField($name) && $about->get($name)->isEmpty()) {
          $about->set($name, $value);
          $changed = TRUE;
        }
      }
      if ($changed) {
        $about->setNewRevision();
        $about->setRevisionLogMessage('Moved the page heading into editable fields.');
        $about->save();
      }
    }

    $this->state->set(self::STATE_KEY, self::VERSION);
  }

}
