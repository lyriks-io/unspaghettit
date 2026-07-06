import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The notifier carries module-level state (sticky URL, failure cooldown), so
 * each test re-imports a fresh copy via `vi.resetModules()` and stubs the
 * global `fetch`. We assert on the request URLs the notifier chose, not on a
 * live server.
 */

const RELOAD = '/api/sync/reload';
const PROD = 'http://127.0.0.1:3000';
const DEV6 = 'http://[::1]:8173';
const DEV4 = 'http://127.0.0.1:8173';

const urlOf = (call: unknown[]): string => String(call[0]);

const loadFresh = async () => {
  vi.resetModules();
  return import('./sync-notifier');
};

beforeEach(() => {
  delete process.env.UNSPA_SYNC_URL;
  delete process.env.UNSPA_AUTH_TOKEN;
  // Silence the one-shot stderr failure log so test output stays clean.
  vi.spyOn(process.stderr, 'write').mockReturnValue(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('notifySyncReload port fallback', () => {
  it('reaches an IPv6-only Vite dev server (the npm run dev / Windows case)', async () => {
    // Production is down and only [::1]:8173 answers — exactly how
    // `localhost`-bound Vite presents on Windows (Node 20+ resolves
    // localhost to ::1 first, so Vite binds the IPv6 loopback).
    const fetchMock = vi.fn(async (url: string) =>
      url.startsWith(DEV6)
        ? ({ ok: true } as Response)
        : Promise.reject(new Error('ECONNREFUSED'))
    );
    vi.stubGlobal('fetch', fetchMock);

    const { notifySyncReload } = await loadFresh();
    await notifySyncReload('project', 'abc', { name: 'Demo', op: 'save' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(urlOf(fetchMock.mock.calls[0])).toBe(`${PROD}${RELOAD}`);
    expect(urlOf(fetchMock.mock.calls[1])).toBe(`${DEV6}${RELOAD}`);
  });

  it('falls through to the IPv4 dev port when the IPv6 bind refuses', async () => {
    // A dev server started with an explicit IPv4 host (vite --host 127.0.0.1)
    // refuses the ::1 probe; the IPv4 literal on the same port must catch it.
    const fetchMock = vi.fn(async (url: string) =>
      url.startsWith(DEV4)
        ? ({ ok: true } as Response)
        : Promise.reject(new Error('ECONNREFUSED'))
    );
    vi.stubGlobal('fetch', fetchMock);

    const { notifySyncReload } = await loadFresh();
    await notifySyncReload('project', 'abc');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(urlOf(fetchMock.mock.calls[0])).toBe(`${PROD}${RELOAD}`);
    expect(urlOf(fetchMock.mock.calls[1])).toBe(`${DEV6}${RELOAD}`);
    expect(urlOf(fetchMock.mock.calls[2])).toBe(`${DEV4}${RELOAD}`);
  });

  it('sticks to the last-known-good URL on subsequent notifies', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.startsWith(PROD)
        ? Promise.reject(new Error('ECONNREFUSED'))
        : ({ ok: true } as Response)
    );
    vi.stubGlobal('fetch', fetchMock);

    const { notifySyncReload } = await loadFresh();
    await notifySyncReload('feature', 'one'); // discovers :8173 (2 calls)
    fetchMock.mockClear();
    await notifySyncReload('feature', 'two'); // should go straight to :8173

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(urlOf(fetchMock.mock.calls[0])).toBe(`${DEV6}${RELOAD}`);
  });

  it('uses only the explicit loopback override and skips probing', async () => {
    process.env.UNSPA_SYNC_URL = 'http://localhost:4321/';
    const fetchMock = vi.fn(async () => ({ ok: true }) as Response);
    vi.stubGlobal('fetch', fetchMock);

    const { notifySyncReload } = await loadFresh();
    await notifySyncReload('project', 'abc');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(urlOf(fetchMock.mock.calls[0])).toBe(`http://localhost:4321${RELOAD}`);
  });

  it('attaches a bearer header when UNSPA_AUTH_TOKEN is set', async () => {
    process.env.UNSPA_SYNC_URL = PROD;
    process.env.UNSPA_AUTH_TOKEN = 'secret';
    const fetchMock = vi.fn(async () => ({ ok: true }) as Response);
    vi.stubGlobal('fetch', fetchMock);

    const { notifySyncReload } = await loadFresh();
    await notifySyncReload('project', 'abc');

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret');
  });

  it('backs off after every candidate fails, skipping the next notify', async () => {
    const fetchMock = vi.fn(async () => Promise.reject(new Error('down')));
    vi.stubGlobal('fetch', fetchMock);

    const { notifySyncReload } = await loadFresh();
    await notifySyncReload('project', 'abc'); // tries all candidates, all fail
    expect(fetchMock).toHaveBeenCalledTimes(3);

    fetchMock.mockClear();
    await notifySyncReload('project', 'abc'); // within cooldown → skipped
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
