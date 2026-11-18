import { describe, expect, it } from 'vitest';
import { openDirectoryCommand } from './openLocalDirectory';

describe('openDirectoryCommand', () => {
  // A hub path may hold spaces or shell characters: it is handed over as one
  // argument, never through a shell.
  const awkward = '/home/ada/my hub; rm -rf ~/$(whoami)/unspa';

  it.each([
    ['win32', 'explorer.exe'],
    ['darwin', 'open'],
    ['linux', 'xdg-open'],
    ['freebsd', 'xdg-open']
  ] as const)('opens the folder with the file manager of %s, the path as a single argument', (platform, command) => {
    expect(openDirectoryCommand(awkward, platform)).toEqual({ command, args: [awkward] });
  });
});
