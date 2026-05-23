/**
 * Optional shared-token auth for the dashboard's REST + WebSocket
 * surface, plus an Origin allowlist that complements it.
 *
 * Trust model (local-first by default):
 *   - No env var set → no auth, no origin check. This is the right
 *     stance for the default `unspa dashboard` install (loopback bind,
 *     single human). Forcing auth here would be friction with zero
 *     payoff.
 *   - `UNSPA_AUTH_TOKEN` set → every API request and every WebSocket
 *     upgrade must carry the token. REST honors `Authorization: Bearer
 *     <token>`; the WebSocket carries it as a `?token=` query because
 *     browsers can't set headers on WS upgrades. Server-to-server
 *     callers (the MCP `notifySyncReload`) use the header.
 *   - `UNSPA_ALLOWED_ORIGIN` set → cross-site browser requests are
 *     rejected. Covers the "malicious page in your other tab fetches
 *     localhost:3000/api/projects from your logged-in browser" CSRF
 *     class. curl / server-to-server has no Origin header and passes
 *     through (the threat model is browser-mediated, not arbitrary
 *     HTTP).
 *
 * One env var, one check function per surface. No accounts, no roles,
 * no session store. The aim is "an enterprise IT person can install
 * this on a VLAN without a heart attack", not full enterprise IAM —
 * which is a separate tier on the roadmap.
 *
 * Constant-time comparison on the token check resists timing leaks
 * even though the realistic attack surface is small (loopback or LAN).
 */

const tokenEnv = (): string | undefined => {
  const raw = process.env.UNSPA_AUTH_TOKEN;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const originEnv = (): string | undefined => {
  const raw = process.env.UNSPA_ALLOWED_ORIGIN;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim().replace(/\/$/, '');
  return trimmed.length > 0 ? trimmed : undefined;
};

export const isAuthEnabled = (): boolean => tokenEnv() !== undefined;
export const isOriginCheckEnabled = (): boolean => originEnv() !== undefined;

/**
 * Length-independent constant-time compare. `crypto.timingSafeEqual`
 * requires equal-length buffers and an early `===` length check would
 * itself leak length; this normalises both inputs to the longer of the
 * two before comparing.
 */
const constantTimeEqual = (a: string, b: string): boolean => {
  const len = Math.max(a.length, b.length);
  let mismatch = a.length === b.length ? 0 : 1;
  for (let i = 0; i < len; i += 1) {
    const ai = i < a.length ? a.charCodeAt(i) : 0;
    const bi = i < b.length ? b.charCodeAt(i) : 0;
    mismatch |= ai ^ bi;
  }
  return mismatch === 0;
};

const extractBearerToken = (headers: Headers): string | null => {
  const raw = headers.get('authorization');
  if (!raw) return null;
  const match = /^Bearer\s+(.+)$/i.exec(raw);
  return match ? match[1]!.trim() : null;
};

/**
 * Validate a Request's bearer token against UNSPA_AUTH_TOKEN. Returns
 * true when auth is disabled (env unset) so callers can wrap any
 * request without branching on `isAuthEnabled`.
 */
export const checkBearerAuth = (request: Request): boolean => {
  const expected = tokenEnv();
  if (expected === undefined) return true;
  const provided = extractBearerToken(request.headers);
  if (provided === null) return false;
  return constantTimeEqual(provided, expected);
};

/**
 * Validate a token carried as `?token=...` on a URL. Used by the
 * WebSocket upgrade path (browsers can't set headers on WS) and by SSE
 * (EventSource can't set headers either).
 */
export const checkQueryAuth = (url: URL | string): boolean => {
  const expected = tokenEnv();
  if (expected === undefined) return true;
  const u = typeof url === 'string' ? new URL(url, 'http://x') : url;
  const provided = u.searchParams.get('token');
  if (provided === null) return false;
  return constantTimeEqual(provided, expected);
};

/**
 * Accepts either header OR query — the inclusive OR variant for
 * endpoints that need to serve both browsers (via header) and
 * EventSource (via query).
 */
export const checkRequestAuth = (request: Request, url?: URL): boolean => {
  if (!isAuthEnabled()) return true;
  if (checkBearerAuth(request)) return true;
  if (url && checkQueryAuth(url)) return true;
  return false;
};

/**
 * Origin allowlist check. Returns true when:
 *   - the check is disabled (env unset), OR
 *   - the request has no Origin header (server-to-server callers like
 *     curl / the MCP notify don't send Origin), OR
 *   - the Origin matches the configured allowlist.
 * Callers should pair this with auth: a malicious server-to-server
 * caller would skip the origin check, which is fine because they're
 * still gated by the token.
 */
export const checkOrigin = (request: Request): boolean => {
  const expected = originEnv();
  if (expected === undefined) return true;
  const origin = request.headers.get('origin');
  if (!origin) return true;
  return origin.replace(/\/$/, '') === expected;
};

/**
 * One-line status the dashboard CLI banner uses on startup so admins
 * can confirm the configured auth posture at a glance.
 */
export const authStatusBanner = (): string => {
  const auth = isAuthEnabled() ? 'TOKEN' : 'OFF';
  const origin = isOriginCheckEnabled() ? originEnv()! : 'any';
  return `auth=${auth} origin=${origin}`;
};
