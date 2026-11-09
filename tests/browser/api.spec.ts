import { expect, request as playwrightRequest, test, type APIRequestContext } from '@playwright/test';

const api = '/api/naturedex';
const baseURL = 'http://127.0.0.1:4322';

/** A signed-in context and its CSRF token, as the Writing desk would hold them. */
async function session(name?: 'editor' | 'contributor' | 'reader') {
  const context = await playwrightRequest.newContext({
    baseURL,
    storageState: name ? `tests/.auth/${name}.json` : { cookies: [], origins: [] },
  });
  const token = name ? (await (await context.get('/session/token')).text()).trim() : '';
  return { context, headers: { 'X-CSRF-Token': token } };
}

function fieldNote(overrides: Record<string, unknown> = {}) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  return {
    title: `API field note ${suffix}`,
    slug: `api-field-note-${suffix}`,
    excerpt: 'A record created in the isolated test site.',
    body: '## A repeatable field test\n\nThis article exercises actual persistent CMS storage.',
    status: 'draft',
    category: 'Field Notes',
    relatedSpeciesIds: [],
    ...overrides,
  };
}

async function remove(context: APIRequestContext, headers: Record<string, string>, id?: string) {
  if (id) await context.delete(`${api}/posts/${id}`, { headers });
}

test('the API persists create, draft, publish, update, and delete through Drupal', async () => {
  const { context, headers } = await session('editor');
  // Inside the test runner, contexts inherit the configured editor session unless told otherwise.
  const anonymous = (await session()).context;
  const note = fieldNote({ relatedSpeciesIds: ['red-fox', 'monarch'] });
  let id: string | undefined;
  try {
    const created = await context.post(`${api}/posts`, { headers, data: note });
    expect(created.status()).toBe(201);
    const record = await created.json();
    id = record.id;
    expect(record).toMatchObject({ slug: note.slug, status: 'draft', body: note.body, category: 'Field Notes', relatedSpeciesIds: ['red-fox', 'monarch'] });
    expect(record.publishedAt).toBeNull();

    // Drafts stay out of every public surface.
    expect((await anonymous.get(`${api}/posts/${note.slug}`)).status()).toBe(404);
    expect((await (await anonymous.get(`${api}/posts`)).json()).map((post: { id: string }) => post.id)).not.toContain(id);
    expect((await anonymous.get(`/journal/${note.slug}`)).status()).toBe(403);
    expect(await (await anonymous.get('/journal')).text()).not.toContain(note.title);

    const published = await context.patch(`${api}/posts/${id}`, { headers, data: { status: 'published', title: `${note.title} (edited)` } });
    expect(published.status()).toBe(200);
    expect(await published.json()).toMatchObject({ status: 'published', title: `${note.title} (edited)` });
    expect((await anonymous.get(`${api}/posts/${note.slug}`)).status()).toBe(200);
    // Published pages are cached for visitors; saving must clear them.
    expect(await (await anonymous.get('/journal')).text()).toContain(`${note.title} (edited)`);
    expect(await (await anonymous.get('/')).text()).toContain(`${note.title} (edited)`);

    // Every save is a Drupal revision.
    const revisions = await context.get(`/node/${id}/revisions`);
    expect(revisions.status()).toBe(200);
    expect((await revisions.text()).match(/Saved from the Writing desk\./g)?.length).toBeGreaterThanOrEqual(2);

    const deleted = await context.delete(`${api}/posts/${id}`, { headers });
    expect(deleted.status()).toBe(204);
    expect((await context.get(`${api}/posts/${id}`)).status()).toBe(404);
    expect((await anonymous.get(`/journal/${note.slug}`)).status()).toBe(404);
    id = undefined;
  } finally {
    await remove(context, headers, id);
    await context.dispose();
    await anonymous.dispose();
  }
});

test('validation reports every problem at once and rejects a taken slug', async () => {
  const { context, headers } = await session('editor');
  try {
    const invalid = await context.post(`${api}/posts`, {
      headers,
      data: { title: ' ', slug: 'ok-slug', status: 'maybe', relatedSpeciesIds: ['unicorn'] },
    });
    expect(invalid.status()).toBe(422);
    const { message } = await invalid.json();
    for (const problem of ['title is required', 'excerpt is required', 'body is required', 'Choose draft or published', 'known species IDs'])
      expect(message).toContain(problem);

    const badSlug = await context.post(`${api}/posts`, { headers, data: fieldNote({ slug: 'Not A Slug' }) });
    expect(badSlug.status()).toBe(422);
    expect((await badSlug.json()).message).toMatch(/^slug: Use lowercase letters/);

    const taken = await context.post(`${api}/posts`, { headers, data: fieldNote({ slug: 'read-the-water' }) });
    expect(taken.status()).toBe(422);
    expect((await taken.json()).message).toBe('slug: That slug is already in use.');

    const notJson = await context.post(`${api}/posts`, { headers: { ...headers, 'Content-Type': 'text/plain' }, data: 'title=x' });
    expect(notJson.status()).toBe(415);
  } finally {
    await context.dispose();
  }
});

