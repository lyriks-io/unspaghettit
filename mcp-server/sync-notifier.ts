/**
 * Out-of-band sync hook. The MCP server is a stdio child process that talks
 * directly to the JSON snapshot files on disk; if a SvelteKit server is
 * also running on `UNSPA_SYNC_URL` it holds Y.Doc snapshots in memory and
 * broadcasts updates over a WebSocket to live editors. After we write to
 * disk we POST {kind,id} to /api/sync/reload so any open editor sees the
 * change without a refresh.
 *
 * Default is :3000, the port `unspa dashboard` (adapter-node production
 * build) listens on. Devs running `vite dev` (:5173) should set
 * `UNSPA_SYNC_URL=http://localhost:5173` in the MCP entry env so list
 * views auto-refresh during development too.
 *
 * Failures are swallowed: MCP must work even when no SvelteKit server is up.
 * A 300 ms timeout caps the cost when the server is unreachable.
 *
 * `UNSPA_SYNC_URL` is restricted to loopback hosts. The MCP server runs
 * with the developer's filesystem privileges, so a non-loopback override
 * would let a poisoned shell environment exfiltrate every spec change to
 * an arbitrary URL. Loopback-only keeps this a local IPC channel.
 */

const TIMEOUT_MS = 300;

export type SyncKind = 'feature' | 'project' | 'implementation-status';

// 127.0.0.1, not `localhost`. On Windows + Node 20+, `localhost` often
// resolves to `::1` (IPv6) first, but the dashboard binds to 127.0.0.1
// only (see cli/commands/dashboard.ts). The IPv6 attempt fails and the
// 300 ms timeout fires before Node falls back to IPv4 — every notify
// silently times out and the 5 s cooldown below skips the rest. Using
// the literal IPv4 the dashboard listens on avoids the whole DNS path.
const DEFAULT_SYNC_URL = 'http://127.0.0.1:3000';

const isLoopbackUrl = (raw: string): boolean => {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const host = u.hostname;
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '[::1]' ||
      host.startsWith('127.')
    );
  } catch {
    return false;
  }
};

let warnedOnce = false;

const baseUrl = (): string => {
  const override = process.env.UNSPA_SYNC_URL?.replace(/\/$/, '');
  if (!override) return DEFAULT_SYNC_URL;
  if (isLoopbackUrl(override)) return override;
  if (!warnedOnce) {
    warnedOnce = true;
    process.stderr.write(
      `[unspa-mcp] UNSPA_SYNC_URL must be a loopback URL (got ${override}). Falling back to ${DEFAULT_SYNC_URL}.\n`
    );
  }
  return DEFAULT_SYNC_URL;
};

let lastFailureAt = 0;
let failureLogged = false;
const COOLDOWN_MS = 5_000;

const logFailureOnce = (url: string, reason: string): void => {
  if (failureLogged) return;
  failureLogged = true;
  process.stderr.write(
    `[unspa-mcp] sync notify to ${url} failed (${reason}). Dashboard will need manual refresh until reachable. Set UNSPA_SYNC_URL in the MCP entry env if the dashboard is on a non-default port.\n`
  );
};

/**
 * Optional human-meaningful payload the dashboard uses to label toasts and
 * activity logs. `name` lets the toast say "MCP added feature Sync Check
 * Two" instead of just an opaque id. Stays optional so older callers and
 * deletes (where the entity is already gone) still work.
 */
export type NotifyExtras = {
  readonly name?: string;
  readonly op?: 'save' | 'delete';
};

export const notifySyncReload = async (
  kind: SyncKind,
  id: string,
  extras: NotifyExtras = {}
): Promise<void> => {
  // If the last attempt failed recently, skip. The server isn't running.
  if (Date.now() - lastFailureAt < COOLDOWN_MS) return;
  if (typeof fetch !== 'function') return;

  const url = `${baseUrl()}/api/sync/reload`;
  // When the dashboard is gated by UNSPA_AUTH_TOKEN, the MCP server is
  // a server-to-server caller and uses the header form. Configured via
  // the same env var name as the dashboard so a single shared secret
  // covers both sides — set it on both processes (in `.mcp.json#env`
  // and on the dashboard's shell) and they line up.
  const token = process.env.UNSPA_AUTH_TOKEN?.trim();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token && token.length > 0) headers.Authorization = `Bearer ${token}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ kind, id, ...extras }),
      signal: ctrl.signal
    });
    if (!res.ok) {
      lastFailureAt = Date.now();
      logFailureOnce(url, `HTTP ${res.status}`);
    }
  } catch (e) {
    lastFailureAt = Date.now();
    logFailureOnce(url, (e as Error).message);
  } finally {
    clearTimeout(timer);
  }
};
