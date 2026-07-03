import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { isCommandOnPath } from '../util/detect';
import { mergeMcpServerEntry } from '../util/json';
import { SERVER_NAME } from './constants';
import type { ApplyResult, ClientAdapter, ConfigScope } from './types';

/**
 * Cursor IDE. Supports project-local `<cwd>/.cursor/mcp.json` and global
 * `~/.cursor/mcp.json`. The schema mirrors Claude Code's `.mcp.json` for the
 * `mcpServers` block, so we reuse the same merge primitive.
 */
export const cursorClient: ClientAdapter = {
  id: 'cursor',
  label: 'Cursor',
  scopes: ['project', 'global'],
  resolvePath(scope: ConfigScope, params): string | null {
    if (scope === 'project') return join(params.cwd, '.cursor', 'mcp.json');
    if (scope === 'global') return join(params.home, '.cursor', 'mcp.json');
    return null;
  },
  detect(params): boolean {
    return (
      existsSync(join(params.home, '.cursor')) ||
      existsSync(join(params.cwd, '.cursor')) ||
      isCommandOnPath('cursor')
    );
  },
  async apply(scope, params): Promise<ApplyResult> {
    const path = this.resolvePath(scope, params);
    if (!path) return { path: '', changed: false, skipped: 'unsupported-scope' };
    const changed = await mergeMcpServerEntry(path, SERVER_NAME, params.serverEntry);
    return { path, changed };
  }
};
