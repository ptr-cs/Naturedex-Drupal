<?php

declare(strict_types=1);

namespace Drupal\naturedex_core\Plugin\Block;

use Drupal\Core\Block\Attribute\Block;
use Drupal\Core\StringTranslation\TranslatableMarkup;

#[Block(id: 'naturedex_topbar', admin_label: new TranslatableMarkup('Naturedex top bar'), category: new TranslatableMarkup('Naturedex'))]
final class TopbarBlock extends ShellBlockBase {

  public function build(): array {
    return ['#theme' => 'naturedex_topbar', '#crumb' => $this->pageContext->heading()['crumb']];
  }

}
