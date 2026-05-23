import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { mergeMcpServerEntry } from '../util/json';
import { SERVER_NAME } from './constants';
import type { ApplyResult, ClientAdapter, ConfigScope } from './types';

/**
 * Windsurf (Codeium). Global config at `~/.codeium/windsurf/mcp_config.json`.
 * No project-scoped MCP file is supported by Windsurf today; we report the
 * project scope as unsupported instead of inventing one.
 */
export const windsurfClient: ClientAdapter = {
  id: 'windsurf',
  label: 'Windsurf',
  scopes: ['global'],
  resolvePath(scope: ConfigScope, params): string | null {
    if (scope === 'global') return join(params.home, '.codeium', 'windsurf', 'mcp_config.json');
    return null;
  },
  detect(params): boolean {
    return existsSync(join(params.home, '.codeium', 'windsurf')) || existsSync(join(params.home, '.codeium'));
  },
  async apply(scope, params): Promise<ApplyResult> {
    const path = this.resolvePath(scope, params);
    if (!path) return { path: '', changed: false, skipped: 'unsupported-scope' };
    const changed = await mergeMcpServerEntry(path, SERVER_NAME, params.serverEntry);
    return { path, changed };
  }
};
