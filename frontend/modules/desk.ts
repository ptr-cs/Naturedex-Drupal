import { ApiError, createClient } from '../lib/api';
import { parseBody, slugify } from '../lib/domain';
import { all, create, fromTemplate, one, readJson } from '../lib/dom';
import type { DeskConfig, Post } from '../lib/types';
import { openDialog } from './dialog';

const errorText = (error: unknown, fallback: string) =>
  error instanceof ApiError ? error.message : fallback;

/** The Writing desk: list, write, preview, publish, and delete field notes. */
export function initDesk() {
  const found = document.querySelector<HTMLElement>('#writing-desk');
  if (!found) return;
  const root: HTMLElement = found;

  const request = createClient(readJson<DeskConfig>('naturedex-desk-config'));
  const form = one<HTMLFormElement>('[data-desk-form]', root);
  const list = one('[data-desk-list]', root);
  const empty = one('[data-desk-empty]', root);
  const message = one('[data-desk-message]', root);
  const errorBox = one('[data-desk-error]', root);
  const preview = one('[data-desk-preview]', root);
  const previewToggle = one('[data-desk-preview-toggle]', root);
  const saveButton = one<HTMLButtonElement>('[data-desk-save]', root);
  const saveLabel = one('[data-desk-save-label]', root);
  const field = <T extends HTMLElement>(name: string) =>
    form.elements.namedItem(name) as unknown as T;
  const title = field<HTMLInputElement>('title');
  const slug = field<HTMLInputElement>('slug');
  const category = field<HTMLInputElement>('category');
  const excerpt = field<HTMLTextAreaElement>('excerpt');
  const body = field<HTMLTextAreaElement>('body');
  const status = field<HTMLSelectElement>('status');
  const related = all<HTMLInputElement>('[name="relatedSpeciesIds"]', form);

  let editing: Post | null = null;

  function showError(text: string) {
    errorBox.textContent = text;
    errorBox.hidden = !text;
  }

  function setPreview(on: boolean) {
    previewToggle.setAttribute('aria-pressed', String(on));
    previewToggle.textContent = on ? 'Return to writing' : 'Preview article';
    preview.hidden = !on;
    body.hidden = on;
    // A hidden required field would block submission without any visible message.
    body.required = !on;
    if (!on) return;
    const heading = create('h2', '', title.value || 'Your title');
    const article = create('div', 'article-body');
    for (const block of parseBody(body.value))
      article.append(
        create(block.type === 'heading' ? 'h2' : 'p', '', block.text),
      );
    preview.replaceChildren(heading, article);
  }

  function showForm(post: Post | null) {
    editing = post;
    title.value = post?.title ?? '';
    slug.value = post?.slug ?? '';
    category.value = post?.category ?? 'Field Notes';
    excerpt.value = post?.excerpt ?? '';
    body.value = post?.body ?? '';
    status.value = post?.status ?? 'draft';
    for (const box of related)
      box.checked = post?.relatedSpeciesIds.includes(box.value) ?? false;

    one('[data-desk-form-title]', root).textContent = post
      ? 'Edit field note'
      : 'A fresh page.';
    setPreview(false);
    message.textContent = '';
    showError('');
    form.hidden = false;
    list.hidden = true;
    empty.hidden = true;
    title.focus();
  }

  function hideForm() {
    form.hidden = true;
    list.hidden = false;
    empty.hidden = list.childElementCount > 0;
  }

  function row(post: Post) {
    const article = create('article', 'editor-row');
    const copy = create('div');
    copy.append(
      create('span', `post-status status-${post.status}`, post.status),
      create('h2', '', post.title),
      create('p', '', post.excerpt),
    );
    const actions = create('div', 'editor-row-actions');
    const edit = create('button', 'secondary-button');
    edit.type = 'button';
    edit.setAttribute('aria-label', `Edit ${post.title}`);
    edit.append(fromTemplate('[data-desk-row-icon]'), 'Edit');
    edit.addEventListener('click', () => showForm(post));
    const remove = create('button', 'delete-button', 'Delete');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Delete ${post.title}`);
    remove.addEventListener('click', () => confirmDelete(post));
    actions.append(edit, remove);
    article.append(copy, actions);
    return article;
  }

  async function refresh() {
    const posts = await request<Post[]>('posts?includeDrafts=1');
    list.replaceChildren(...posts.map(row));
    empty.hidden = !form.hidden || posts.length > 0;
  }

  function confirmDelete(post: Post) {
    const content = document.createDocumentFragment();
    const actions = create('div', 'dialog-actions');
    const keep = create('button', 'secondary-button', 'Keep post');
    keep.type = 'button';
    const confirm = create('button', 'danger-button', 'Delete post');
    confirm.type = 'button';
    actions.append(keep, confirm);
    content.append(
      create('h2', '', 'Delete this field note?'),
      create(
        'p',
        '',
        `“${post.title}” and its revision history will be permanently deleted. This can’t be undone.`,
      ),
      actions,
    );
    const dialog = openDialog({
      label: 'Delete field note',
      closeLabel: 'Cancel deletion',
      content,
    });
    keep.addEventListener('click', dialog.close);
    confirm.addEventListener('click', async () => {
      confirm.disabled = true;
      confirm.textContent = 'Deleting…';
      showError('');
      try {
        await request(`posts/${post.id}`, { method: 'DELETE' });
        await refresh();
        message.textContent = 'Field note deleted.';
      } catch (error) {
        showError(errorText(error, 'Could not delete the post.'));
      }
      dialog.close();
    });
  }

  title.addEventListener('input', () => {
    if (editing) return;
    // Follow the title until the author types their own slug.
    const previous = slug.dataset.generated ?? '';
    if (!slug.value || slug.value === previous) {
      slug.value = slugify(title.value);
      slug.dataset.generated = slug.value;
    }
  });
  one('[data-desk-new]', root).addEventListener('click', () => showForm(null));
  one('[data-desk-cancel]', root).addEventListener('click', hideForm);
  previewToggle.addEventListener('click', () =>
    setPreview(preview.hidden === true),
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showError('');
    saveButton.disabled = true;
    saveLabel.textContent = 'Saving…';
    const payload: Record<string, unknown> = {
      title: title.value,
      slug: slug.value,
      excerpt: excerpt.value,
      body: body.value,
      status: status.value,
      category: category.value,
      relatedSpeciesIds: related
        .filter((box) => box.checked)
        .map((box) => box.value),
    };
    try {
      await request<Post>(editing ? `posts/${editing.id}` : 'posts', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      await refresh();
      hideForm();
      message.textContent =
        status.value === 'published'
          ? 'Field note published. You can read it in the field journal.'
          : 'Draft saved. It is visible only in the writing desk.';
    } catch (error) {
      showError(errorText(error, 'Could not save the post.'));
    } finally {
      saveButton.disabled = false;
      saveLabel.textContent = 'Save post';
    }
  });

  refresh().catch((error: unknown) =>
    showError(errorText(error, 'The field notes could not load.')),
  );
}
