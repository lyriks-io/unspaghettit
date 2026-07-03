import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCommandOnPath } from '../util/detect';
import { mergeMcpServerEntry } from '../util/json';
import { SERVER_NAME } from './constants';
import type { ApplyResult, ClientAdapter, ConfigScope, McpServerEntry } from './types';

/**
 * Claude Code (CLI + VS Code extension share the same config file). Project
 * scope writes to `<cwd>/.mcp.json`. The file Claude Code already supports
 * for repo-local server registration. Global scope writes to `~/.claude.json`
 * (the user-level config Claude Code reads when no project file is present).
 */
export const claudeCodeClient: ClientAdapter = {
  id: 'claude-code',
  label: 'Claude Code (CLI + VS Code extension)',
  scopes: ['project', 'global'],
  installsSkills: true,
  resolvePath(scope: ConfigScope, params): string | null {
    if (scope === 'project') return join(params.cwd, '.mcp.json');
    if (scope === 'global') return join(params.home, '.claude.json');
    return null;
  },
  detect(params): boolean {
    return (
      existsSync(join(params.home, '.claude.json')) ||
      existsSync(join(params.home, '.claude')) ||
      isCommandOnPath('claude')
    );
  },
  async apply(scope, params): Promise<ApplyResult> {
    const path = this.resolvePath(scope, params);
    if (!path) return { path: '', changed: false, skipped: 'unsupported-scope' };
    const changed = await mergeMcpServerEntry(path, SERVER_NAME, params.serverEntry);
    return { path, changed };
  }
};

/**
 * Absolute path to the packaged MCP bin shim (`mcp-server/bin.cjs`), resolved
 * relative to this module, or null when it can't be found (an unusual install
 * layout). `bin.cjs` is self-contained - it registers tsx and the runtime path
 * aliases itself, then loads `bin.ts` - so `node <abs bin.cjs>` behaves exactly
 * like invoking the `unspa-mcp` shim, minus any PATH dependency.
 */
const resolveMcpServerScript = (): string | null => {
  try {
    const p = fileURLToPath(new URL('../../mcp-server/bin.cjs', import.meta.url));
    return existsSync(p) ? p : null;
  } catch {
    return null;
  }
};

/**
 * Compose the stdio MCP entry `unspa init` writes into every AI client's config.
 * Pure and injectable so both platform branches are testable off their host OS.
 *
 * The spawn command has to survive the least-friendly host: an MCP launcher that
 * `spawn()`s WITHOUT a shell, sometimes with a minimal PATH.
 *
 * - Windows: `cmd /c unspa-mcp`. Node's spawn refuses to exec `.cmd` / `.ps1`
 *   shims directly (EINVAL since Node 22), so we route through cmd, which
 *   resolves the shim via PATH + PATHEXT. Windows GUI hosts (Claude Desktop)
 *   inherit the user PATH, so npm's global bin is visible. `cmd` itself lives in
 *   System32, always on PATH.
 * - macOS / Linux: pin `<node> <abs bin.cjs>` when the script resolves. GUI
 *   hosts on macOS (Claude Desktop) launch with a MINIMAL PATH - typically
 *   `/usr/bin:/bin:/usr/sbin:/sbin`, excluding `/usr/local/bin`, Homebrew, and
 *   nvm - so a bare `unspa-mcp` (shebang `env node`) dies with ENOENT before MCP
 *   speaks a byte. An absolute node + absolute script depends on nothing in PATH.
 *   Falls back to the bare shim when the script can't be resolved; that still
 *   works from a shell (Claude Code in a terminal), just not a minimal-PATH GUI.
 *
 * `env` lets a NON-default snapshot location inject `UNSPA_SNAPSHOTS=<absolute
 * path>`; the default hub and `--local` installs leave it empty because
 * discovery's walk-up / hub fallback finds the folder on its own.
 */
export const composeMcpEntry = (params: {
  platform: NodeJS.Platform;
  nodePath: string;
  scriptPath: string | null;
  env?: Record<string, string>;
}): McpServerEntry => {
  const base: McpServerEntry =
    params.platform === 'win32'
      ? { type: 'stdio', command: 'cmd', args: ['/c', 'unspa-mcp'] }
      : params.scriptPath
        ? { type: 'stdio', command: params.nodePath, args: [params.scriptPath] }
        : { type: 'stdio', command: 'unspa-mcp', args: [] };
  if (params.env && Object.keys(params.env).length > 0) return { ...base, env: params.env };
  return base;
};

export const buildUnspaMcpEntry = (opts: { env?: Record<string, string> } = {}): McpServerEntry =>
  composeMcpEntry({
    platform: process.platform,
    nodePath: process.execPath,
    scriptPath: resolveMcpServerScript(),
    env: opts.env
  });
