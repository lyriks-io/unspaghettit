import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * The dashboard and the MCP sync-notifier must agree on ONE loopback URL so the
 * notifier can POST /api/sync/reload and push live edits to open editors without
 * a page refresh. Historically both sides HARDCODED the port (prod 3000, dev
 * 8173) and drifted apart the instant either advanced to a free port — e.g. when
 * a WSL2/Docker relay squats 3000 the dashboard silently lands on 3005 and every
 * notify misses, so edits only appear after a manual restart.
 *
 * Instead of guessing, the running dashboard PUBLISHES the URL it actually bound
 * to a small rendezvous file and the notifier reads it first. That makes live
 * sync survive any port choice (fixed, advanced, or OS-assigned) with zero
 * config. Port probing (below) remains only as a fallback for an older dashboard
 * that predates this file, or when the file cannot be written.
 */

/**
 * Uncommon default so the dashboard does not fight the world's :3000 / :5173 /
 * :8080. Shared by the prod server, the Vite dev plugin and the notifier's
 * fallback list from this single constant, so they can never diverge again.
 * Both dev and prod START here and advance to the next free port if it is taken;
 * the published URL then carries the real port, so live sync still finds it.
 */
export const DEFAULT_DASHBOARD_PORT = 43171;

/**
 * Rendezvous file at the hub root, found by os.homedir() alone so the notifier
 * needs no knowledge of which snapshots folder is in play. Override with
 * UNSPA_DASHBOARD_ENDPOINT_FILE (tests, or a non-default hub layout).
 */
export const dashboardEndpointFile = (): string => {
  const override = process.env.UNSPA_DASHBOARD_ENDPOINT_FILE?.trim();
  if (override && override.length > 0) return override;
  return join(homedir(), '.unspa-hub', '.dashboard.json');
};

export type DashboardEndpoint = {
  readonly url: string;
  readonly pid: number;
  readonly boundAt: string;
};

const isLoopbackHttpUrl = (raw: string): boolean => {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    // URL.hostname serialises an IPv6 host bracketed ("[::1]"); strip them so
    // the loopback comparison works whether or not the brackets are present.
    const h = u.hostname.replace(/^\[|\]$/g, '');
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.startsWith('127.');
  } catch {
    return false;
  }
};

/**
 * The loopback URL a listening server is reachable at, from its `address()`.
 * A wildcard bind (0.0.0.0 / ::) is reachable on the matching loopback literal;
 * an explicit loopback host is used as-is; a bare IPv6 literal is bracketed for
 * the URL. Returns null for a non-loopback bind (a LAN-only host is not a local
 * IPC channel, and the notifier only POSTs to loopback anyway).
 */
export const loopbackUrlFor = (address: string | AddressInfo | null): string | null => {
  if (!address || typeof address === 'string') return null;
  const { address: host, family, port } = address;
  let h: string;
  if (host === '0.0.0.0' || host === '') h = '127.0.0.1';
  else if (host === '::' || host === '::0' || host === '::1') h = '[::1]';
  else if (family === 'IPv6') h = `[${host}]`;
  else h = host;
  const url = `http://${h}:${port}`;
  return isLoopbackHttpUrl(url) ? url : null;
};

/**
 * Best-effort publish of the URL the dashboard actually bound. Never throws —
 * live sync simply degrades to the notifier's port probing if the write fails.
 */
export const publishDashboardEndpoint = (url: string): void => {
  try {
    const file = dashboardEndpointFile();
    mkdirSync(dirname(file), { recursive: true });
    const payload: DashboardEndpoint = {
      url,
      pid: process.pid,
      boundAt: new Date().toISOString()
    };
    writeFileSync(file, JSON.stringify(payload), 'utf8');
  } catch {
    /* ignore — the notifier still has its port-probe fallback */
  }
};

/**
 * Remove the rendezvous file, but only when it still points at THIS process, so
 * a fast dashboard restart that already re-published on a new port is not undone
 * by the old instance's shutdown handler.
 */
export const clearDashboardEndpoint = (): void => {
  try {
    const file = dashboardEndpointFile();
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<DashboardEndpoint>;
    if (parsed.pid !== process.pid) return;
    rmSync(file, { force: true });
  } catch {
    /* ignore */
  }
};

/** The loopback URL the running dashboard published, or null if absent/invalid. */
export const readDashboardEndpoint = (): string | null => {
  try {
    const parsed = JSON.parse(
      readFileSync(dashboardEndpointFile(), 'utf8')
    ) as Partial<DashboardEndpoint>;
    if (typeof parsed.url !== 'string') return null;
    const url = parsed.url.replace(/\/$/, '');
    return isLoopbackHttpUrl(url) ? url : null;
  } catch {
    return null;
  }
};
