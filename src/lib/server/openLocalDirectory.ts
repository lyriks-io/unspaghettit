import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';

export type OpenDirectoryCommand = {
  readonly command: string;
  readonly args: readonly string[];
};

export const openDirectoryCommand = (
  directory: string,
  platform: NodeJS.Platform = process.platform
): OpenDirectoryCommand => {
  switch (platform) {
    case 'win32':
      return { command: 'explorer.exe', args: [directory] };
    case 'darwin':
      return { command: 'open', args: [directory] };
    default:
      return { command: 'xdg-open', args: [directory] };
  }
};

export const openLocalDirectory = async (directory: string): Promise<void> => {
  await mkdir(directory, { recursive: true });
  const { command, args } = openDirectoryCommand(directory);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });

    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
};
