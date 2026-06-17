/**
 * Out-of-band sync hook. The MCP server is a stdio child process that talks
 * directly to the JSON snapshot files on disk; if a SvelteKit server is
 * also running on `UNSPA_SYNC_URL` it holds Y.Doc snapshots in memory and
 * broadcasts updates over a WebSocket to live editors. After we write to
 * disk we POST {kind,id} to /api/sync/reload so any open editor sees the
 * change without a refresh.
 *
 * With no override we probe 127.0.0.1:3000 (the port `unspa dashboard` —
 * the adapter-node production build — listens on), then both the IPv4 and
 * IPv6 literals on :5173 (Vite dev binds `localhost`, which resolves to ::1
 * first on Windows/Node 20+). So both `unspa dashboard` and `npm run dev`
 * get live refresh + toasts with zero config. Set `UNSPA_SYNC_URL` to a
 * single loopback URL to pin a non-default port and skip the probe.
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
// Candidate dashboard base URLs to probe when no UNSPA_SYNC_URL is set, in
// order. Covers both ways a local dashboard runs:
//   - `unspa dashboard` (adapter-node prod build) binds 127.0.0.1:3000.
//   - `npm run dev` (Vite) binds `localhost` on :5173 — which on Windows /
//     Node 20+ resolves to ::1 (IPv6) first, so we probe BOTH the IPv4 and
//     IPv6 literals on the dev port (a server bound to one family refuses the
//     other). The prod server is IPv4-only, hence no ::1 variant there.
// Literal addresses (not the `localhost` name) so we never pay the
// resolve-wrong-family-then-time-out cost the name form incurs.
const DEFAULT_SYNC_URLS = [
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
  'http://[::1]:5173'
];

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

// Ordered list of dashboard base URLs to try for one notify. An explicit
// (loopback) UNSPA_SYNC_URL wins outright — the caller knows their port. With
// no override we probe the production port first, then the Vite dev port, so a
// single write reaches whichever dashboard is actually up without the user
// configuring anything. A non-loopback override is rejected (see module
// header) and falls back to probing both defaults.
const candidateUrls = (): readonly string[] => {
  const override = process.env.UNSPA_SYNC_URL?.replace(/\/$/, '');
  if (override) {
    if (isLoopbackUrl(override)) return [override];
    if (!warnedOnce) {
      warnedOnce = true;
      process.stderr.write(
        `[unspa-mcp] UNSPA_SYNC_URL must be a loopback URL (got ${override}). Probing ${DEFAULT_SYNC_URLS.join(', ')} instead.\n`
      );
    }
  }
  return DEFAULT_SYNC_URLS;
};

// Sticky last-known-good URL. Once a candidate answers we try it first on
// every later notify, so we never pay the dead-port timeout twice in a row.
let preferredUrl: string | null = null;

let lastFailureAt = 0;
let failureLogged = false;
const COOLDOWN_MS = 5_000;

const logFailureOnce = (urls: readonly string[]): void => {
  if (failureLogged) return;
  failureLogged = true;
  process.stderr.write(
    `[unspa-mcp] sync notify failed (tried ${urls.join(', ')}). Dashboard will need manual refresh until reachable. Set UNSPA_SYNC_URL in the MCP entry env if the dashboard is on a non-default port.\n`
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

/** POST one reload to a single base URL. Returns true on a 2xx, false on any
 *  HTTP error, network failure, or the per-attempt timeout. Never throws — the
 *  caller decides whether to fall through to the next candidate. */
const postReload = async (
  baseUrl: string,
  body: string,
  headers: Record<string, string>
): Promise<boolean> => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}/api/sync/reload`, {
      method: 'POST',
      headers,
      body,
      signal: ctrl.signal
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
};

export const notifySyncReload = async (
  kind: SyncKind,
  id: string,
  extras: NotifyExtras = {}
): Promise<void> => {
  // If the last full sweep failed recently, skip. No dashboard is reachable.
  if (Date.now() - lastFailureAt < COOLDOWN_MS) return;
  if (typeof fetch !== 'function') return;

  // When the dashboard is gated by UNSPA_AUTH_TOKEN, the MCP server is
  // a server-to-server caller and uses the header form. Configured via
  // the same env var name as the dashboard so a single shared secret
  // covers both sides — set it on both processes (in `.mcp.json#env`
  // and on the dashboard's shell) and they line up.
  const token = process.env.UNSPA_AUTH_TOKEN?.trim();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token && token.length > 0) headers.Authorization = `Bearer ${token}`;
  const body = JSON.stringify({ kind, id, ...extras });

  // Try the last-known-good URL first, then the rest. One running dashboard
  // is the norm, so the sticky hit means the steady state is a single POST.
  const candidates = candidateUrls();
  const ordered =
    preferredUrl && candidates.includes(preferredUrl)
      ? [preferredUrl, ...candidates.filter((u) => u !== preferredUrl)]
      : candidates;

  for (const url of ordered) {
    if (await postReload(url, body, headers)) {
      preferredUrl = url;
      failureLogged = false; // a fresh success re-arms the failure log
      return;
    }
  }

  // Every candidate failed — back off and log once until one answers again.
  lastFailureAt = Date.now();
  preferredUrl = null;
  logFailureOnce(ordered);
};
