/**
 * State of the Lyriks Community splash: has this user opted out of it for good,
 * has it been closed for the current visit, and did they ask to see it again?
 *
 * The offer stands until the user says otherwise. Closing the panel (the header
 * cross, Escape, the backdrop, or following a link out) only clears it for the
 * current visit: it opens again on the next load of a standalone install. ONE
 * affordance retires it permanently, the explicit "keep using Unspaghettit on
 * its own", and only that one writes to storage.
 *
 * Browser-only. Before `init()` runs from the root layout's onMount,
 * `optedOut` stays `null`, which the offer predicate treats as "closed", so
 * someone who already opted out never sees it flash.
 */

const STORAGE_KEY = 'unspa.lyriks-community.opted-out';

class CommunitySplashStore {
  /** `null` until hydrated; then whether the user retired the offer for good. */
  optedOut = $state<boolean | null>(null);
  /** Closed for this visit only. In memory on purpose: a reload brings it back. */
  dismissedForNow = $state(false);
  /** The user reopened it explicitly from the app menu. Overrides both above. */
  reopened = $state(false);
  private initialized = false;

  /** Hydrate from localStorage. Idempotent. */
  init(): void {
    if (this.initialized) return;
    this.initialized = true;
    if (typeof localStorage === 'undefined') {
      this.optedOut = false;
      return;
    }
    try {
      this.optedOut = localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      // Storage blocked (private browsing). Treat it as "never opted out": the
      // offer shows, and an opt-out still holds for the rest of this session.
      this.optedOut = false;
    }
  }

  /** Show it again on demand. */
  open(): void {
    this.reopened = true;
    this.dismissedForNow = false;
  }

  /** Close it for this visit. Not remembered: it opens again on the next load. */
  dismiss(): void {
    this.reopened = false;
    this.dismissedForNow = true;
  }

  /** The user retired the offer. This one is remembered, and it is the only one. */
  optOut(): void {
    this.dismiss();
    this.optedOut = true;
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, 'true');
    } catch {
      // In-memory state alone still keeps it closed for this session.
    }
  }
}

export const communitySplashStore = new CommunitySplashStore();
