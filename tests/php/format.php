<?php

/**
 * @file
 * Prints FieldNoteFormat::parse() for each JSON-encoded body read from STDIN.
 * Used by tests/unit/format.test.ts to compare PHP and TypeScript.
 */

declare(strict_types=1);

require getcwd() . '/autoload.php';
require dirname(__DIR__, 2) . '/drupal/modules/naturedex_core/src/FieldNoteFormat.php';

use Drupal\naturedex_core\FieldNoteFormat;

$bodies = json_decode(stream_get_contents(STDIN), TRUE);
echo json_encode(array_map(static fn (string $body) => [
  'blocks' => FieldNoteFormat::parse($body),
  'html' => FieldNoteFormat::toHtml($body),
], $bodies));
