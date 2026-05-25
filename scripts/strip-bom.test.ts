import { readdirSync, openSync, readSync, closeSync } from 'node:fs';
import { join, relative, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * EditorConfig declares `charset = utf-8` (no BOM) for this repo, but
 * some editors silently prepend one. A BOM on `mcp-server/bin.cjs` once
 * shipped a broken POSIX shebang (the kernel doesn't skip the BOM). This
 * test re-asserts the rule on every commit so the same gap can't recur.
 *
 * Mirrors `scripts/strip-bom.cjs --check`; both kept around because the
 * script is what CI / prepublishOnly run and what fixes drift, while this
 * test catches it during normal local `npm test`.
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.svelte-kit',
  'build',
  'dist',
  'coverage',
  '.unspa-world'
]);

const EXTS = new Set([
  '.cjs',
  '.mjs',
  '.js',
  '.ts',
  '.tsx',
  '.svelte',
  '.json',
  '.md',
  '.html',
  '.css',
  '.yml',
  '.yaml'
]);

function findBomFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      findBomFiles(full, out);
    } else if (EXTS.has(extname(entry.name))) {
      const fd = openSync(full, 'r');
      const head = Buffer.alloc(3);
      const n = readSync(fd, head, 0, 3, 0);
      closeSync(fd);
      if (n === 3 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) {
        out.push(relative(ROOT, full).replace(/\\/g, '/'));
      }
    }
  }
}

describe('repo encoding (no UTF-8 BOM)', () => {
  it('no tracked source file starts with a UTF-8 BOM', () => {
    const offenders: string[] = [];
    findBomFiles(ROOT, offenders);
    expect(
      offenders,
      `Found ${offenders.length} file(s) with a leading UTF-8 BOM. Fix: \`npm run bom:strip\`.\nOffenders:\n${offenders.map((o) => '  - ' + o).join('\n')}`
    ).toEqual([]);
  });
});
