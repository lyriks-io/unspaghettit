import { existsSync } from 'node:fs';
import { join } from 'node:path';
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
 * Build the MCP server entry that `unspa init` writes into every AI client's
 * config (Claude Code, Cursor, Gemini, ...). Target `unspa-mcp`, the dedicated
 * bin, rather than `unspa serve`: it runs the MCP server in-process via the
 * shim instead of spawning a tsx subprocess, so it's faster to start and has
 * a smaller blast radius (no `unspa serve` subprocess wiring to misconfigure).
 *
 * On Windows, `npm install -g` installs three shims for every bin:
 * `unspa-mcp` (POSIX), `unspa-mcp.cmd` (CMD), `unspa-mcp.ps1` (PowerShell).
 * AI-client MCP launchers `spawn()` the command without a shell, and Node's
 * spawn refuses to execute `.cmd` / `.ps1` shims directly (since Node 22 it
 * raises EINVAL). Wrapping the call in `cmd /c` lets CMD resolve the
 * `.cmd` shim itself. macOS and Linux can invoke the POSIX shim directly.
 *
 * `env` lets a NON-default snapshot location inject `UNSPA_SNAPSHOTS=<absolute
 * path>` so the MCP reads it regardless of where the AI client launches. The
 * default hub and per-repo (`--local`) installs need no env — discovery's
 * walk-up / hub fallback finds the folder on its own — so this stays empty for
 * them and is only populated by `--hub <path>`.
 */
export const buildUnspaMcpEntry = (opts: { env?: Record<string, string> } = {}): McpServerEntry => {
  const base: McpServerEntry =
    process.platform === 'win32'
      ? { type: 'stdio', command: 'cmd', args: ['/c', 'unspa-mcp'] }
      : { type: 'stdio', command: 'unspa-mcp', args: [] };
  const env = opts.env;
  if (env && Object.keys(env).length > 0) return { ...base, env };
  return base;
};
