/**
 * Dashboard theme registry.
 *
 * A "theme" is a purely cosmetic skin over the design system — it swaps the
 * `@theme` color-token *values* (the brand ramp, the canvas, the hairline) and
 * a little chrome (the header/shell background). It never adds, removes, or
 * moves a feature: every surface, action, and control is identical between
 * themes; only the colours change.
 *
 * Default is the always-present base look (the teal/cyan brand). Every other
 * theme is opt-in, chosen at runtime by `PUBLIC_UNSPA_THEME` (the CLI default,
 * via `unspa theme set` / `unspa dashboard --theme`) and overridable live in
 * the browser by the header switcher (persisted in localStorage).
 *
 * This module is pure (no `$env`, no Svelte, no DOM) so it's unit-testable; the
 * runtime wiring lives in `themeStore.svelte.ts` (browser) and `hooks.server.ts`
 * (initial server-rendered attribute).
 */
export type DashboardThemeId = 'default' | 'lyriks';

export interface DashboardTheme {
  readonly id: DashboardThemeId;
  readonly label: string;
  readonly description: string;
  /** A representative CSS `background` value, shown as a swatch in the switcher. */
  readonly swatch: string;
}

/** The base theme. Always available; the look you get with no theme set. */
const DEFAULT: DashboardTheme = {
  id: 'default',
  label: 'Default',
  description: 'The standard Unspaghettit look — teal/cyan brand on a soft canvas.',
  swatch: 'linear-gradient(135deg,#22d3ee,#06b6d4,#0e7490)'
};

/** Opt-in themes, keyed by the id used in `PUBLIC_UNSPA_THEME`. */
const OPTIONAL_THEMES: Readonly<Record<string, DashboardTheme>> = {
  lyriks: {
    id: 'lyriks',
    label: 'Lyriks',
    description: 'Lyriks.io brand skin — a violet→fuchsia gradient header over a cool canvas.',
    swatch: 'linear-gradient(90deg,#6d28d9,#a21caf,#db2777)'
  }
};

/** Default first, then the opt-in themes, in registration order. */
export const ALL_THEMES: readonly DashboardTheme[] = [DEFAULT, ...Object.values(OPTIONAL_THEMES)];

/**
 * Parse a raw `PUBLIC_UNSPA_THEME` (or localStorage / CLI) value into a known
 * theme id. Trims + lowercases; anything unrecognised (including the literal
 * "default" and the unreplaced `%unspa.theme%` placeholder) falls back to the
 * default theme, so a bad value never blanks the UI.
 */
export const parseThemeId = (raw: string | undefined): DashboardThemeId => {
  const id = (raw ?? '').trim().toLowerCase();
  return id in OPTIONAL_THEMES ? (id as DashboardThemeId) : 'default';
};

/** Resolve a raw value into its full theme definition. */
export const resolveTheme = (raw: string | undefined): DashboardTheme => {
  const id = parseThemeId(raw);
  return id === 'default' ? DEFAULT : OPTIONAL_THEMES[id]!;
};

/** The opt-in themes (everything except the always-on default base). */
export const optionalThemes = (): readonly DashboardTheme[] => Object.values(OPTIONAL_THEMES);

/**
 * Whether `id` names a known theme — including the always-valid "default", so
 * the CLI accepts `unspa theme set default` as an explicit revert.
 */
export const isThemeId = (id: string): boolean => {
  const normalized = id.trim().toLowerCase();
  return normalized === 'default' || Object.prototype.hasOwnProperty.call(OPTIONAL_THEMES, normalized);
};
