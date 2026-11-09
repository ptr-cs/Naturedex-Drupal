<?php

declare(strict_types=1);

namespace Drupal\naturedex_core\Plugin\Block;

use Drupal\Core\Block\BlockBase;
use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
use Drupal\naturedex_core\PageContext;
use Drupal\naturedex_core\Records;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Shared wiring for the blocks that make up the app shell. Each varies by
 * route, and the node a route shows adds its own cache tag.
 */
abstract class ShellBlockBase extends BlockBase implements ContainerFactoryPluginInterface {

  final public function __construct(
    array $configuration,
    $plugin_id,
    $plugin_definition,
    protected readonly PageContext $pageContext,
    protected readonly Records $records,
  ) {
    parent::__construct($configuration, $plugin_id, $plugin_definition);
  }

  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    return new static($configuration, $plugin_id, $plugin_definition, $container->get(PageContext::class), $container->get(Records::class));
  }

  public function getCacheContexts(): array {
    return array_merge(parent::getCacheContexts(), ['route', 'url.path']);
  }

  public function getCacheTags(): array {
    $node = $this->pageContext->node();
    return array_merge(parent::getCacheTags(), $node ? $node->getCacheTags() : []);
  }

}
