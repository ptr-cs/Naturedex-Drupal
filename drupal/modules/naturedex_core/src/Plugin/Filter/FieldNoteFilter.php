<?php

declare(strict_types=1);

namespace Drupal\naturedex_core\Plugin\Filter;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\filter\Attribute\Filter;
use Drupal\filter\FilterProcessResult;
use Drupal\filter\Plugin\FilterBase;
use Drupal\filter\Plugin\FilterInterface;
use Drupal\naturedex_core\FieldNoteFormat;

/**
 * Renders field note text: paragraphs and "## " headings, with HTML escaped.
 */
#[Filter(
  id: 'naturedex_field_note',
  title: new TranslatableMarkup('Naturedex field note text'),
  description: new TranslatableMarkup('Blank lines separate paragraphs and "## " starts a heading. HTML is shown as text.'),
  type: FilterInterface::TYPE_MARKUP_LANGUAGE,
)]
final class FieldNoteFilter extends FilterBase {

  public function process($text, $langcode): FilterProcessResult {
    return new FilterProcessResult(FieldNoteFormat::toHtml((string) $text));
  }

  public function tips($long = FALSE): string {
    return (string) $this->t('Separate paragraphs with a blank line. Start a line with ## for a section heading. HTML is shown as text, not run.');
  }

}
