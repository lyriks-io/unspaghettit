/**
 * Runtime base-path helpers. The dashboard can be served under a URL prefix
 * (e.g. https://host/behavior) decided when the server starts, not when the
 * build runs: one prebuilt npm package has to serve every deployment, so
 * SvelteKit's build-time `kit.paths.base` cannot carry it. The prefix rides in
 * `PUBLIC_UNSPA_BASE_PATH` instead, and these pure helpers apply it at the
 * edges only: `prependBase` on every URL handed to the browser (links, fetch,
 * sockets), `stripBase` on every pathname read back from it (route matching,
 * request routing). Internal path strings stay app-rooted (`/projects/...`),
 * so the domain layer and its tests never see the prefix.
 *
 * Pure on purpose: this module is imported from the SvelteKit bundle AND from
 * the CLI server (tsx, no $env virtual modules), so it must not read the
 * environment itself. `src/shared/routing/appBase.ts` binds it to the env for
 * Kit code; server entries pass `process.env.PUBLIC_UNSPA_BASE_PATH` in.
 */

// Conservative charset: path segments an operator would realistically choose
// (/behavior, /tools/unspa). Anything else (spaces, %-escapes, dot-dot
// traversal, HTML metacharacters) fails closed to "no prefix", which keeps
// the app reachable at / instead of half-configured under a broken prefix.
const VALID_BASE = /^[A-Za-z0-9/_.-]+$/;

/** Normalize an operator-supplied prefix to '' or '/segment(/segment)*'. */
export const normalizeBasePath = (raw: string | undefined | null): string => {
  const trimmed = (raw ?? '').trim();
  if (trimmed.length === 0) return '';
  const withLead = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const collapsed = withLead.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  if (collapsed.length === 0 || collapsed === '/') return '';
  if (!VALID_BASE.test(collapsed)) return '';
  if (collapsed.split('/').some((segment) => segment === '.' || segment === '..')) return '';
  return collapsed;
};

/** Prefix an app-rooted path ('/projects') for the browser. '/' maps to the base itself. */
export const prependBase = (base: string, path: string): string => {
  if (base.length === 0) return path;
  return path === '/' ? base : `${base}${path}`;
};

/** Undo the prefix on a pathname; a pathname outside the base passes through untouched. */
export const stripBase = (base: string, pathname: string): string => {
  if (base.length === 0) return pathname;
  if (pathname === base) return '/';
  if (pathname.startsWith(`${base}/`)) return pathname.slice(base.length);
  return pathname;
};

/**
 * `stripBase` for a raw `req.url`, which may carry a query string right after
 * the base ('/behavior?x=1') where a pathname never could.
 */
export const stripBaseFromRequestUrl = (base: string, url: string): string => {
  if (base.length === 0) return url;
  if (url === base) return '/';
  if (url.startsWith(`${base}/`)) return url.slice(base.length);
  if (url.startsWith(`${base}?`)) return `/${url.slice(base.length)}`;
  return url;
};
