/**
 * Dashboard view registry.
 *
 * A "view" is a top-level way to look at the model (Expert, Builder, and — as
 * the platform grows — others like a chat-explorable world). Expert is the
 * always-present default; every other view is opt-in. Which optional views are
 * active is decided at runtime by `PUBLIC_UNSPA_VIEWS` (a comma list of ids),
 * read in `enabled.ts`. The header shows a view switcher only when more than
 * one view is active — a toggle between one thing is meaningless.
 *
 * This module is pure (no `$env`, no Svelte) so it's unit-testable; the
 * runtime wiring lives in `enabled.ts`.
 */
export type DashboardViewId = 'expert' | 'builder';

export interface DashboardView {
  readonly id: DashboardViewId;
  readonly label: string;
  /** Where the nav link points. */
  readonly href: string;
  /** Whether a given pathname belongs to this view (drives the active pill). */
  readonly matches: (pathname: string) => boolean;
}

/** The base view. Always enabled; it's where the dashboard lands by default. */
const EXPERT: DashboardView = {
  id: 'expert',
  label: 'Expert',
  href: '/projects',
  matches: (pathname) =>
    pathname === '/' ||
    pathname.startsWith('/projects') ||
    pathname.startsWith('/features')
};

/** Opt-in views, keyed by the id used in `PUBLIC_UNSPA_VIEWS`. */
const OPTIONAL_VIEWS: Readonly<Record<string, DashboardView>> = {
  builder: {
    id: 'builder',
    label: 'Builder',
    href: '/builder-mode',
    matches: (pathname) => pathname.startsWith('/builder-mode')
  }
};

/**
 * Parse the raw `PUBLIC_UNSPA_VIEWS` value into the ordered, de-duped list of
 * enabled view ids. Expert is always first; unknown ids are ignored.
 */
export const parseEnabledViewIds = (raw: string | undefined): readonly DashboardViewId[] => {
  const requested = (raw ?? '')
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((id) => id.length > 0 && id !== 'expert' && id in OPTIONAL_VIEWS);
  const ordered = [...new Set(requested)] as DashboardViewId[];
  return ['expert', ...ordered];
};

/** Resolve the enabled view ids into their full definitions, in nav order. */
export const resolveEnabledViews = (raw: string | undefined): readonly DashboardView[] =>
  parseEnabledViewIds(raw).map((id) => (id === 'expert' ? EXPERT : OPTIONAL_VIEWS[id]!));

/** Whether a specific view is enabled. Expert is always enabled. */
export const isViewEnabled = (raw: string | undefined, id: DashboardViewId): boolean =>
  parseEnabledViewIds(raw).includes(id);

/** The opt-in views (everything except the always-on Expert base). */
export const optionalViews = (): readonly DashboardView[] => Object.values(OPTIONAL_VIEWS);

/** Whether `id` names a known opt-in view (used by the CLI to validate input). */
export const isOptionalViewId = (id: string): boolean =>
  Object.prototype.hasOwnProperty.call(OPTIONAL_VIEWS, id.trim().toLowerCase());
