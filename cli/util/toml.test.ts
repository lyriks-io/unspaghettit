import { describe, expect, it } from 'vitest';
import type { McpServerEntry } from '../clients/types';
import {
  removeTomlServerBlock,
  renderTomlServerBlock,
  upsertTomlServerBlock
} from './toml';

const posix: McpServerEntry = { type: 'stdio', command: 'unspa-mcp', args: [] };
const win: McpServerEntry = { type: 'stdio', command: 'cmd', args: ['/c', 'unspa-mcp'] };

describe('renderTomlServerBlock', () => {
  it('renders the table header, command and args, dropping the JSON-only type', () => {
    const block = renderTomlServerBlock('unspa', posix);
    expect(block).toBe(['[mcp_servers.unspa]', 'command = "unspa-mcp"', 'args = []'].join('\n'));
    expect(block).not.toContain('stdio');
  });

  it('quotes each arg', () => {
    const block = renderTomlServerBlock('unspa', win);
    expect(block).toContain('command = "cmd"');
    expect(block).toContain('args = ["/c", "unspa-mcp"]');
  });

  it('emits env as an inline table and keeps Windows paths as literal strings (no escaping)', () => {
    const entry: McpServerEntry = { ...win, env: { UNSPA_SNAPSHOTS: 'C:\\Users\\me\\hub' } };
    const block = renderTomlServerBlock('unspa', entry);
    expect(block).toContain("env = { UNSPA_SNAPSHOTS = 'C:\\Users\\me\\hub' }");
    expect(block).not.toContain('\\\\'); // literal string, so no doubled backslashes
  });

  it('escapes a POSIX path with no backslashes as a basic string', () => {
    const entry: McpServerEntry = { ...posix, env: { UNSPA_SNAPSHOTS: '/home/me/hub' } };
    const block = renderTomlServerBlock('unspa', entry);
    expect(block).toContain('env = { UNSPA_SNAPSHOTS = "/home/me/hub" }');
  });
});

describe('upsertTomlServerBlock', () => {
  const block = renderTomlServerBlock('unspa', posix);

  it('appends the block to an empty file', () => {
    const { content, changed } = upsertTomlServerBlock('', 'unspa', block);
    expect(changed).toBe(true);
    expect(content).toBe(`${block}\n`);
  });

  it('preserves unrelated content when appending', () => {
    const existing = '[mcp_servers.other]\ncommand = "other-mcp"\nargs = []\n';
    const { content, changed } = upsertTomlServerBlock(existing, 'unspa', block);
    expect(changed).toBe(true);
    expect(content).toContain('[mcp_servers.other]');
    expect(content).toContain('command = "other-mcp"');
    expect(content).toContain('[mcp_servers.unspa]');
    // Single blank line between the two tables.
    expect(content).toContain('args = []\n\n[mcp_servers.unspa]');
  });

  it('is idempotent: re-applying the same block reports no change', () => {
    const first = upsertTomlServerBlock('', 'unspa', block).content;
    const { changed } = upsertTomlServerBlock(first, 'unspa', block);
    expect(changed).toBe(false);
  });

  it('replaces an existing unspa table in place', () => {
    const stale = '[mcp_servers.unspa]\ncommand = "old"\nargs = ["--stale"]\n';
    const { content, changed } = upsertTomlServerBlock(stale, 'unspa', block);
    expect(changed).toBe(true);
    expect(content).not.toContain('old');
    expect(content).not.toContain('--stale');
    expect(content).toContain('command = "unspa-mcp"');
  });

  it('replaces the table and its sub-tables, leaving later tables intact', () => {
    const existing = [
      '[mcp_servers.unspa]',
      'command = "old"',
      'args = []',
      '',
      '[mcp_servers.unspa.env]',
      'FOO = "bar"',
      '',
      '[other]',
      'keep = true',
      ''
    ].join('\n');
    const { content } = upsertTomlServerBlock(existing, 'unspa', block);
    expect(content).not.toContain('[mcp_servers.unspa.env]');
    expect(content).not.toContain('FOO = "bar"');
    expect(content).toContain('[other]');
    expect(content).toContain('keep = true');
  });

  it('does not confuse a differently-named sibling table', () => {
    const existing = '[mcp_servers.unspa-extra]\ncommand = "x"\nargs = []\n';
    const { content } = upsertTomlServerBlock(existing, 'unspa', block);
    expect(content).toContain('[mcp_servers.unspa-extra]');
    expect(content).toContain('[mcp_servers.unspa]');
  });
});

describe('removeTomlServerBlock', () => {
  it('removes the unspa table and its sub-tables, preserving neighbours', () => {
    const existing = [
      '[mcp_servers.other]',
      'command = "other-mcp"',
      'args = []',
      '',
      '[mcp_servers.unspa]',
      'command = "unspa-mcp"',
      'args = []',
      '',
      '[mcp_servers.unspa.env]',
      'FOO = "bar"',
      ''
    ].join('\n');
    const { content, changed } = removeTomlServerBlock(existing, 'unspa');
    expect(changed).toBe(true);
    expect(content).toContain('[mcp_servers.other]');
    expect(content).not.toContain('[mcp_servers.unspa]');
    expect(content).not.toContain('[mcp_servers.unspa.env]');
  });

  it('no-ops when the table is absent', () => {
    const existing = '[mcp_servers.other]\ncommand = "other-mcp"\nargs = []\n';
    const { content, changed } = removeTomlServerBlock(existing, 'unspa');
    expect(changed).toBe(false);
    expect(content).toBe(existing);
  });

  it('empties a file that held only the unspa table', () => {
    const only = 'unspa\n'.length ? '[mcp_servers.unspa]\ncommand = "unspa-mcp"\nargs = []\n' : '';
    const { content, changed } = removeTomlServerBlock(only, 'unspa');
    expect(changed).toBe(true);
    expect(content).toBe('');
  });
});