test('writes need a session, a CSRF token, the same origin, and the right role', async () => {
  const anonymous = await session();
  expect((await anonymous.context.post(`${api}/posts`, { data: fieldNote() })).status()).toBe(401);
  expect((await anonymous.context.get(`${api}/posts?includeDrafts=1`)).status()).toBe(401);
  await anonymous.context.dispose();

  const editor = await session('editor');
  const noToken = await editor.context.post(`${api}/posts`, { data: fieldNote() });
  expect(noToken.status()).toBe(403);
  expect((await noToken.json()).message).toMatch(/X-CSRF-Token/);
  const crossOrigin = await editor.context.post(`${api}/posts`, {
    headers: { ...editor.headers, Origin: 'https://example.test' },
    data: fieldNote(),
  });
  expect(crossOrigin.status()).toBe(403);
  expect((await crossOrigin.json()).message).toBe('Cross-origin editing is not allowed.');

  const reader = await session('reader');
  expect((await reader.context.post(`${api}/posts`, { headers: reader.headers, data: fieldNote() })).status()).toBe(403);
  await reader.context.dispose();
  await editor.context.dispose();
});

test('contributors draft their own notes but cannot publish or change anyone else’s', async () => {
  const editor = await session('editor');
  const contributor = await session('contributor');
  let editorId: string | undefined;
  let ownId: string | undefined;
  try {
    const refused = await contributor.context.post(`${api}/posts`, { headers: contributor.headers, data: fieldNote({ status: 'published' }) });
    expect(refused.status()).toBe(403);
    expect((await refused.json()).message).toBe('Your account can save drafts but cannot publish.');

    const own = await contributor.context.post(`${api}/posts`, { headers: contributor.headers, data: fieldNote() });
    expect(own.status()).toBe(201);
    ownId = (await own.json()).id;
    expect((await contributor.context.patch(`${api}/posts/${ownId}`, { headers: contributor.headers, data: { title: 'Retitled draft' } })).status()).toBe(200);

    editorId = (await (await editor.context.post(`${api}/posts`, { headers: editor.headers, data: fieldNote() })).json()).id;
    expect((await contributor.context.patch(`${api}/posts/${editorId}`, { headers: contributor.headers, data: { title: 'x' } })).status()).toBe(403);
    expect((await contributor.context.delete(`${api}/posts/${editorId}`, { headers: contributor.headers })).status()).toBe(403);

    const listed = (await (await contributor.context.get(`${api}/posts?includeDrafts=1`)).json()) as Array<{ id: string }>;
    expect(listed.map((post) => post.id)).toEqual([ownId]);

    // An editor can publish the contributor's draft.
    expect((await editor.context.patch(`${api}/posts/${ownId}`, { headers: editor.headers, data: { status: 'published' } })).status()).toBe(200);
  } finally {
    await remove(editor.context, editor.headers, editorId);
    await remove(editor.context, editor.headers, ownId);
    await editor.context.dispose();
    await contributor.context.dispose();
  }
});

test('field note bodies are stored as typed and rendered without running HTML', async ({ page }) => {
  const { context, headers } = await session('editor');
  const note = fieldNote({ status: 'published', body: '## Safe heading\n\n<img src=x onerror="window.pwned=1"> & <b>bold</b>' });
  let id: string | undefined;
  try {
    const record = await (await context.post(`${api}/posts`, { headers, data: note })).json();
    id = record.id;
    expect(record.body).toBe(note.body);
    await page.goto(`/journal/${note.slug}`);
    await expect(page.getByRole('heading', { name: 'Safe heading', level: 2 })).toBeVisible();
    await expect(page.getByText('<img src=x onerror="window.pwned=1"> & <b>bold</b>')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { pwned?: number }).pwned)).toBeUndefined();
  } finally {
    await remove(context, headers, id);
    await context.dispose();
  }
});

test('species and regions are public JSON', async ({ request }) => {
  const species = await (await request.get(`${api}/species`)).json();
  expect(species).toHaveLength(24);
  expect(species[0]).toMatchObject({ id: 'white-tailed-deer', dexNumber: 1, url: '/species/white-tailed-deer' });
  const regions = await (await request.get(`${api}/regions`)).json();
  expect(regions.map((region: { id: string }) => region.id)).toEqual(['mountains', 'valley', 'piedmont', 'coastal']);
});
