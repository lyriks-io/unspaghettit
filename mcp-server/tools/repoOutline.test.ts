import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildRepoOutline } from './repoOutline';

/**
 * Disk-backed: build a known tree in a temp dir and assert the outline walk
 * reports it faithfully, skips the noise (deps / build / dot-dirs), and honors
 * the depth and entry caps. Mirrors the provenance suite's on-disk approach.
 */
describe('buildRepoOutline', () => {
  let root: string;

  const write = (rel: string, body = ''): void => {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, body, 'utf8');
  };

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'unspa-outline-'));
    write('README.md', '# fixture');
    write('src/index.ts', 'export {};');
    write('src/features/auth/login.ts', 'export const login = () => {};');
    write('src/features/auth/logout.ts', 'export const logout = () => {};');
    write('src/features/projects/create.ts', 'export const create = () => {};');
    // Noise that must never appear in the outline.
    write('node_modules/pkg/index.js', 'module.exports = {};');
    write('.git/HEAD', 'ref: refs/heads/main');
    write('dist/bundle.js', 'console.log(1);');
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const paths = (o: ReturnType<typeof buildRepoOutline>): string[] =>
    o.directories.map((d) => d.path);

  it('reports the real source directories and skips deps, build, and dot-dirs', () => {
    const outline = buildRepoOutline(root, '.');
    const seen = new Set(paths(outline));

    expect(seen).toContain('.');
    expect(seen).toContain('src');
    expect(seen).toContain('src/features');
    expect(seen).toContain('src/features/auth');
    expect(seen).toContain('src/features/projects');

    for (const p of paths(outline)) {
      expect(p.startsWith('node_modules')).toBe(false);
      expect(p.startsWith('.git')).toBe(false);
      expect(p.startsWith('dist')).toBe(false);
    }
  });

  it('counts files per directory and rolls up a file-type histogram', () => {
    const outline = buildRepoOutline(root, '.');
    const rootDir = outline.directories.find((d) => d.path === '.');
    const authDir = outline.directories.find((d) => d.path === 'src/features/auth');

    // Root has README.md and exactly one kept subdir (src); node_modules/.git/dist are skipped.
    expect(rootDir).toMatchObject({ files: 1, dirs: 1 });
    expect(authDir).toMatchObject({ files: 2, dirs: 0 });

    // Only kept files count: 4 .ts + 1 .md. The skipped .js files never appear.
    expect(outline.totalFiles).toBe(5);
    expect(outline.fileTypes).toMatchObject({ ts: 4, md: 1 });
    expect(outline.fileTypes.js).toBeUndefined();
    expect(outline.truncated).toBe(false);
  });

  it('honors the depth cap without dropping the "more below" signal', () => {
    const outline = buildRepoOutline(root, '.', { depth: 1 });
    expect(paths(outline)).toEqual(['.', 'src']);
    // src is recorded with its subdir count even though we did not descend into it.
    expect(outline.directories.find((d) => d.path === 'src')?.dirs).toBe(1);
  });

  it('marks truncation when the entry cap is hit', () => {
    const outline = buildRepoOutline(root, '.', { maxEntries: 2 });
    expect(outline.truncated).toBe(true);
    expect(outline.directories).toHaveLength(2);
    expect(outline.note).toMatch(/Stopped at 2 directories/);
  });

  it('lists file names only when asked', () => {
    const withNames = buildRepoOutline(root, '.', { includeFiles: true });
    const authNamed = withNames.directories.find((d) => d.path === 'src/features/auth');
    expect(authNamed?.fileNames).toEqual(['login.ts', 'logout.ts']);

    const withoutNames = buildRepoOutline(root, '.');
    const authBare = withoutNames.directories.find((d) => d.path === 'src/features/auth');
    expect(authBare?.fileNames).toBeUndefined();
  });

  it('scopes to a subtree and labels paths relative to it', () => {
    const outline = buildRepoOutline(join(root, 'src'), 'src');
    expect(outline.scope).toBe('src');
    const seen = new Set(paths(outline));
    expect(seen).toContain('.');
    expect(seen).toContain('features');
    expect(seen).toContain('features/auth');
    expect(seen).not.toContain('src');
  });
});
