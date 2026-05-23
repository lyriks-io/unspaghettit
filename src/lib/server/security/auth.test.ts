import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  checkBearerAuth,
  checkOrigin,
  checkQueryAuth,
  checkRequestAuth,
  isAuthEnabled,
  isOriginCheckEnabled
} from './auth';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

const makeReq = (init?: { headers?: Record<string, string>; url?: string }) =>
  new Request(init?.url ?? 'http://localhost/api/foo', { headers: init?.headers ?? {} });

describe('auth helper', () => {
  describe('when no env vars are set (default install)', () => {
    beforeEach(() => {
      delete process.env.UNSPA_AUTH_TOKEN;
      delete process.env.UNSPA_ALLOWED_ORIGIN;
    });

    it('reports both checks as disabled', () => {
      expect(isAuthEnabled()).toBe(false);
      expect(isOriginCheckEnabled()).toBe(false);
    });

    it('lets every request through regardless of headers', () => {
      expect(checkBearerAuth(makeReq())).toBe(true);
      expect(checkRequestAuth(makeReq())).toBe(true);
      expect(checkOrigin(makeReq({ headers: { origin: 'https://evil.example' } }))).toBe(true);
      expect(checkQueryAuth('http://localhost/api/sync/events')).toBe(true);
    });
  });

  describe('with UNSPA_AUTH_TOKEN set', () => {
    beforeEach(() => {
      process.env.UNSPA_AUTH_TOKEN = 'sekret-token';
      delete process.env.UNSPA_ALLOWED_ORIGIN;
    });

    it('isAuthEnabled flips on', () => {
      expect(isAuthEnabled()).toBe(true);
    });

    it('rejects missing bearer header', () => {
      expect(checkBearerAuth(makeReq())).toBe(false);
    });

    it('accepts matching bearer header', () => {
      expect(
        checkBearerAuth(makeReq({ headers: { authorization: 'Bearer sekret-token' } }))
      ).toBe(true);
    });

    it('rejects wrong bearer token', () => {
      expect(
        checkBearerAuth(makeReq({ headers: { authorization: 'Bearer wrong' } }))
      ).toBe(false);
    });

    it('is case-insensitive on the scheme but exact on the token', () => {
      expect(
        checkBearerAuth(makeReq({ headers: { authorization: 'bearer sekret-token' } }))
      ).toBe(true);
      expect(
        checkBearerAuth(makeReq({ headers: { authorization: 'Bearer Sekret-Token' } }))
      ).toBe(false);
    });

    it('checkQueryAuth accepts matching ?token=', () => {
      expect(checkQueryAuth('http://localhost/api/sync/events?token=sekret-token')).toBe(true);
    });

    it('checkQueryAuth rejects missing or wrong ?token=', () => {
      expect(checkQueryAuth('http://localhost/api/sync/events')).toBe(false);
      expect(checkQueryAuth('http://localhost/api/sync/events?token=other')).toBe(false);
    });

    it('checkRequestAuth accepts EITHER header or query', () => {
      const url = new URL('http://localhost/api/sync/events?token=sekret-token');
      expect(checkRequestAuth(makeReq(), url)).toBe(true);
      expect(
        checkRequestAuth(
          makeReq({ headers: { authorization: 'Bearer sekret-token' } })
        )
      ).toBe(true);
      expect(checkRequestAuth(makeReq())).toBe(false);
    });
  });

  describe('with UNSPA_ALLOWED_ORIGIN set', () => {
    beforeEach(() => {
      delete process.env.UNSPA_AUTH_TOKEN;
      process.env.UNSPA_ALLOWED_ORIGIN = 'http://192.168.1.10:3000';
    });

    it('isOriginCheckEnabled flips on', () => {
      expect(isOriginCheckEnabled()).toBe(true);
    });

    it('allows requests with no Origin (server-to-server / curl)', () => {
      expect(checkOrigin(makeReq())).toBe(true);
    });

    it('allows matching Origin', () => {
      expect(
        checkOrigin(makeReq({ headers: { origin: 'http://192.168.1.10:3000' } }))
      ).toBe(true);
    });

    it('tolerates a trailing slash on either side', () => {
      process.env.UNSPA_ALLOWED_ORIGIN = 'http://192.168.1.10:3000/';
      expect(
        checkOrigin(makeReq({ headers: { origin: 'http://192.168.1.10:3000' } }))
      ).toBe(true);
    });

    it('rejects a mismatching Origin (CSRF defense)', () => {
      expect(
        checkOrigin(makeReq({ headers: { origin: 'https://malicious.example' } }))
      ).toBe(false);
    });
  });
});
