<?php

declare(strict_types=1);

namespace Drupal\naturedex_core\Controller;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\Controller\ControllerBase;
use Drupal\naturedex_core\Records;
use Drupal\node\NodeInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * The Writing desk API under /api/naturedex.
 *
 * Keeps the first Naturedex's normalized contract (/posts and /posts/{id}
 * with draft, publish, and validation behavior). Who may do what comes from
 * Drupal: sessions, roles, node access, and the core "administer node
 * published status" permission. Writes also pass Drupal's CSRF header check,
 * declared on the routes.
 */
final class PostsApiController extends ControllerBase {

  private const MAX_REQUEST_BYTES = 120000;

  private const MAX_LENGTHS = [
    'title' => 160,
    'slug' => 180,
    'excerpt' => 500,
    'body' => 50000,
    'category' => 80,
  ];

  private const REQUIRED = ['title', 'slug', 'excerpt', 'body', 'category'];

  /** API field names for the entity fields they map to. */
  private const FIELDS = [
    'title' => 'title',
    'field_slug' => 'slug',
    'field_excerpt' => 'excerpt',
    'field_body' => 'body',
    'field_category' => 'category',
    'field_related_species' => 'relatedSpeciesIds',
    'status' => 'status',
  ];

  public function __construct(
    private readonly Records $records,
    private readonly TimeInterface $time,
  ) {}

  public function listPosts(Request $request): JsonResponse {
    $drafts = $request->query->get('includeDrafts') === '1';
    if ($drafts && ($denied = $this->deskDenied())) {
      return $denied;
    }
    $page = max(0, (int) $request->query->get('page', 0));
    // Access is checked per note below, where hook_node_access applies.
    $query = $this->storage()->getQuery()
      ->accessCheck(FALSE)
      ->condition('type', 'field_note')
      ->sort('created', 'DESC')
      ->sort('nid', 'DESC')
      ->range($page * 100, 100);
    if (!$drafts) {
      $query->condition('status', 1);
    }
    elseif (!$this->currentUser()->hasPermission('edit any field_note content')) {
      // Contributors work on their own notes only.
      $query->condition('uid', $this->currentUser()->id());
    }
    $notes = array_filter($this->storage()->loadMultiple($query->execute()), static fn (NodeInterface $note) => $note->access('view'));
    return $this->json(array_values(array_map(fn (NodeInterface $note) => $this->records->post($note, $this->currentUser()), $notes)));
  }

  public function getPost(string $id): JsonResponse {
    $note = $this->find($id);
    return $note && $note->access('view') ? $this->json($this->records->post($note, $this->currentUser())) : $this->error('Post not found.', 404);
  }

  public function createPost(Request $request): JsonResponse {
    if (($denied = $this->deskDenied()) || ($denied = $this->crossOrigin($request))) {
      return $denied;
    }
    if (!$this->entityTypeManager()->getAccessControlHandler('node')->createAccess('field_note')) {
      return $this->error('Your account is not allowed to do that.', 403);
    }
    $data = $this->payload($request);
    if ($data instanceof JsonResponse) {
      return $data;
    }
    $note = $this->storage()->create(['type' => 'field_note', 'uid' => $this->currentUser()->id(), 'status' => 0]);
    assert($note instanceof NodeInterface);
    return $this->save($note, $data, 201);
  }

  public function updatePost(Request $request, string $id): JsonResponse {
    if (($denied = $this->deskDenied()) || ($denied = $this->crossOrigin($request))) {
      return $denied;
    }
    $note = $this->find($id);
    if (!$note) {
      return $this->error('Post not found.', 404);
    }
    if (!$note->access('update')) {
      return $this->error('Your account is not allowed to do that.', 403);
    }
    $data = $this->payload($request);
    return $data instanceof JsonResponse ? $data : $this->save($note, $data, 200);
  }

  /**
   * Deletes a field note. Drupal core has no trash, so this is permanent; the
   * Writing desk asks for confirmation first.
   */
  public function deletePost(Request $request, string $id): Response {
    if (($denied = $this->deskDenied()) || ($denied = $this->crossOrigin($request))) {
      return $denied;
    }
    $note = $this->find($id);
    if (!$note) {
      return $this->error('Post not found.', 404);
    }
    if (!$note->access('delete')) {
      return $this->error('Your account is not allowed to do that.', 403);
    }
    $note->delete();
    return new Response('', 204, ['Cache-Control' => 'no-store']);
  }

  public function species(): JsonResponse {
    return $this->json($this->records->species());
  }

  public function regions(): JsonResponse {
    return $this->json($this->records->regions());
  }

