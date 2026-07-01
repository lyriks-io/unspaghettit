import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  checkLocalHost,
  checkLocalOrigin,
  checkLocalUpgrade,
  isLocalGuardEnabled
} from './localGuard';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

const req = (init?: {
  host?: string;
  origin?: string;
  method?: string;
}): Request => {
  const headers: Record<string, string> = {};
  if (init?.host) headers.host = init.host;
  if (init?.origin) headers.origin = init.origin;
  return new Request('http://localhost/api/projects', {
    method: init?.method ?? 'GET',
    headers
  });
};

describe('localGuard (DNS-rebinding / CSRF)', () => {
  describe('default loopback bind (HOST unset)', () => {
    beforeEach(() => {
      delete process.env.HOST;
      delete process.env.UNSPA_ALLOWED_HOSTS;
      delete process.env.UNSPA_ALLOWED_ORIGIN;
    });

    it('is enabled', () => {
      expect(isLocalGuardEnabled()).toBe(true);
    });

    it('accepts the real dashboard Host (localhost / 127.0.0.1 / [::1])', () => {
      expect(checkLocalHost(req({ host: 'localhost:3000' }))).toBe(true);
      expect(checkLocalHost(req({ host: '127.0.0.1:3000' }))).toBe(true);
      expect(checkLocalHost(req({ host: '[::1]:3000' }))).toBe(true);
    });

    it('rejects a rebinding Host (attacker domain resolving to loopback)', () => {
      expect(checkLocalHost(req({ host: 'evil.example:3000' }))).toBe(false);
      expect(checkLocalHost(req({ host: 'my-internal-app.attacker.com' }))).toBe(false);
    });

    it('rejects a missing Host header', () => {
      expect(checkLocalHost(req())).toBe(false);
    });

    it('allows same-origin writes but blocks cross-site writes', () => {
      expect(
        checkLocalOrigin(req({ method: 'POST', origin: 'http://localhost:3000' }))
      ).toBe(true);
      expect(
        checkLocalOrigin(req({ method: 'POST', origin: 'http://evil.example' }))
      ).toBe(false);
    });

    it('lets server-to-server writes (no Origin) through', () => {
      expect(checkLocalOrigin(req({ method: 'POST' }))).toBe(true);
      expect(checkLocalOrigin(req({ method: 'DELETE' }))).toBe(true);
    });

    it('does not gate safe methods on Origin', () => {
      expect(checkLocalOrigin(req({ method: 'GET', origin: 'http://evil.example' }))).toBe(
        true
      );
    });

    it('WS upgrade: loopback Host passes, rebinding Host fails', () => {
      expect(checkLocalUpgrade('localhost:3000', 'http://localhost:3000')).toBe(true);
      expect(checkLocalUpgrade('evil.example:3000', 'http://evil.example')).toBe(false);
      expect(checkLocalUpgrade(undefined, undefined)).toBe(false);
    });
  });

  describe('operator allowlist (UNSPA_ALLOWED_HOSTS)', () => {
    beforeEach(() => {
      delete process.env.HOST;
      process.env.UNSPA_ALLOWED_HOSTS = 'unspa.local, 192.168.1.5';
    });

    it('accepts an explicitly allow-listed host', () => {
      expect(checkLocalHost(req({ host: 'unspa.local:3000' }))).toBe(true);
      expect(checkLocalHost(req({ host: '192.168.1.5:3000' }))).toBe(true);
    });

    it('still rejects everything else', () => {
      expect(checkLocalHost(req({ host: 'evil.example' }))).toBe(false);
    });
  });

  describe('wildcard LAN bind (--host 0.0.0.0)', () => {
    beforeEach(() => {
      process.env.HOST = '0.0.0.0';
    });

    it('self-disables so the token becomes the gate', () => {
      expect(isLocalGuardEnabled()).toBe(false);
      expect(checkLocalHost(req({ host: '192.168.1.5:3000' }))).toBe(true);
      expect(
        checkLocalOrigin(req({ method: 'POST', origin: 'http://192.168.1.5:3000' }))
      ).toBe(true);
      expect(checkLocalUpgrade('192.168.1.5:3000', 'http://192.168.1.5:3000')).toBe(true);
    });
  });

  describe('concrete LAN bind (--host 192.168.1.5)', () => {
    beforeEach(() => {
      process.env.HOST = '192.168.1.5';
      delete process.env.UNSPA_ALLOWED_HOSTS;
      delete process.env.UNSPA_ALLOWED_ORIGIN;
    });

    it('accepts the bind host and loopback, rejects strangers', () => {
      expect(checkLocalHost(req({ host: '192.168.1.5:3000' }))).toBe(true);
      expect(checkLocalHost(req({ host: 'localhost:3000' }))).toBe(true);
      expect(checkLocalHost(req({ host: 'evil.example' }))).toBe(false);
    });
  });
});
