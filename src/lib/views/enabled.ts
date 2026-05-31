import { env } from '$env/dynamic/public';
import {
  isViewEnabled,
  resolveEnabledViews,
  type DashboardView,
  type DashboardViewId
} from './registry';

/**
 * Runtime view enablement, read from `PUBLIC_UNSPA_VIEWS` (a comma list of
 * optional view ids, e.g. "builder"). Expert is always on. The value is a
 * runtime public env var — `unspa dashboard --view builder` sets it, or a
 * local `.env` for `vite dev` — so enabling a view is config, not a rebuild.
 */
export const enabledViews = (): readonly DashboardView[] =>
  resolveEnabledViews(env.PUBLIC_UNSPA_VIEWS);

export const isEnabled = (id: DashboardViewId): boolean =>
  isViewEnabled(env.PUBLIC_UNSPA_VIEWS, id);
