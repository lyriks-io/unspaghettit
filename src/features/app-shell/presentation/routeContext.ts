import { isEnabled } from '$lib/views/enabled';

/**
 * Route-derived shell facts shared by the root layout and the header, so the
 * two never disagree on what the current URL means for the chrome.
 */

/** Builder is only "active" when it's both enabled and routed to. */
export function isBuilderRoute(pathname: string): boolean {
  return isEnabled('builder') && pathname.startsWith('/builder-mode');
}

/**
 * The feature editor + graph use a wider 1600px content column than the rest
 * of the app (max-w-7xl). The header matches whichever the current route uses,
 * so it always spans the same width as the content below.
 */
export function usesWideContent(pathname: string): boolean {
  return pathname.startsWith('/features/');
}
