<?php

declare(strict_types=1);

namespace Drupal\naturedex_core;

use Drupal\Component\Utility\Html;

/**
 * The field note body format: paragraphs separated by blank lines, and "## "
 * section headings.
 *
 * Bodies are stored as this plain text and rendered by the "Field note text"
 * filter, so Drupal's node form and the Writing desk edit exactly the same
 * value. Any HTML in the text is escaped and shown, never executed.
 * frontend/lib/domain.ts parseBody() mirrors parse() for the desk preview.
 */
final class FieldNoteFormat {

  /**
   * @return list<array{type: 'heading'|'paragraph', text: string}>
   */
  public static function parse(string $text): array {
    $text = trim(str_replace(["\r\n", "\r"], "\n", $text));
    if ($text === '') {
      return [];
    }
    $blocks = [];
    foreach (preg_split('/\n\s*\n/', $text) as $part) {
      $part = trim($part);
      if ($part === '') {
        continue;
      }
      if (preg_match('/^#{1,2} +(.+)$/s', $part, $match)) {
        $blocks[] = ['type' => 'heading', 'text' => trim(preg_replace('/\s*\n\s*/', ' ', $match[1]))];
      }
      else {
        $blocks[] = ['type' => 'paragraph', 'text' => $part];
      }
    }
    return $blocks;
  }

  public static function toHtml(string $text): string {
    $html = [];
    foreach (self::parse($text) as $block) {
      $tag = $block['type'] === 'heading' ? 'h2' : 'p';
      $html[] = "<$tag>" . Html::escape($block['text']) . "</$tag>";
    }
    return implode("\n", $html);
  }

}
