import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { mergeMcpServerEntry } from '../util/json';
import { SERVER_NAME } from './constants';
import type { ApplyResult, ClientAdapter, ConfigScope } from './types';

/**
 * Resolve Claude Desktop's config file path per platform. Claude Desktop has
 * one config location (no per-project scope), so we expose only `global`.
 *
 * Windows: `%APPDATA%\Claude\claude_desktop_config.json`. Prefer the env var
 * over `<home>/AppData/Roaming/...` because Microsoft Store / OneDrive
 * redirects can move the real Roaming folder away from the default location.
 *
 * macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`.
 *
 * Linux: no official Claude Desktop release, but follow the XDG convention
 * (`~/.config/Claude/...`) so future Linux builds work without changes.
 */
const resolveConfigPath = (home: string): string => {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming');
    return join(appData, 'Claude', 'claude_desktop_config.json');
  }
  if (process.platform === 'darwin') {
    return join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  return join(home, '.config', 'Claude', 'claude_desktop_config.json');
};

/**
 * Claude Desktop. Global-only (no per-project MCP config). The schema mirrors
 * Claude Code's `.mcp.json` for `mcpServers`, so we reuse the same merge
 * primitive. Claude Desktop has no cwd notion of its own, but that's fine now
 * that the shared hub is discovery's default fallback: with no per-repo
 * `unspa/` to walk up to, its MCP resolves the hub automatically — no
 * `UNSPA_SNAPSHOTS` needed. A non-default `--hub <path>` still pins the env var.
 */
export const claudeDesktopClient: ClientAdapter = {
  id: 'claude-desktop',
  label: 'Claude Desktop',
  scopes: ['global'],
  note: 'Global-only: Claude Desktop has no per-project MCP config. Resolves the shared hub automatically; use --hub <path> only for a non-default location.',
  resolvePath(scope: ConfigScope, params): string | null {
    if (scope === 'global') return resolveConfigPath(params.home);
    return null;
  },
  detect(params): boolean {
    return existsSync(resolveConfigPath(params.home));
  },
  async apply(scope, params): Promise<ApplyResult> {
    const path = this.resolvePath(scope, params);
    if (!path) return { path: '', changed: false, skipped: 'unsupported-scope' };
    const changed = await mergeMcpServerEntry(path, SERVER_NAME, params.serverEntry);
    return { path, changed };
  }
};