  /**
   * Validates and saves. Each problem is reported at once, in one message.
   *
   * @param array<string, mixed> $data
   */
  private function save(NodeInterface $note, array $data, int $status): JsonResponse {
    $errors = [];
    foreach (self::MAX_LENGTHS as $key => $max) {
      if (array_key_exists($key, $data) && (!is_string($data[$key]) || mb_strlen($data[$key]) > $max)) {
        $errors[] = "$key must be text with at most $max characters.";
      }
    }
    foreach (self::REQUIRED as $key) {
      $value = $data[$key] ?? NULL;
      if (($note->isNew() && $value === NULL) || (is_string($value) && trim($value) === '')) {
        $errors[] = "$key is required.";
      }
    }
    if (array_key_exists('status', $data) && !in_array($data['status'], ['draft', 'published'], TRUE)) {
      $errors[] = 'Choose draft or published status.';
    }
    $related = array_key_exists('relatedSpeciesIds', $data) ? $this->speciesIds($data['relatedSpeciesIds']) : [];
    if ($related === NULL) {
      $errors[] = 'Related species must be a list of known species IDs.';
    }
    if ($errors) {
      return $this->error(implode(' ', array_unique($errors)), 422);
    }

    $publish = ($data['status'] ?? NULL) === 'published';
    $statusChanges = array_key_exists('status', $data) && $publish !== $note->isPublished();
    if ($statusChanges && !$this->currentUser()->hasPermission('administer node published status')) {
      return $this->error($publish ? 'Your account can save drafts but cannot publish.' : 'Your account cannot unpublish field notes.', 403);
    }

    foreach (['title' => 'title', 'slug' => 'field_slug', 'excerpt' => 'field_excerpt'] as $key => $field) {
      if (isset($data[$key])) {
        $note->set($field, trim($data[$key]));
      }
    }
    if (isset($data['body'])) {
      $note->set('field_body', ['value' => trim(str_replace("\r\n", "\n", $data['body'])), 'format' => 'field_note_text']);
    }
    if (isset($data['category'])) {
      $note->set('field_category', $this->categoryTerm(trim($data['category'])));
    }
    if (array_key_exists('relatedSpeciesIds', $data)) {
      $note->set('field_related_species', $related);
    }
    if ($statusChanges) {
      $note->setPublished($publish);
      // A note's date is the day it went out, as in the journal.
      if ($publish) {
        $note->setCreatedTime($this->time->getRequestTime());
      }
    }

    $violations = $note->validate()->getByFields(array_keys(self::FIELDS));
    if ($violations->count()) {
      $messages = [];
      foreach ($violations as $violation) {
        $field = explode('.', $violation->getPropertyPath())[0];
        $messages[] = (self::FIELDS[$field] ?? $field) . ': ' . strip_tags((string) $violation->getMessage());
      }
      return $this->error(implode(' ', array_unique($messages)), 422);
    }

    $note->setNewRevision();
    $note->setRevisionUserId((int) $this->currentUser()->id());
    $note->setRevisionLogMessage('Saved from the Writing desk.');
    $note->setChangedTime($this->time->getRequestTime());
    $note->save();
    return $this->json($this->records->post($note, $this->currentUser()), $status);
  }

  /**
   * @return list<int>|null Species node IDs, or NULL when any entry is invalid.
   */
  private function speciesIds(mixed $value): ?array {
    if (!is_array($value) || !array_is_list($value) || count($value) > 50) {
      return NULL;
    }
    $ids = [];
    foreach ($value as $slug) {
      $species = is_string($slug) ? $this->records->speciesNode($slug) : NULL;
      if (!$species) {
        return NULL;
      }
      $ids[] = (int) $species->id();
    }
    return array_values(array_unique($ids));
  }

  private function categoryTerm(string $name): int {
    $storage = $this->entityTypeManager()->getStorage('taxonomy_term');
    $terms = $storage->loadByProperties(['vid' => 'journal_category', 'name' => $name]);
    if ($terms) {
      return (int) reset($terms)->id();
    }
    $term = $storage->create(['vid' => 'journal_category', 'name' => $name]);
    $term->save();
    return (int) $term->id();
  }

  /**
   * A field note by node ID or slug.
   */
  private function find(string $id): ?NodeInterface {
    $note = ctype_digit($id)
      ? $this->storage()->load($id)
      : (($found = $this->storage()->loadByProperties(['type' => 'field_note', 'field_slug' => $id])) ? reset($found) : NULL);
    return $note instanceof NodeInterface && $note->bundle() === 'field_note' ? $note : NULL;
  }

  /**
   * @return array<string, mixed>|JsonResponse
   */
  private function payload(Request $request): array|JsonResponse {
    $body = (string) $request->getContent();
    if (strlen($body) > self::MAX_REQUEST_BYTES) {
      return $this->error('Post data is too large.', 413);
    }
    if (!str_starts_with((string) $request->headers->get('Content-Type'), 'application/json')) {
      return $this->error('JSON is required.', 415);
    }
    $data = json_decode($body, TRUE);
    if (!is_array($data) || array_is_list($data)) {
      return $this->error('Send a JSON object.', 400);
    }
    return $data;
  }

  private function deskDenied(): ?JsonResponse {
    if ($this->currentUser()->isAnonymous()) {
      return $this->error('Sign in to use the writing desk.', 401);
    }
    return $this->currentUser()->hasPermission('use naturedex writing desk') ? NULL : $this->error('Your account is not allowed to do that.', 403);
  }

  /**
   * The CSRF header already stops cross-site requests. This second check
   * answers them clearly and does not depend on how a request signed in.
   */
  private function crossOrigin(Request $request): ?JsonResponse {
    $rejected = $this->error('Cross-origin editing is not allowed.', 403);
    if ($request->headers->get('Sec-Fetch-Site') === 'cross-site') {
      return $rejected;
    }
    $origin = $request->headers->get('Origin');
    return $origin === NULL || $origin === $request->getSchemeAndHttpHost() ? NULL : $rejected;
  }

  private function storage() {
    return $this->entityTypeManager()->getStorage('node');
  }

  private function json(mixed $data, int $status = 200): JsonResponse {
    return new JsonResponse($data, $status, ['Cache-Control' => 'no-store']);
  }

  private function error(string $message, int $status): JsonResponse {
    return $this->json(['message' => $message], $status);
  }

}
