import type { ApplyResult, ClientAdapter, ConfigScope } from './types';

/**
 * OpenAI Codex VS Code extension. The exact config-file location and schema
 * have moved during the extension's preview cycles; rather than write to a
 * path that may not exist or be wrong, the adapter reports `unimplemented`
 * with a hint pointing at the official docs. Wire up the real merge once the
 * stable config path is verified.
 */
export const codexVscodeClient: ClientAdapter = {
  id: 'codex-vscode',
  label: 'Codex (VS Code extension)',
  scopes: ['project', 'global'],
  note: 'Config path not yet wired. `unspa init` will print the entry to paste manually.',
  resolvePath(_scope: ConfigScope): string | null {
    return null;
  },
  async apply(): Promise<ApplyResult> {
    return {
      path: '',
      changed: false,
      skipped: 'unimplemented',
      note: 'Codex VS Code config path varies by version. Paste the printed unspa entry into your codex MCP settings.'
    };
  }
};
