<?php

declare(strict_types=1);

namespace Drupal\naturedex_core\Plugin\Validation\Constraint;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Validation\Attribute\Constraint;
use Symfony\Component\Validator\Constraint as SymfonyConstraint;

/**
 * A slug must be lowercase words joined by hyphens and unique in its bundle.
 *
 * Drupal's UniqueField constraint compares across every bundle; a species and a
 * field note may share a slug because their addresses differ.
 */
#[Constraint(
  id: 'NaturedexSlug',
  label: new TranslatableMarkup('Naturedex slug', [], ['context' => 'Validation']),
)]
final class SlugConstraint extends SymfonyConstraint {

  public string $format = 'Use lowercase letters, numbers, and single hyphens, such as %example.';

  public string $taken = 'That slug is already in use.';

  public string $reserved = 'That address is used by the site itself. Choose another.';

}
