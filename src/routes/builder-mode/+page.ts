import { redirect } from '@sveltejs/kit';
import { isEnabled } from '$lib/views/enabled';

/**
 * The Builder view is opt-in (PUBLIC_UNSPA_VIEWS). When it isn't enabled the
 * route must not be reachable — not just hidden from the header — so a direct
 * hit falls back to the default Expert view instead of rendering a view that's
 * supposed to be off.
 */
export const load = () => {
  if (!isEnabled('builder')) throw redirect(307, '/projects');
};
