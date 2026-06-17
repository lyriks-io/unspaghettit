/**
 * Active dashboard theme. Purely cosmetic — it only decides which colour skin
 * the design system renders with (see `registry.ts`); no feature ever depends
 * on it.
 *
 * Resolution order, highest priority first:
 *   1. The browser choice made via the header switcher (localStorage).
 *   2. The CLI default (`PUBLIC_UNSPA_THEME`, set by `unspa theme set` /
 *      `unspa dashboard --theme`).
 *   3. The default theme.
 *
 * The initial value is seeded from `PUBLIC_UNSPA_THEME` so server-side
 * rendering paints the CLI-default chrome with no flash. On the client,
 * `init()` re-reads the `data-theme` attribute on <html> — which the inline
 * head script in app.html has already overridden from localStorage when the
 * user has a saved choice — and mirrors it into reactive state so the chrome in
 * the layout (header gradient, canvas) tracks it. `setTheme` updates the
 * attribute (re-skinning every token-driven colour) and persists to
 * localStorage, all live, no reload.
 *
 * Browser-only side effects are guarded so the store is SSR-safe.
 */
import { env } from '$env/dynamic/public';
import { parseThemeId, type DashboardThemeId } from './registry';

const STORAGE_KEY = 'unspa.theme';

class ThemeStore {
  /** The currently applied theme id. */
  current = $state<DashboardThemeId>(parseThemeId(env.PUBLIC_UNSPA_THEME));
  private initialized = false;

  /**
   * Hydrate from the `data-theme` attribute already on <html> (server default,
   * possibly overridden by the inline head script from localStorage). Idempotent.
   */
  init(): void {
    if (this.initialized) return;
    this.initialized = true;
    if (typeof document === 'undefined') return;
    this.current = parseThemeId(document.documentElement.dataset.theme);
  }

  /** Apply a theme live: reactive state + the <html> attribute + localStorage. */
  setTheme(next: DashboardThemeId): void {
    const id = parseThemeId(next);
    this.current = id;
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.theme = id;
    }
    if (typeof localStorage === 'undefined') return;
    // Only persist a non-default choice; clearing the key lets the CLI default
    // (PUBLIC_UNSPA_THEME) win again on the next load.
    if (id === 'default') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, id);
  }

  /** Convenience flag for the layout's chrome conditionals. */
  get isLyriks(): boolean {
    return this.current === 'lyriks';
  }
}

export const themeStore = new ThemeStore();
