import type { Reroute } from '@sveltejs/kit';
import { basePath, stripBasePath } from '$shared/routing/appBase';

/**
 * Map a prefixed public URL onto the app's routes. The prefix is a runtime
 * value (PUBLIC_UNSPA_BASE_PATH), so `kit.paths.base`, a build-time constant,
 * cannot express it; rerouting is what lets one prebuilt bundle answer under
 * any prefix. On the client this makes the SPA router match
 * /<base>/projects/... against src/routes/projects. On the server the
 * production entry (cli/dashboard-server.ts) has already stripped the prefix,
 * and an unprefixed pathname passes through untouched, so the app stays
 * reachable both with and without it.
 */
export const reroute: Reroute = ({ url }) => {
  if (basePath().length === 0) return;
  const stripped = stripBasePath(url.pathname);
  return stripped === url.pathname ? undefined : stripped;
};
