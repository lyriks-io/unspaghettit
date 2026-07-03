import { describe, expect, it } from 'vitest';
import { composeMcpEntry } from './claude-code';

const NODE = '/usr/local/bin/node';
const SCRIPT = '/opt/unspa/mcp-server/bin.cjs';

describe('composeMcpEntry', () => {
  it('wraps in cmd /c on Windows regardless of the resolved script', () => {
    const entry = composeMcpEntry({ platform: 'win32', nodePath: 'C:\\node.exe', scriptPath: SCRIPT });
    expect(entry).toEqual({ type: 'stdio', command: 'cmd', args: ['/c', 'unspa-mcp'] });
  });

  it('pins absolute node + script on macOS so a minimal-PATH GUI host can spawn it', () => {
    const entry = composeMcpEntry({ platform: 'darwin', nodePath: NODE, scriptPath: SCRIPT });
    expect(entry).toEqual({ type: 'stdio', command: NODE, args: [SCRIPT] });
  });

  it('pins absolute node + script on Linux too', () => {
    const entry = composeMcpEntry({ platform: 'linux', nodePath: NODE, scriptPath: SCRIPT });
    expect(entry).toEqual({ type: 'stdio', command: NODE, args: [SCRIPT] });
  });

  it('falls back to the bare shim when the script cannot be resolved (non-Windows)', () => {
    const entry = composeMcpEntry({ platform: 'darwin', nodePath: NODE, scriptPath: null });
    expect(entry).toEqual({ type: 'stdio', command: 'unspa-mcp', args: [] });
  });

  it('always marks the transport as stdio', () => {
    for (const platform of ['win32', 'darwin', 'linux'] as const) {
      expect(composeMcpEntry({ platform, nodePath: NODE, scriptPath: SCRIPT }).type).toBe('stdio');
    }
  });

  it('attaches env only when non-empty', () => {
    const withEnv = composeMcpEntry({
      platform: 'darwin',
      nodePath: NODE,
      scriptPath: SCRIPT,
      env: { UNSPA_SNAPSHOTS: '/custom/hub' }
    });
    expect(withEnv.env).toEqual({ UNSPA_SNAPSHOTS: '/custom/hub' });

    const emptyEnv = composeMcpEntry({ platform: 'darwin', nodePath: NODE, scriptPath: SCRIPT, env: {} });
    expect(emptyEnv.env).toBeUndefined();

    const noEnv = composeMcpEntry({ platform: 'win32', nodePath: 'C:\\node.exe', scriptPath: null });
    expect(noEnv.env).toBeUndefined();
  });
});
