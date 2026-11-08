import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The solver exists only in Lyriks Enterprise: it lives in the private proof
 * module, and this engine is public. `prepublishOnly` runs this suite, so a
 * package that carries the solver again cannot reach npm.
 */
const root = fileURLToPath(new URL('../../../', import.meta.url));

const sourcesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : sourcesUnder(path);
    return /\.(ts|js|cjs|mjs|svelte)$/.test(name) && !name.endsWith('.test.ts') ? [path] : [];
  });

describe('the public engine carries no solver', () => {
  it('declares no solver dependency', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<
      string,
      Record<string, string> | undefined
    >;
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      expect(manifest[field]?.['z3-solver'], field).toBeUndefined();
    }
  });

  it('holds no solver code and no solver binary', () => {
    for (const path of ['src/features/solver', 'scripts/fetch-z3.cjs', 'vendor/z3']) {
      expect(existsSync(join(root, path)), path).toBe(false);
    }
  });

  it('imports the solver nowhere', () => {
    const importing = ['src', 'mcp-server', 'cli']
      .flatMap((dir) => sourcesUnder(join(root, dir)))
      .filter((path) => /(from\s+|require\(|import\()\s*['"]z3-solver['"]/.test(readFileSync(path, 'utf8')));
    expect(importing).toEqual([]);
  });
});
