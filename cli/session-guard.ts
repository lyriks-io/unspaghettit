import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

// Optional session gate for `unspa dashboard`.
//
// The dashboard has no authentication of its own: whoever reaches the port can
// read — and edit — every behavior model it serves. Standalone that is fine, it
// is a local developer tool bound to loopback. Embedded in a product that sells
// authenticated, licensed access it is not: the dashboard runs on its own origin
// and so escapes the host application's login entirely.
//
// This gate is therefore OFF unless UNSPA_SESSION_SECRET is set, which keeps
// `unspa dashboard` unchanged for every standalone user. When the host sets it,
// a request must carry a session cookie signed with that same secret.
//
// HS256 is verified here with node:crypto rather than a JWT library on purpose:
// the embedding product ships air-gapped and treats every added runtime
// dependency as a liability, and verification is ~20 lines.

const DEFAULT_COOKIE = 'lyriks_session';

const b64urlToBuffer = (value: string): Buffer =>
  Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/** Reads one cookie from a raw Cookie header. Returns null when absent. */
const readCookie = (header: string | undefined, name: string): string | null => {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
};

/**
 * True when `token` is a valid, unexpired HS256 JWT signed with `secret`.
 * Deliberately checks nothing else: the host application owns identity and
 * authorization, this only answers "did the host issue this, and is it current".
 */
export const isValidSessionToken = (token: string | null, secret: string): boolean => {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [header, payload, signature] = parts;

  let expected: Buffer;
  try {
    expected = createHmac('sha256', secret).update(`${header}.${payload}`).digest();
  } catch {
    return false;
  }
  let actual: Buffer;
  try {
    actual = b64urlToBuffer(signature);
  } catch {
    return false;
  }
  // Length check first: timingSafeEqual throws on a length mismatch.
  if (actual.length !== expected.length) return false;
  if (!timingSafeEqual(actual, expected)) return false;

  try {
    const claims = JSON.parse(b64urlToBuffer(payload).toString('utf8')) as { exp?: number };
    // `exp` is optional in the spec; when present it is authoritative. A token
    // without one stays valid, which matches the host issuing session cookies
    // whose lifetime is carried by the cookie itself.
    if (typeof claims.exp === 'number' && claims.exp * 1000 <= Date.now()) return false;
  } catch {
    return false;
  }
  return true;
};

export interface SessionGuard {
  /** True when the request may proceed. When false, a response has been sent. */
  (req: IncomingMessage, res: ServerResponse): boolean;
  readonly enabled: boolean;
}

/**
 * Builds the gate from the environment.
 *
 *   UNSPA_SESSION_SECRET     enables it; must equal the host's JWT signing secret
 *   UNSPA_SESSION_COOKIE     cookie name (default `lyriks_session`)
 *   UNSPA_SESSION_LOGIN_URL  where to send an unauthenticated visitor
 */
export const createSessionGuard = (env: NodeJS.ProcessEnv = process.env): SessionGuard => {
  const secret = (env.UNSPA_SESSION_SECRET ?? '').trim();
  const cookieName = (env.UNSPA_SESSION_COOKIE ?? '').trim() || DEFAULT_COOKIE;
  const loginUrl = (env.UNSPA_SESSION_LOGIN_URL ?? '').trim();

  const guard = ((req: IncomingMessage, res: ServerResponse): boolean => {
    if (!secret) return true;
    if (isValidSessionToken(readCookie(req.headers.cookie, cookieName), secret)) return true;

    // 401 rather than a redirect: the dashboard is a single-page app whose
    // fetches would silently follow a redirect and render the login page inside
    // themselves. A status the caller cannot misread is worth more here.
    res.statusCode = 401;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(
      loginUrl
        ? `Not signed in. Sign in to the application first: ${loginUrl}\n`
        : 'Not signed in. Sign in to the application that hosts this dashboard.\n'
    );
    return false;
  }) as SessionGuard;

  return Object.defineProperty(guard, 'enabled', { value: secret.length > 0 }) as SessionGuard;
};
