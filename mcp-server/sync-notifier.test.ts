import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_DASHBOARD_PORT } from '../src/lib/server/sync/dashboardEndpoint';

/**
 * The notifier carries module-level state (sticky URL, failure cooldown), so
 * each test re-imports a fresh copy via `vi.resetModules()` and stubs the
 * global `fetch`. We assert on the request URLs the notifier chose, not on a
 * live server. The rendezvous file is pointed at an isolated temp path so the
 * probing tests are deterministic regardless of any real dashboard on the box.
 */

const RELOAD = '/api/sync/reload';
const D4 = `http://127.0.0.1:${DEFAULT_DASHBOARD_PORT}`; // uncommon default (IPv4)
const D6 = `http://[::1]:${DEFAULT_DASHBOARD_PORT}`; // uncommon default (IPv6)
const PROD = 'http://127.0.0.1:3000'; // legacy prod
const DEV6 = 'http://[::1]:8173'; // legacy dev (IPv6)

const urlOf = (call: unknown[]): string => String(call[0]);

let tmpDir: string;
let endpointFile: string;

const loadFresh = async () => {
  vi.resetModules();
  return import('./sync-notifier');
};

beforeEach(() => {
  delete process.env.UNSPA_SYNC_URL;
  delete process.env.UNSPA_AUTH_TOKEN;
  tmpDir = mkdtempSync(join(tmpdir(), 'unspa-sync-'));
  endpointFile = join(tmpDir, '.dashboard.json');
  // Isolated (initially missing) rendezvous file: probing tests behave the same
  // whether or not a real dashboard has published one on this machine.
  process.env.UNSPA_DASHBOARD_ENDPOINT_FILE = endpointFile;
  // Silence the one-shot stderr failure log so test output stays clean.
  vi.spyOn(process.stderr, 'write').mockReturnValue(true);
});

afterEach(() => {
  delete process.env.UNSPA_DASHBOARD_ENDPOINT_FILE;
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('notifySyncReload discovery', () => {
  it('prefers the URL the dashboard published to the rendezvous file', async () => {
    const PUB = 'http://127.0.0.1:55550';
    writeFileSync(endpointFile, JSON.stringify({ url: PUB, pid: 1, boundAt: 'x' }));
    const fetchMock = vi.fn(async (url: string) =>
      url.startsWith(PUB) ? ({ ok: true } as Response) : Promise.reject(new Error('nope'))
    );
    vi.stubGlobal('fetch', fetchMock);

    const { notifySyncReload } = await loadFresh();
    await notifySyncReload('project', 'abc', { name: 'Demo', op: 'save' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(urlOf(fetchMock.mock.calls[0])).toBe(`${PUB}${RELOAD}`);
  });

  it('probes the uncommon default and reaches an IPv6 dev bind', async () => {
    // No published file; the IPv4 default refuses, the IPv6 default answers
    // (how a `localhost`-bound Vite presents on Windows / Node 20+).
    const fetchMock = vi.fn(async (url: string) =>
      url.startsWith(D6) ? ({ ok: true } as Response) : Promise.reject(new Error('ECONNREFUSED'))
    );
    vi.stubGlobal('fetch', fetchMock);

    const { notifySyncReload } = await loadFresh();
    await notifySyncReload('project', 'abc');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(urlOf(fetchMock.mock.calls[0])).toBe(`${D4}${RELOAD}`);
    expect(urlOf(fetchMock.mock.calls[1])).toBe(`${D6}${RELOAD}`);
  });

  it('still reaches an older dashboard on the legacy prod port', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.startsWith(PROD) ? ({ ok: true } as Response) : Promise.reject(new Error('ECONNREFUSED'))
    );
    vi.stubGlobal('fetch', fetchMock);

    const { notifySyncReload } = await loadFresh();
    await notifySyncReload('project', 'abc');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(urlOf(fetchMock.mock.calls[0])).toBe(`${D4}${RELOAD}`);
    expect(urlOf(fetchMock.mock.calls[1])).toBe(`${D6}${RELOAD}`);
    expect(urlOf(fetchMock.mock.calls[2])).toBe(`${PROD}${RELOAD}`);
  });

  it('sticks to the last-known-good URL on subsequent notifies', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.startsWith(DEV6) ? ({ ok: true } as Response) : Promise.reject(new Error('ECONNREFUSED'))
    );
    vi.stubGlobal('fetch', fetchMock);

    const { notifySyncReload } = await loadFresh();
    await notifySyncReload('feature', 'one'); // discovers DEV6 after the earlier candidates fail
    fetchMock.mockClear();
    await notifySyncReload('feature', 'two'); // should go straight to DEV6

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(urlOf(fetchMock.mock.calls[0])).toBe(`${DEV6}${RELOAD}`);
  });

  it('uses only the explicit loopback override and skips probing', async () => {
    process.env.UNSPA_SYNC_URL = 'http://localhost:4321/';
    // Even with a published file present, an explicit pin wins outright.
    writeFileSync(
      endpointFile,
      JSON.stringify({ url: 'http://127.0.0.1:9', pid: 1, boundAt: 'x' })
    );
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
    expect(fetchMock).toHaveBeenCalledTimes(5);

    fetchMock.mockClear();
    await notifySyncReload('project', 'abc'); // within cooldown → skipped
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
