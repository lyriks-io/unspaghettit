/**
 * Persistent first-run onboarding state. Decides whether the
 * "Getting started" banner stays visible across the app.
 *
 * The banner shows on every page until the user either finishes the
 * interactive tour or explicitly dismisses the banner. Both outcomes
 * are remembered per browser in localStorage, so the banner never
 * comes back on reload; the Help page keeps a "restart the tour"
 * button as the permanent re-entry point.
 *
 * Browser-only. SSR-safe: on the server (and before `init()` runs from
 * the root layout's onMount) the status stays 'unknown', which the
 * banner treats as hidden, so users who already dismissed it never
 * see a flash of onboarding chrome.
 */

const STORAGE_KEY = 'unspa.onboarding.first-feature';

type OnboardingStatus = 'unknown' | 'open' | 'completed' | 'dismissed';

class OnboardingStore {
  status = $state<OnboardingStatus>('unknown');
  private initialized = false;

  /** Hydrate from localStorage. Idempotent. */
  init(): void {
    if (this.initialized) return;
    this.initialized = true;
    if (typeof localStorage === 'undefined') return;
    const stored = localStorage.getItem(STORAGE_KEY);
    this.status = stored === 'completed' || stored === 'dismissed' ? stored : 'open';
  }

  /** True while the getting-started banner should render. */
  get showBanner(): boolean {
    return this.status === 'open';
  }

  /**
   * The user closed the banner without taking the tour. Exiting the
   * tour mid-way does NOT dismiss - only the banner's own close button
   * does, so an aborted tour can be retried from anywhere.
   */
  dismiss(): void {
    this.persist('dismissed');
  }

  /** The user reached the end of the interactive tour. */
  markCompleted(): void {
    this.persist('completed');
  }

  private persist(next: 'completed' | 'dismissed'): void {
    this.status = next;
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage blocked (private browsing). The in-memory state still
      // hides the banner for this session.
    }
  }
}

export const onboardingStore = new OnboardingStore();
