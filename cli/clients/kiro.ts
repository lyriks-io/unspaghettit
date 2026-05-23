import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { mergeMcpServerEntry } from '../util/json';
import { SERVER_NAME } from './constants';
import type { ApplyResult, ClientAdapter, ConfigScope } from './types';

/**
 * Kiro IDE (AWS). Workspace config at `<cwd>/.kiro/settings/mcp.json`,
 * global at `~/.kiro/settings/mcp.json`. The MCP server schema matches the
 * standard `mcpServers` block.
 */
export const kiroClient: ClientAdapter = {
  id: 'kiro',
  label: 'Kiro',
  scopes: ['project', 'global'],
  resolvePath(scope: ConfigScope, params): string | null {
    if (scope === 'project') return join(params.cwd, '.kiro', 'settings', 'mcp.json');
    if (scope === 'global') return join(params.home, '.kiro', 'settings', 'mcp.json');
    return null;
  },
  detect(params): boolean {
    return existsSync(join(params.home, '.kiro')) || existsSync(join(params.cwd, '.kiro'));
  },
  async apply(scope, params): Promise<ApplyResult> {
    const path = this.resolvePath(scope, params);
    if (!path) return { path: '', changed: false, skipped: 'unsupported-scope' };
    const changed = await mergeMcpServerEntry(path, SERVER_NAME, params.serverEntry);
    return { path, changed };
  }
};
