/**
 * Per-browser identity. Drives the `author` field on history entries so
 * a shared room shows "Adrien made this change" instead of an opaque
 * `user-X9F2`. Stored in localStorage under a single key; no server-side
 * auth or account model. When the user shares a `.unspa` file or
 * connects to a sync session, the name attached to their tab travels
 * with every edit they make.
 *
 * Browser-only. SSR-safe by guarding every storage access; on the
 * server the store just exposes an empty default. `init()` is called
 * once from the root layout's onMount to hydrate from localStorage.
 *
 * Sanitization caps length and strips characters that would break the
 * URL-encoded transport on the WebSocket — what the server stores in
 * the history log must be safe to render verbatim in the UI.
 */

const STORAGE_KEY = 'unspa.identity.name';
// Separate flag so the auto-prompt on the layout fires AT MOST ONCE per
// browser, not once per reload. Persisted in localStorage so the user can
// dismiss the dialog (leaving name blank) and not get re-prompted on
// every navigation. The avatar button in the header remains the way to
// set / change the name later.
const ASKED_STORAGE_KEY = 'unspa.identity.asked';
const MAX_LENGTH = 40;
const ANONYMOUS = 'Anonymous';

const sanitize = (raw: string): string =>
  raw.replace(/[^\p{L}\p{N} \-_.@'’]/gu, '').trim().slice(0, MAX_LENGTH);

class IdentityStore {
  /**
   * Current name as typed by the user. Empty string when nothing has
   * been set — UI components render a "Set your name" affordance in
   * that case.
   */
  name = $state<string>('');
  private initialized = false;

  /** Hydrate from localStorage. Idempotent. */
  init(): void {
    if (this.initialized) return;
    this.initialized = true;
    if (typeof localStorage === 'undefined') return;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) this.name = sanitize(stored);
  }

  setName(next: string): void {
    const cleaned = sanitize(next);
    this.name = cleaned;
    if (typeof localStorage === 'undefined') return;
    if (cleaned.length > 0) localStorage.setItem(STORAGE_KEY, cleaned);
    else localStorage.removeItem(STORAGE_KEY);
  }

  /**
   * Whether the layout has already shown the auto-prompt for this
   * browser. The flag survives reloads (localStorage), so once the user
   * has been asked — even if they cancelled without entering a name —
   * we don't keep popping up the dialog on every navigation. The
   * header avatar stays the explicit way to set a name later.
   */
  get hasBeenAsked(): boolean {
    if (typeof localStorage === 'undefined') return true;
    return localStorage.getItem(ASKED_STORAGE_KEY) === '1';
  }

  /** Mark the auto-prompt as fired so it doesn't run again. */
  markAsked(): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(ASKED_STORAGE_KEY, '1');
  }

  /**
   * Author tag for sync transport. The wsServer treats this as the
   * connection's identity for every history entry produced over that
   * socket. Always non-empty so the server doesn't have to special-case
   * a missing/blank value.
   */
  get author(): string {
    return this.name.length > 0 ? this.name : ANONYMOUS;
  }
}

export const identityStore = new IdentityStore();
