<?php

declare(strict_types=1);

namespace Drupal\naturedex_core\Plugin\Block;

use Drupal\Core\Block\Attribute\Block;
use Drupal\Core\StringTranslation\TranslatableMarkup;

#[Block(id: 'naturedex_heading', admin_label: new TranslatableMarkup('Naturedex page heading'), category: new TranslatableMarkup('Naturedex'))]
final class HeadingBlock extends ShellBlockBase {

  public function build(): array {
    return ['#theme' => 'naturedex_heading', '#heading' => $this->pageContext->heading()];
  }

}
