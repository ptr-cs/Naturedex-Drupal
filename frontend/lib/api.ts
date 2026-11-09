import type { DeskConfig } from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Client for the Writing desk API. Drupal checks an X-CSRF-Token header on
 * every write. If the session changed since the page loaded (signing in again
 * in another tab, for example), the client fetches a fresh token and retries
 * once rather than losing the author's work.
 */
export function createClient(config: DeskConfig) {
  let token = config.csrfToken;

  function send(path: string, init: RequestInit) {
    return fetch(`${config.root}${path}`, {
      ...init,
      credentials: 'same-origin',
      headers: { Accept: 'application/json', ...init.headers, 'X-CSRF-Token': token },
    });
  }

  async function refreshToken() {
    const response = await fetch(config.tokenUrl, { credentials: 'same-origin' });
    const fresh = response.ok ? (await response.text()).trim() : '';
    if (!/^[\w-]+$/.test(fresh)) return false;
    token = fresh;
    return true;
  }

  return async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response = await send(path, init);
    if (response.status === 403) {
      const failure = await response.clone().json().catch(() => null);
      if (/X-CSRF-Token/i.test(failure?.message ?? '') && (await refreshToken()))
        response = await send(path, init);
    }
    if (response.status === 204) return undefined as T;
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        response.status === 401
          ? 'Your session has ended. Sign in again in another tab, then retry.'
          : data?.message || 'The request could not be completed.';
      throw new ApiError(message, response.status);
    }
    return data as T;
  };
}
