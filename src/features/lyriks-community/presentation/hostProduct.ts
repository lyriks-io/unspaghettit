import { env } from '$env/dynamic/public';
import {
  hostProductName,
  isHostedRuntime,
  shouldShowUpgradeOffer,
  type UpgradeOfferContext
} from '$features/lyriks-community/domain/upgradeOffer';

/**
 * Env-bound face of the host-product signal, following the same shape as the
 * view and theme registries: the decisions are pure and unit-tested in
 * `domain/upgradeOffer.ts`, and this module is the only place that reads env.
 * Functions, not constants, because dynamic public env resolves per call, which
 * is what keeps one prebuilt bundle correct under any deployment.
 *
 * `PUBLIC_UNSPA_HOST_PRODUCT` is set by whatever ships this dashboard as part of
 * a bigger product (the Lyriks appliance image sets it). It is the only signal
 * that survives a user opening the editor directly with no query string, which
 * is exactly how an appliance user reaches it.
 */

/** Name of the product embedding this dashboard, or `null` when standalone. */
export const hostProduct = (): string | null => hostProductName(env.PUBLIC_UNSPA_HOST_PRODUCT);

/** Is this dashboard part of a host product rather than a standalone install? */
export const isHosted = (url: URL | null | undefined): boolean =>
  isHostedRuntime(env.PUBLIC_UNSPA_HOST_PRODUCT, url);

/** Is the Lyriks Community splash on screen right now? */
export const showUpgradeOffer = (ctx: Omit<UpgradeOfferContext, 'hostProduct'>): boolean =>
  shouldShowUpgradeOffer({ ...ctx, hostProduct: env.PUBLIC_UNSPA_HOST_PRODUCT });
