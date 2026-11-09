import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, createClient } from '../../frontend/lib/api';

const config = {
  root: 'https://example.test/api/naturedex/',
  csrfToken: 'stale',
  tokenUrl: 'https://example.test/session/token',
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

afterEach(() => vi.unstubAllGlobals());

describe('the Writing desk API client', () => {
  it('sends the CSRF token and same-origin credentials', async () => {
    const fetchMock = vi.fn(async () => json(200, []));
    vi.stubGlobal('fetch', fetchMock);
    await createClient(config)('posts');
    expect(fetchMock).toHaveBeenCalledWith(
      `${config.root}posts`,
      expect.objectContaining({
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'X-CSRF-Token': 'stale' },
      }),
    );
  });

  it('fetches a fresh token after Drupal rejects one, and retries once', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(403, { message: 'X-CSRF-Token request header is invalid' }))
      .mockResolvedValueOnce(new Response('Fresh-token_123'))
      .mockResolvedValueOnce(json(200, { id: '7' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(createClient(config)('posts/7', { method: 'PATCH' })).resolves.toEqual({ id: '7' });
    expect(fetchMock.mock.calls[1][0]).toBe(config.tokenUrl);
    expect(fetchMock.mock.calls[2][1].headers['X-CSRF-Token']).toBe('Fresh-token_123');
  });

  it('does not retry a permission refusal', async () => {
    const fetchMock = vi.fn(async () => json(403, { message: 'Your account can save drafts but cannot publish.' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(createClient(config)('posts')).rejects.toEqual(
      new ApiError('Your account can save drafts but cannot publish.', 403),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports the server message for a validation failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(422, { message: 'slug: That slug is already in use.' })));
    await expect(createClient(config)('posts')).rejects.toEqual(new ApiError('slug: That slug is already in use.', 422));
  });

  it('tells the author when their session has ended', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(401, { message: 'Sign in.' })));
    await expect(createClient(config)('posts')).rejects.toThrow(/session/);
  });

  it('treats a 204 delete as success without parsing a body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
    await expect(createClient(config)('posts/7')).resolves.toBeUndefined();
  });
});
