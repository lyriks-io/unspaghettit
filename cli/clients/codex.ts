import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { isCommandOnPath } from '../util/detect';
import { mergeTomlServerEntry, removeTomlServerEntry } from '../util/toml';
import { SERVER_NAME } from './constants';
import type { ApplyResult, ClientAdapter, ConfigScope } from './types';

/**
 * OpenAI Codex. The CLI (`codex`) and the VS Code / IDE extension share one
 * config file, so a single adapter wires up both. Global config lives at
 * `~/.codex/config.toml`; a project can also scope servers to
 * `<cwd>/.codex/config.toml` (Codex only reads that for trusted projects).
 *
 * Unlike every other supported client, Codex's config is TOML, not JSON, and
 * MCP servers are declared as `[mcp_servers.<name>]` tables with `command` /
 * `args` / an inline `env` table. We own only the `unspa` table and pass the
 * rest of the file through untouched (see cli/util/toml.ts).
 */
const configPath = (scope: ConfigScope, params: { cwd: string; home: string }): string | null => {
  if (scope === 'global') return join(params.home, '.codex', 'config.toml');
  if (scope === 'project') return join(params.cwd, '.codex', 'config.toml');
  return null;
};

export const codexClient: ClientAdapter = {
  id: 'codex',
  label: 'Codex (CLI + VS Code extension)',
  scopes: ['global', 'project'],
  note: 'Writes ~/.codex/config.toml (shared by the Codex CLI and the VS Code extension). Project scope uses <cwd>/.codex/config.toml, which Codex reads for trusted projects only.',
  resolvePath(scope: ConfigScope, params): string | null {
    return configPath(scope, params);
  },
  detect(params): boolean {
    return (
      existsSync(join(params.home, '.codex')) ||
      existsSync(join(params.cwd, '.codex')) ||
      isCommandOnPath('codex')
    );
  },
  async apply(scope, params): Promise<ApplyResult> {
    const path = this.resolvePath(scope, params);
    if (!path) return { path: '', changed: false, skipped: 'unsupported-scope' };
    const changed = await mergeTomlServerEntry(path, SERVER_NAME, params.serverEntry);
    return { path, changed };
  },
  async removeEntry(scope, params): Promise<{ path: string | null; changed: boolean }> {
    const path = configPath(scope, params);
    if (!path) return { path: null, changed: false };
    const changed = await removeTomlServerEntry(path, SERVER_NAME);
    return { path, changed };
  }
};
