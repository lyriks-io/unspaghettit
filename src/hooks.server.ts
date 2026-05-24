import type { Handle } from '@sveltejs/kit';
import {
  checkOrigin,
  checkRequestAuth,
  isAuthEnabled,
  isOriginCheckEnabled
} from '$lib/server/security/auth';

/**
 * Global request gate for the dashboard. When `UNSPA_AUTH_TOKEN` is
 * set, every /api/* request must carry the token (header for fetch,
 * `?token=` for SSE). When `UNSPA_ALLOWED_ORIGIN` is set, cross-site
 * browser requests with a mismatching Origin are rejected.
 *
 * Why /api/* specifically: page navigations (HTML routes) are safe to
 * leave unauthenticated — they don't expose data on their own, and a
 * page that can't fetch its data renders empty + triggers the
 * client-side token prompt. Gating only the data plane means an
 * incorrectly-configured client surfaces the auth failure clearly
 * instead of getting a vague 401 on every navigation.
 *
 * Default install (neither env set) is unchanged from before: no
 * checks fire and the handle pass-through is essentially free.
 */
export const handle: Handle = async ({ event, resolve }) => {
  const path = event.url.pathname;
  if (path.startsWith('/api/')) {
    if (isOriginCheckEnabled() && !checkOrigin(event.request)) {
      return new Response('Forbidden: origin not allowed', { status: 403 });
    }
    if (isAuthEnabled() && !checkRequestAuth(event.request, event.url)) {
      return new Response('Unauthorized: missing or invalid token', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Bearer realm="unspa-dashboard"' }
      });
    }
  }
  return resolve(event);
};
