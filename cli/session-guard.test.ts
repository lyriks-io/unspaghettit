import { createHmac } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';

import { createSessionGuard, isValidSessionToken } from './session-guard';

const b64url = (input: Buffer | string): string =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const sign = (payload: object, secret: string): string => {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest();
  return `${header}.${body}.${b64url(sig)}`;
};

const SECRET = 'a-host-signing-secret-long-enough';

const request = (cookie?: string): IncomingMessage =>
  ({ headers: cookie ? { cookie } : {} }) as unknown as IncomingMessage;

const response = (): ServerResponse & { body: string; headers: Record<string, string> } => {
  const res = {
    statusCode: 200,
    body: '',
    headers: {} as Record<string, string>,
    setHeader(k: string, v: string) {
      this.headers[k.toLowerCase()] = v;
    },
    end(chunk?: string) {
      this.body = chunk ?? '';
    }
  };
  return res as unknown as ServerResponse & { body: string; headers: Record<string, string> };
};

describe('isValidSessionToken', () => {
  it('accepts a token signed with the same secret', () => {
    expect(isValidSessionToken(sign({ sub: 'u1' }, SECRET), SECRET)).toBe(true);
  });

  it('rejects a token signed with a different secret', () => {
    expect(isValidSessionToken(sign({ sub: 'u1' }, 'someone-elses-secret'), SECRET)).toBe(false);
  });

  it('rejects a tampered payload', () => {
    // The whole point of verifying: editing claims must invalidate the token.
    const [h, , s] = sign({ sub: 'u1', role: 'viewer' }, SECRET).split('.');
    const forged = `${h}.${b64url(JSON.stringify({ sub: 'u1', role: 'admin' }))}.${s}`;
    expect(isValidSessionToken(forged, SECRET)).toBe(false);
  });

  it('rejects an expired token', () => {
    expect(isValidSessionToken(sign({ exp: Math.floor(Date.now() / 1000) - 60 }, SECRET), SECRET)).toBe(false);
  });

  it('accepts a token whose expiry is still ahead', () => {
    expect(isValidSessionToken(sign({ exp: Math.floor(Date.now() / 1000) + 600 }, SECRET), SECRET)).toBe(true);
  });

  it.each([null, '', 'not-a-jwt', 'a.b', 'a.b.c.d'])('rejects malformed input %j', (token) => {
    expect(isValidSessionToken(token as string | null, SECRET)).toBe(false);
  });
});

describe('createSessionGuard', () => {
  it('is inert without a secret, so standalone dashboards keep working', () => {
    const guard = createSessionGuard({});
    expect(guard.enabled).toBe(false);
    const res = response();
    expect(guard(request(), res)).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  it('refuses a request with no cookie once enabled', () => {
    const guard = createSessionGuard({ UNSPA_SESSION_SECRET: SECRET });
    const res = response();
    expect(guard(request(), res)).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it('admits a request carrying a valid session cookie', () => {
    const guard = createSessionGuard({ UNSPA_SESSION_SECRET: SECRET });
    const res = response();
    expect(guard(request(`lyriks_session=${sign({ sub: 'u1' }, SECRET)}`), res)).toBe(true);
  });

  it('finds its cookie among others', () => {
    const guard = createSessionGuard({ UNSPA_SESSION_SECRET: SECRET });
    const token = sign({ sub: 'u1' }, SECRET);
    const res = response();
    expect(guard(request(`theme=dark; lyriks_session=${token}; other=1`), res)).toBe(true);
  });

  it('does not confuse a cookie whose name merely ends the same', () => {
    const guard = createSessionGuard({ UNSPA_SESSION_SECRET: SECRET });
    const res = response();
    expect(guard(request(`not_lyriks_session=${sign({ sub: 'u1' }, SECRET)}`), res)).toBe(false);
  });

  it('honours a custom cookie name', () => {
    const guard = createSessionGuard({ UNSPA_SESSION_SECRET: SECRET, UNSPA_SESSION_COOKIE: 'app_sid' });
    const res = response();
    expect(guard(request(`app_sid=${sign({ sub: 'u1' }, SECRET)}`), res)).toBe(true);
  });

  it('points an unauthenticated visitor at the host login when told where it is', () => {
    const guard = createSessionGuard({
      UNSPA_SESSION_SECRET: SECRET,
      UNSPA_SESSION_LOGIN_URL: 'https://app.example.corp/login'
    });
    const res = response();
    guard(request(), res);
    expect(res.body).toContain('https://app.example.corp/login');
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
