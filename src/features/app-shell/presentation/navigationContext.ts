/** Query parameters that describe the host/session rather than one page. */
export const PERSISTENT_NAVIGATION_PARAMS = ['embed', 'user', 'brand'] as const;

/** Copy global navigation context without overriding an explicit destination value. */
export const copyPersistentNavigationParams = (
  source: URLSearchParams,
  destination: URLSearchParams
): URLSearchParams => {
  for (const name of PERSISTENT_NAVIGATION_PARAMS) {
    if (destination.has(name)) continue;
    for (const value of source.getAll(name)) destination.append(name, value);
  }
  return destination;
};

/** Apply the current global navigation context to another same-origin URL. */
export const withPersistentNavigationParams = (current: URL, destination: URL): URL => {
  const next = new URL(destination);
  copyPersistentNavigationParams(current.searchParams, next.searchParams);
  return next;
};
