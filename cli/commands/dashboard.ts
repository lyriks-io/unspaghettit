import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from '../util/log';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_HOST = '127.0.0.1';

// Hosts that mean "bind every interface", i.e. anyone on the LAN can reach
// the dashboard's unauthenticated REST + Yjs WebSocket surface. We default
// to loopback and only let the user override on purpose, with a loud
// warning so the exposure can't go unnoticed.
const PUBLIC_BIND_HOSTS = new Set(['0.0.0.0', '::', '*']);

const isLoopback = (host: string): boolean =>
  host === '127.0.0.1' ||
  host === 'localhost' ||
  host === '::1' ||
  host.startsWith('127.');

/**
 * Boot the bundled SvelteKit production build via our custom server, which
 * wraps adapter-node's `handler` and adds the Yjs WebSocket upgrade listener
 * that the default `build/index.js` lacks. The dashboard discovers the
 * snapshots folder by walking up from process.cwd() and otherwise falling back
 * to the shared hub (`~/.unspa-hub/unspa`), so the child's CWD must stay set to
 * wherever the user ran the CLI from. An explicit `--snapshots` overrides both.
 *
 * Defaults to binding 127.0.0.1: the REST sync routes and Yjs WebSocket
 * have no auth, no CSRF, no Origin allowlist, so a 0.0.0.0 bind would let
 * anyone on the LAN mutate every feature. Users who want LAN exposure pass
 * `--host 0.0.0.0` explicitly and we print a loud warning.
 *
 * Returns the child's exit code; throws when the build artefact is missing
 * (e.g. shipped clone without `npm run build`) so the user gets a clear hint.
 */
export const runDashboardCommand = async (
  args: { readonly port?: number; readonly host?: string; readonly snapshots?: string }
): Promise<number> => {
  const repoRoot = resolve(__dirname, '..', '..');
  // build/handler.js (adapter-node's exported handler) is what the custom
  // server in cli/dashboard-server.cjs wraps. We check for it here so we
  // can give a clear "run npm run build" hint before spawning.
  const buildEntry = resolve(repoRoot, 'build', 'handler.js');
  if (!existsSync(buildEntry)) {
    log.err(`Dashboard build missing at ${buildEntry}`);
    log.dim(`Run \`npm run build\` inside the Unspaghettit repo (${repoRoot}) and retry.`);
    return 1;
  }

  // ESM shim. dashboard-server.ts loads Yjs and must do so as ESM so it
  // resolves to the same yjs/dist/yjs.mjs that the bundled handler.js
  // imports. The legacy .cjs shim is left in place for users on
  // older `unspa` installs, but new spawns target the .mjs.
  const serverShim = resolve(repoRoot, 'cli', 'dashboard-server.mjs');

  const host = args.host ?? DEFAULT_HOST;
  // Token gate posture banner. Empty UNSPA_AUTH_TOKEN = LAN-share tier is
  // off; the dashboard accepts every request. Non-empty = the shared
  // token is required on every /api/* + WebSocket; admins can confirm
  // the posture at a glance instead of guessing from the env.
  const hasToken = (process.env.UNSPA_AUTH_TOKEN ?? '').trim().length > 0;
  const hasOrigin = (process.env.UNSPA_ALLOWED_ORIGIN ?? '').trim().length > 0;
  if (PUBLIC_BIND_HOSTS.has(host)) {
    if (!hasToken) {
      log.warn(
        `Dashboard is binding ${host}: REST sync + Yjs WebSocket are UNAUTHENTICATED.`
      );
      log.warn(
        'Anyone on the network can read or mutate every feature. Set UNSPA_AUTH_TOKEN=<secret> to gate access, or use --host 127.0.0.1 if only you should reach it.'
      );
    } else {
      log.warn(
        `Dashboard is binding ${host} with token auth on. Share the token over a trusted channel — anyone with it has full read/write.`
      );
    }
  } else if (!isLoopback(host)) {
    log.warn(
      `Dashboard is binding ${host}: ${hasToken ? 'token auth on' : 'no auth on REST sync + Yjs WebSocket'}. Make sure this interface is trusted.`
    );
  }
  log.dim(`Security: auth=${hasToken ? 'TOKEN' : 'OFF'} origin=${hasOrigin ? process.env.UNSPA_ALLOWED_ORIGIN : 'any'}`);
  if (hasToken) {
    log.dim(
      'MCP servers that POST /api/sync/reload need the same UNSPA_AUTH_TOKEN in their env (e.g. .mcp.json#env).'
    );
  }

  const env: NodeJS.ProcessEnv = { ...process.env };
  if (args.port !== undefined) env.PORT = String(args.port);
  env.HOST = host;
  // An explicit --snapshots wins over walk-up discovery for this run by
  // seeding UNSPA_SNAPSHOTS, which discoverSnapshotDirectory treats as the
  // top-priority override. Relative paths resolve against the child's cwd.
  if (args.snapshots !== undefined && args.snapshots.trim().length > 0) {
    env.UNSPA_SNAPSHOTS = args.snapshots;
    log.dim(`Snapshots override: ${args.snapshots}`);
  }

  return await new Promise<number>((resolvePromise) => {
    const child = spawn(process.execPath, [serverShim], {
      stdio: 'inherit',
      cwd: process.cwd(),
      env
    });
    child.on('exit', (code) => resolvePromise(code ?? 0));
  });
};
