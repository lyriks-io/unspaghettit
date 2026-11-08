import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A hash of the engine code every proof depends on besides the module's own:
 * the model it reads and the simulator that replays each finding. A proof the
 * module stored under other code (a new version, or a change under
 * development) is never read back.
 */
export const engineFingerprint = (): string => {
  const hash = createHash('sha1');
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) hash.update(name).update(readFileSync(path));
    }
  };
  const features = join(dirname(fileURLToPath(import.meta.url)), '..');
  try {
    for (const part of ['simulator', join('behavior-model', 'domain'), 'prover']) {
      walk(join(features, part));
    }
  } catch {
    // Unreadable code: no proof is ever read back.
    hash.update(String(Date.now()));
  }
  return hash.digest('hex').slice(0, 16);
};
