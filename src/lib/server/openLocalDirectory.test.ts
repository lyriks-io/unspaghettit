import { describe, expect, it } from 'vitest';
import { openDirectoryCommand } from './openLocalDirectory';

describe('openDirectoryCommand', () => {
  it('uses Explorer on Windows', () => {
    expect(openDirectoryCommand('C:\\Users\\Ada\\.unspa-hub\\unspa', 'win32')).toEqual({
      command: 'explorer.exe',
      args: ['C:\\Users\\Ada\\.unspa-hub\\unspa']
    });
  });

  it('uses open on macOS', () => {
    expect(openDirectoryCommand('/Users/ada/.unspa-hub/unspa', 'darwin')).toEqual({
      command: 'open',
      args: ['/Users/ada/.unspa-hub/unspa']
    });
  });

  it('uses xdg-open on Linux', () => {
    expect(openDirectoryCommand('/home/ada/.unspa-hub/unspa', 'linux')).toEqual({
      command: 'xdg-open',
      args: ['/home/ada/.unspa-hub/unspa']
    });
  });
});
