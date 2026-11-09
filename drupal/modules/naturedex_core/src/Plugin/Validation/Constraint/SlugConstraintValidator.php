<?php

declare(strict_types=1);

namespace Drupal\naturedex_core\Plugin\Validation\Constraint;

use Drupal\Core\DependencyInjection\ContainerInjectionInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Field\FieldItemListInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\ConstraintValidator;

final class SlugConstraintValidator extends ConstraintValidator implements ContainerInjectionInterface {

  /** Top-level addresses a page may not take. */
  private const RESERVED = ['admin', 'api', 'core', 'editor', 'guide', 'journal', 'map', 'modules', 'naturedex', 'node', 'session', 'sites', 'species', 'taxonomy', 'themes', 'user'];

  public function __construct(private readonly EntityTypeManagerInterface $entityTypeManager) {}

  public static function create(ContainerInterface $container): self {
    return new self($container->get('entity_type.manager'));
  }

  public function validate(mixed $items, Constraint $constraint): void {
    assert($items instanceof FieldItemListInterface && $constraint instanceof SlugConstraint);
    $slug = $items->value;
    if ($slug === NULL || $slug === '') {
      return;
    }
    if (!preg_match('/^[a-z0-9]+(?:-[a-z0-9]+)*$/D', $slug)) {
      $this->context->addViolation($constraint->format, ['%example' => 'woodland-walk']);
      return;
    }
    $entity = $items->getEntity();
    if ($entity->bundle() === 'page' && in_array($slug, self::RESERVED, TRUE)) {
      $this->context->addViolation($constraint->reserved);
      return;
    }
    $type = $entity->getEntityType();
    $query = $this->entityTypeManager->getStorage($type->id())->getQuery()
      ->accessCheck(FALSE)
      ->condition($type->getKey('bundle'), $entity->bundle())
      ->condition($items->getName(), $slug)
      ->range(0, 1);
    if (!$entity->isNew()) {
      $query->condition($type->getKey('id'), $entity->id(), '<>');
    }
    if ($query->execute()) {
      $this->context->addViolation($constraint->taken);
    }
  }

}
