import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverSnapshotDirectory } from './snapshot-discovery';

const tempRoots: string[] = [];
const makeTempRoot = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'unspa-discovery-'));
  tempRoots.push(dir);
  return dir;
};

afterEach(() => {
  // We leak the temp dirs intentionally. OS will clean tmpdir, and removing
  // them sync would slow tests on Windows where unlinks block on AV scans.
  tempRoots.length = 0;
});

const writeSnapshot = (dir: string, name = 'sample'): void => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.feature.json`), '{}', 'utf8');
};

describe('discoverSnapshotDirectory', () => {
  it('uses the override when provided, resolving relative paths against cwd', () => {
    const cwd = makeTempRoot();
    const result = discoverSnapshotDirectory({ override: 'custom/dir', cwd });
    expect(result).toEqual({
      directory: resolve(cwd, 'custom/dir'),
      source: 'override'
    });
  });

  it('keeps absolute overrides unchanged', () => {
    const abs = makeTempRoot();
    const result = discoverSnapshotDirectory({ override: abs, cwd: '/somewhere/else' });
    expect(result.directory).toBe(abs);
    expect(result.source).toBe('override');
  });

  it('walks up to find an unspa/ folder containing a snapshot', () => {
    const root = makeTempRoot();
    const unspaDir = join(root, 'unspa');
    writeSnapshot(unspaDir);
    const deepCwd = join(root, 'a', 'b', 'c');
    mkdirSync(deepCwd, { recursive: true });

    const result = discoverSnapshotDirectory({ cwd: deepCwd });
    expect(result.directory).toBe(resolve(unspaDir));
    expect(result.source).toBe('walk');
  });

  it('falls back to ./unspa/ in cwd when nothing is found', () => {
    const cwd = makeTempRoot();
    const result = discoverSnapshotDirectory({ cwd });
    expect(result.directory).toBe(resolve(cwd, 'unspa'));
    expect(result.source).toBe('cwd-fallback');
  });

  it('ignores empty unspa/ folders during walk', () => {
    const root = makeTempRoot();
    mkdirSync(join(root, 'unspa'), { recursive: true });
    const result = discoverSnapshotDirectory({ cwd: root });
    expect(result.source).toBe('cwd-fallback');
  });
});
