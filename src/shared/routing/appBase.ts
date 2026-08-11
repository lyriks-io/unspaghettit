import { env } from '$env/dynamic/public';
import { normalizeBasePath, prependBase, stripBase } from './basePath';

/**
 * Env-bound face of the base-path helpers for SvelteKit code (server and
 * client bundles both resolve `$env/dynamic/public`; CLI entries cannot, and
 * use the pure module with `process.env` instead). Functions, not constants:
 * dynamic env is read per call, which is what lets tests vary it and keeps
 * one prebuilt bundle correct under any prefix.
 */
export const basePath = (): string => normalizeBasePath(env.PUBLIC_UNSPA_BASE_PATH);

/** Prefix an app-rooted path ('/projects') at a browser edge: href, goto, fetch, sockets. */
export const withBase = (path: string): string => prependBase(basePath(), path);

/** Undo the prefix on a pathname read from the browser: matchers, request gates. */
export const stripBasePath = (pathname: string): string => stripBase(basePath(), pathname);
