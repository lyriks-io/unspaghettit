import { isEmbedded, isLyriksBrand } from '$features/app-shell/presentation/hostBrand';

/**
 * Should this runtime tell its user that Lyriks Community exists?
 *
 * Unspaghettit ships two ways: on its own (npm / the install script), and as the
 * behavior engine INSIDE a host product that already wraps a whole product
 * workspace around it (Lyriks Community and Enterprise embed it). The offer is
 * only meaningful in the first case. Showing "upgrade to the bundle" to someone
 * already running the bundle is noise, and showing anything self-promotional
 * inside a host's iframe is a defect.
 *
 * Pure on purpose (no `$env`, no Svelte, no storage): the runtime wiring lives
 * in `presentation/hostProduct.ts` and the store next to it.
 */

/**
 * Name of the product that embeds this dashboard, from the
 * `PUBLIC_UNSPA_HOST_PRODUCT` runtime env var. Any non-empty value means "a host
 * owns this deployment": the Lyriks appliance image sets it, and so can anyone
 * else who embeds Unspaghettit and does not want it advertising alternatives.
 */
export const hostProductName = (raw: string | undefined | null): string | null => {
  const name = (raw ?? '').trim();
  return name.length > 0 ? name : null;
};

/**
 * Is Unspaghettit running inside a host product rather than on its own?
 *
 * Three independent signals, because they cover three different deployments:
 *   - `PUBLIC_UNSPA_HOST_PRODUCT`: the deployment itself is part of a host
 *     product, whatever URL the user reaches it by. That is the appliance case,
 *     where a Lyriks user can open the behavior editor with no query string.
 *   - `?brand=...`: this navigation came from a host, with its livery on.
 *   - `?embed=1`: this document is FRAMED by a host.
 */
export const isHostedRuntime = (
  hostProduct: string | undefined | null,
  url: URL | null | undefined
): boolean => hostProductName(hostProduct) !== null || isLyriksBrand(url) || isEmbedded(url);

/** Everything that decides whether the splash is on screen right now. */
export type UpgradeOfferContext = {
  /** `PUBLIC_UNSPA_HOST_PRODUCT`, when a host product set it. */
  readonly hostProduct: string | undefined | null;
  /** The page URL, for the brand / embed signals. */
  readonly url: URL | null | undefined;
  /** Has the user retired the offer for good? `null` = not hydrated yet. */
  readonly optedOut: boolean | null;
  /** Closed for this visit only, which a reload undoes. */
  readonly dismissedForNow: boolean;
  /** Did the user ask for it again from the app menu? Overrides the two above. */
  readonly reopened: boolean;
  /** Is a modal dialog already on screen? Two stacked modals is never right. */
  readonly dialogOpen: boolean;
};

/**
 * The offer stands until the user says otherwise. It opens on every visit to a
 * standalone install, and closing the panel is only "not now": one explicit
 * opt-out retires it, and nothing else does.
 *
 * Until the opt-out flag has hydrated from storage the answer is "closed", so
 * someone who already retired it never gets a flash of it before it hides
 * itself again.
 */
export const shouldShowUpgradeOffer = (ctx: UpgradeOfferContext): boolean => {
  if (isHostedRuntime(ctx.hostProduct, ctx.url)) return false;
  if (ctx.dialogOpen) return false;
  if (ctx.reopened) return true;
  if (ctx.optedOut !== false) return false;
  return !ctx.dismissedForNow;
};
