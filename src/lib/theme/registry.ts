/**
 * Dashboard theme registry.
 *
 * A "theme" is a purely cosmetic skin over the design system — it swaps the
 * `@theme` color-token *values* (the brand ramp, the canvas, the hairline) and
 * a little chrome (the header/shell background). It never adds, removes, or
 * moves a feature: every surface, action, and control is identical between
 * themes; only the colours change.
 *
 * Default is the Lyriks.io brand skin (violet→fuchsia). The original
 * teal/cyan look remains available as the opt-in "classic" theme, chosen at
 * runtime by `PUBLIC_UNSPA_THEME` (the CLI default, via `unspa theme set` /
 * `unspa dashboard --theme`) and overridable live in the browser by the
 * header switcher (persisted in localStorage). The literal id "default" is
 * accepted everywhere as an explicit revert to the default theme.
 *
 * This module is pure (no `$env`, no Svelte, no DOM) so it's unit-testable; the
 * runtime wiring lives in `themeStore.svelte.ts` (browser) and `hooks.server.ts`
 * (initial server-rendered attribute).
 */
export type DashboardThemeId = 'lyriks' | 'classic';

export interface DashboardTheme {
  readonly id: DashboardThemeId;
  readonly label: string;
  readonly description: string;
  /** A representative CSS `background` value, shown as a swatch in the switcher. */
  readonly swatch: string;
}

/** The id every unset / unknown / literal-"default" value resolves to. */
export const DEFAULT_THEME_ID: DashboardThemeId = 'lyriks';

/** The default theme. Always available; the look you get with no theme set. */
const DEFAULT: DashboardTheme = {
  id: 'lyriks',
  label: 'Lyriks',
  description: 'The default look: the Lyriks.io violet-to-fuchsia brand over a cool canvas.',
  swatch: 'linear-gradient(90deg,#6d28d9,#a21caf,#db2777)'
};

/** Opt-in themes, keyed by the id used in `PUBLIC_UNSPA_THEME`. */
const OPTIONAL_THEMES: Readonly<Record<string, DashboardTheme>> = {
  classic: {
    id: 'classic',
    label: 'Classic',
    description: 'The original Unspaghettit look: teal/cyan brand on a soft canvas.',
    swatch: 'linear-gradient(135deg,#22d3ee,#06b6d4,#0e7490)'
  }
};

/** Default first, then the opt-in themes, in registration order. */
export const ALL_THEMES: readonly DashboardTheme[] = [DEFAULT, ...Object.values(OPTIONAL_THEMES)];

/**
 * Parse a raw `PUBLIC_UNSPA_THEME` (or localStorage / CLI) value into a known
 * theme id. Trims + lowercases; anything unrecognised (including the literal
 * "default", the unreplaced `%unspa.theme%` placeholder, and pre-rename
 * values) falls back to the default theme, so a bad value never blanks the UI.
 */
export const parseThemeId = (raw: string | undefined): DashboardThemeId => {
  const id = (raw ?? '').trim().toLowerCase();
  if (id === DEFAULT.id) return DEFAULT.id;
  return id in OPTIONAL_THEMES ? (OPTIONAL_THEMES[id]!.id) : DEFAULT_THEME_ID;
};

/** Resolve a raw value into its full theme definition. */
export const resolveTheme = (raw: string | undefined): DashboardTheme => {
  const id = parseThemeId(raw);
  return id === DEFAULT.id ? DEFAULT : OPTIONAL_THEMES[id]!;
};

/** The opt-in themes (everything except the always-on default). */
export const optionalThemes = (): readonly DashboardTheme[] => Object.values(OPTIONAL_THEMES);

/**
 * Whether `id` names a known theme — including the always-valid "default", so
 * the CLI accepts `unspa theme set default` as an explicit revert.
 */
export const isThemeId = (id: string): boolean => {
  const normalized = id.trim().toLowerCase();
  return (
    normalized === 'default' ||
    normalized === DEFAULT.id ||
    Object.prototype.hasOwnProperty.call(OPTIONAL_THEMES, normalized)
  );
};
