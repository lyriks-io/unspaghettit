/**
 * Browser-side store for the optional dashboard bearer token. The
 * dashboard server gates /api/* + the WebSocket only when
 * `UNSPA_AUTH_TOKEN` is set on its env; until then this store stays
 * empty and `apiFetch` / WS URLs don't include a token. When the
 * server starts returning 401, the layout opens a prompt to capture
 * the token; it persists in localStorage so subsequent reloads reuse
 * it without re-prompting.
 *
 * Single localStorage key, no expiry, no rotation. Rotation = admin
 * restarts the dashboard with a new token; users get a 401, get
 * re-prompted on the next request, store the new value. Simple.
 */

const STORAGE_KEY = 'unspa.auth.token';

class AuthStore {
  /** Empty string when unset. */
  token = $state<string>('');
  private initialized = false;

  /** Hydrate from localStorage. Idempotent. */
  init(): void {
    if (this.initialized) return;
    this.initialized = true;
    if (typeof localStorage === 'undefined') return;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) this.token = stored;
  }

  setToken(next: string): void {
    const trimmed = next.trim();
    this.token = trimmed;
    if (typeof localStorage === 'undefined') return;
    if (trimmed.length > 0) localStorage.setItem(STORAGE_KEY, trimmed);
    else localStorage.removeItem(STORAGE_KEY);
  }

  clear(): void {
    this.setToken('');
  }

  get hasToken(): boolean {
    return this.token.length > 0;
  }
}

export const authStore = new AuthStore();
