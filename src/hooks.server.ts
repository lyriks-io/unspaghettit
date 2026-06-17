import type { Handle } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';
import {
  checkOrigin,
  checkRequestAuth,
  isAuthEnabled,
  isOriginCheckEnabled
} from '$lib/server/security/auth';
import { parseThemeId } from '$lib/theme/registry';

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
  // Seed the initial colour theme into the server-rendered <html data-theme>
  // so the CLI default (PUBLIC_UNSPA_THEME) paints with no flash. The inline
  // head script in app.html may still override this from localStorage when the
  // user picked a theme via the in-app switcher. Inert for HTML responses that
  // don't carry the placeholder (e.g. the /api JSON above already returned).
  const theme = parseThemeId(env.PUBLIC_UNSPA_THEME);
  return resolve(event, {
    transformPageChunk: ({ html }) => html.replace('%unspa.theme%', theme)
  });
};
