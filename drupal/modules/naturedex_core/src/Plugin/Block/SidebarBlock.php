<?php

declare(strict_types=1);

namespace Drupal\naturedex_core\Plugin\Block;

use Drupal\Core\Block\Attribute\Block;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Url;

#[Block(id: 'naturedex_sidebar', admin_label: new TranslatableMarkup('Naturedex sidebar'), category: new TranslatableMarkup('Naturedex'))]
final class SidebarBlock extends ShellBlockBase {

  private const ITEMS = [
    ['Field guide', 'naturedex.guide', 'book', ['guide', 'species']],
    ['Region map', 'naturedex.map', 'map', ['map']],
    ['Field journal', 'naturedex.journal', 'pen', ['journal', 'article']],
    ['Writing desk', 'naturedex.editor', 'leaf', ['editor', 'account']],
  ];

  public function build(): array {
    $view = $this->pageContext->view();
    $items = [];
    foreach (self::ITEMS as [$label, $route, $icon, $views]) {
      $items[] = [
        'label' => $label,
        'url' => $route === 'naturedex.guide' ? Url::fromRoute('<front>')->toString() : Url::fromRoute($route)->toString(),
        'icon' => $icon,
        'active' => in_array($view, $views, TRUE),
        'route' => $route,
      ];
    }
    return [
      '#theme' => 'naturedex_sidebar',
      '#items' => $items,
      '#total' => count($this->records->species()),
    ];
  }

  public function getCacheTags(): array {
    return array_merge(parent::getCacheTags(), ['node_list:species']);
  }

}
