/**
 * Default-on hardening for the loopback dashboard tier.
 *
 * The threat this closes is **DNS rebinding**. SECURITY.md's default tier
 * assumes "loopback bind ⇒ only this machine can reach the API". That is true
 * for the network layer but NOT for a browser: a page the developer visits at
 * `http://evil.example` can rebind that name to `127.0.0.1` and then issue
 * *same-origin* `fetch()`s at `http://evil.example:3000/api/...`. Those hit the
 * local dashboard, bypass CORS entirely (the page's own origin now resolves to
 * loopback), and can read / delete every model or drive the bundle-import
 * endpoint. The opt-in `UNSPA_ALLOWED_ORIGIN` / `UNSPA_AUTH_TOKEN` checks are
 * off by default, so nothing stops this on a fresh install.
 *
 * The fix is the same one Vite, webpack-dev-server, etc. ship: validate the
 * `Host` header. A rebinding attacker cannot forge `Host: localhost` — the
 * browser always sends the *page's* hostname (`evil.example`). So we accept a
 * request only when its Host is a loopback host (or one the operator has
 * explicitly allow-listed). We pair it with an `Origin` check on state-changing
 * methods to close the classic "simple POST" CSRF (e.g. a cross-site
 * `fetch('http://localhost:3000/api/system/hub-directory', {method:'POST'})`
 * that needs no preflight).
 *
 * Scope: this only activates when the server is bound to a concrete
 * (non-wildcard) host — which is the default `127.0.0.1` install. When an
 * operator opts into the LAN-share tier with `--host 0.0.0.0`, the legitimate
 * host is unknowable and the token/origin allowlist becomes the intended gate,
 * so this guard steps aside. Server-to-server callers (curl, the MCP
 * `notifySyncReload`) send no `Origin` and a loopback `Host`, so they pass.
 */

const WILDCARD_BINDS = new Set(['0.0.0.0', '::', '']);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const bindHost = (): string => (process.env.HOST ?? '127.0.0.1').trim().toLowerCase();

/**
 * The guard is live for every concrete-host bind (the default loopback
 * install). A wildcard bind (`0.0.0.0` / `::`) is the operator explicitly
 * exposing the dashboard on the LAN, where the auth token is the gate — there
 * is no single legitimate Host to pin, so we don't enforce one.
 */
export const isLocalGuardEnabled = (): boolean => !WILDCARD_BINDS.has(bindHost());

/** Extract the bare hostname from a `Host`/authority string, sans port and IPv6 brackets. */
const hostnameOf = (authority: string | null | undefined): string | null => {
  if (!authority) return null;
  const raw = authority.trim().toLowerCase();
  if (raw.length === 0) return null;
  // IPv6 literal, e.g. "[::1]:3000" → "::1".
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']');
    return end > 0 ? raw.slice(1, end) : null;
  }
  const colon = raw.indexOf(':');
  return colon >= 0 ? raw.slice(0, colon) : raw;
};

const isLoopbackHostname = (hostname: string): boolean =>
  LOOPBACK_HOSTS.has(hostname) || /^127(?:\.\d{1,3}){3}$/.test(hostname);

/** Hosts the operator allow-listed on top of loopback (LAN IP, custom hostname). */
const configuredHosts = (): ReadonlySet<string> => {
  const set = new Set<string>();
  for (const part of (process.env.UNSPA_ALLOWED_HOSTS ?? '').split(',')) {
    const h = hostnameOf(part);
    if (h) set.add(h);
  }
  // The configured CSRF origin's host is, by definition, a legitimate host.
  const origin = (process.env.UNSPA_ALLOWED_ORIGIN ?? '').trim();
  if (origin) {
    try {
      set.add(new URL(origin).hostname.toLowerCase());
    } catch {
      // Malformed origin env — ignore; the operator's typo shouldn't widen access.
    }
  }
  // A concrete (non-loopback, non-wildcard) bind host is legitimate too.
  const bind = bindHost();
  if (bind && !WILDCARD_BINDS.has(bind) && !isLoopbackHostname(bind)) set.add(bind);
  return set;
};

const isAllowedHostname = (hostname: string | null): boolean => {
  if (!hostname) return false;
  if (isLoopbackHostname(hostname)) return true;
  return configuredHosts().has(hostname);
};

/**
 * Validate a request's `Host` header against the loopback allowlist. Returns
 * true when the guard is disabled (wildcard bind) so callers needn't branch.
 */
export const checkLocalHost = (request: Request): boolean => {
  if (!isLocalGuardEnabled()) return true;
  return isAllowedHostname(hostnameOf(request.headers.get('host')));
};

/**
 * On state-changing methods, reject a cross-site `Origin`. A missing Origin
 * (curl / server-to-server) passes — the browser is the only client that
 * attaches one, and the browser is the only vector for the CSRF this closes.
 */
export const checkLocalOrigin = (request: Request): boolean => {
  if (!isLocalGuardEnabled()) return true;
  if (!MUTATING_METHODS.has(request.method.toUpperCase())) return true;
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    return isAllowedHostname(new URL(origin).hostname.toLowerCase());
  } catch {
    return false;
  }
};

/**
 * Raw-header variant for the WebSocket upgrade path, which works with a
 * `node:http` IncomingMessage rather than a fetch `Request`. Validates both the
 * Host and (when present) the Origin, since a Yjs socket can drive writes.
 */
export const checkLocalUpgrade = (
  host: string | undefined,
  origin: string | undefined
): boolean => {
  if (!isLocalGuardEnabled()) return true;
  if (!isAllowedHostname(hostnameOf(host))) return false;
  if (!origin) return true;
  try {
    return isAllowedHostname(new URL(origin).hostname.toLowerCase());
  } catch {
    return false;
  }
};
