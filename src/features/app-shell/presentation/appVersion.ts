/**
 * The running dashboard release, as a plain string ("0.14.0").
 *
 * Read from the `__APP_VERSION__` constant Vite inlines at build time from
 * package.json, so the browser never has to fetch it and package.json itself
 * stays out of the client bundle. The fallback keeps consumers safe in
 * environments that evaluate this module without the define in place (unit
 * tests, an ad-hoc esbuild run).
 */
export const APP_VERSION: string =
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';

/** Display form used wherever the version is shown as a label. */
export const appVersionLabel = (): string => `v${APP_VERSION}`;
