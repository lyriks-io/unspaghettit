/**
 * Document titles, brand-aware.
 *
 * The dashboard runs standalone AND embedded in a Lyriks host (`?brand=lyriks`,
 * see HeaderBrand). When the host owns the chrome, the browser tab still said
 * "Unspaghettit" — the one place the embedding leaked, and the most visible one,
 * since the tab is what the user reads to find the window again.
 *
 * `brand=lyriks` therefore renames the product half of the title, and pages that
 * are ABOUT one thing (a project, a feature) lead with its name so several open
 * tabs are distinguishable. Pages that aren't about one entity just carry their
 * section name.
 */

import { isLyriksBrand } from './hostBrand';

export const UNSPAGHETTIT_TITLE = 'Unspaghettit';
export const LYRIKS_TITLE = 'Lyriks - Behavior Editor';

/** The product half of the title, chosen by the `brand` query parameter. */
export const brandTitle = (url: URL | null | undefined): string =>
  isLyriksBrand(url) ? LYRIKS_TITLE : UNSPAGHETTIT_TITLE;

/**
 * Compose a document title, most specific part first, product name last:
 *
 *   pageTitle(url, 'Checkout')            → "Checkout / Unspaghettit"
 *   pageTitle(url, 'MCP', 'Checkout')     → "MCP / Checkout / Lyriks - Behavior Editor"
 *
 * Empty / absent parts are dropped, so a caller can pass an entity name that
 * hasn't loaded yet without rendering a stray separator.
 */
export const pageTitle = (
  url: URL | null | undefined,
  ...parts: readonly (string | null | undefined)[]
): string =>
  [...parts.map((p) => p?.trim()).filter((p): p is string => !!p), brandTitle(url)].join(' / ');
