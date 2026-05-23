import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { mergeMcpServerEntry } from '../util/json';
import { SERVER_NAME } from './constants';
import type { ApplyResult, ClientAdapter, ConfigScope } from './types';

/**
 * Gemini Code Assist / Gemini CLI. MCP support landed in late 2025 and
 * reads `.gemini/settings.json` (project) and `~/.gemini/settings.json`
 * (global), both keyed by `mcpServers.<name>` like Claude Code. The schema
 * for the entry itself matches the Claude Code shape we already emit
 * (`type`, `command`, `args`), so we can merge straight in.
 *
 * If a future Gemini release moves the file or renames the key, fall back
 * to `unimplemented` with a hint pointing the user at the printed entry ,
 * same pattern as the Codex VS Code adapter.
 */
export const geminiClient: ClientAdapter = {
  id: 'gemini',
  label: 'Gemini Code Assist / CLI',
  scopes: ['project', 'global'],
  resolvePath(scope: ConfigScope, params): string | null {
    if (scope === 'project') return join(params.cwd, '.gemini', 'settings.json');
    if (scope === 'global') return join(params.home, '.gemini', 'settings.json');
    return null;
  },
  detect(params): boolean {
    return existsSync(join(params.home, '.gemini')) || existsSync(join(params.cwd, '.gemini'));
  },
  async apply(scope, params): Promise<ApplyResult> {
    const path = this.resolvePath(scope, params);
    if (!path) return { path: '', changed: false, skipped: 'unsupported-scope' };
    const changed = await mergeMcpServerEntry(path, SERVER_NAME, params.serverEntry);
    return { path, changed };
  }
};
