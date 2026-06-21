import type { SurfacePanelTab } from '$features/maturity/domain/MaturityReport';

/**
 * Pure deep-link builders. These encapsulate the dashboard's existing URL
 * contracts so the search index never hard-codes route strings inline:
 *   • feature editor: `/features/<id>?tab=&surface=&panel=&focus=`
 *     (read by FeatureEditor's URL⇄store sync + focus observer)
 *   • project page:   `/projects/<id>`
 *   • domain page:    `/domains/<id>`
 *
 * `focus` is the value of a `data-focus-target` attribute the editor scrolls
 * to and pulses (e.g. `action:<id>` or `tab:<surfaceId>:<panel>`); only set it
 * for targets that actually render such an anchor.
 */

export type FeatureTopTab =
  | 'build'
  | 'resources'
  | 'data'
  | 'events'
  | 'transitions'
  | 'invariants';

export type FeatureHrefOptions = {
  readonly tab?: FeatureTopTab;
  readonly surface?: string;
  readonly panel?: SurfacePanelTab;
  readonly focus?: string;
};

/** Build a feature-editor deep link, omitting params left at their defaults. */
export const featureHref = (
  featureId: string,
  options: FeatureHrefOptions = {}
): string => {
  const params = new URLSearchParams();
  // Mirror FeatureEditor's store→URL effect: 'build' and 'actions' are the
  // implicit defaults, so leave them out for clean, stable URLs.
  if (options.tab && options.tab !== 'build') params.set('tab', options.tab);
  if (options.surface) params.set('surface', options.surface);
  if (options.panel && options.panel !== 'actions') params.set('panel', options.panel);
  if (options.focus) params.set('focus', options.focus);
  const qs = params.toString();
  return `/features/${encodeURIComponent(featureId)}${qs ? `?${qs}` : ''}`;
};

export const projectHref = (projectId: string): string =>
  `/projects/${encodeURIComponent(projectId)}`;

export const domainHref = (domainId: string): string =>
  `/domains/${encodeURIComponent(domainId)}`;

/** Focus token for an action's editor card (`data-focus-target` in ActionEditor). */
export const actionFocus = (actionId: string): string => `action:${actionId}`;

/** Focus token for a surface-panel tab body (`data-focus-target` in SurfacePanel). */
export const surfaceTabFocus = (surfaceId: string, panel: SurfacePanelTab): string =>
  `tab:${surfaceId}:${panel}`;
