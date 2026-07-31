import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isIndexSourceError, resolveIndexSource, type IndexSource } from './_index-source';

const asSource = (value: IndexSource | { readonly error: string }): IndexSource => {
  if (isIndexSourceError(value)) throw new Error(`expected a source, got: ${value.error}`);
  return value;
};

describe('resolveIndexSource', () => {
  let root: string;
  let linkPath: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'unspa-index-source-'));
    linkPath = join(root, '.unspa.json');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('reads the linked .unspa.json when no inline index is passed', () => {
    writeFileSync(
      linkPath,
      JSON.stringify({
        projectId: 'proj-1',
        index: { 'action:a': { status: 'implemented', file: 'a.ts', line: 3, signature: 'const a' } }
      }),
      'utf8'
    );

    const source = asSource(resolveIndexSource({ linkPath }));

    expect(source.projectId).toBe('proj-1');
    expect(source.repoRoot).toBe(root);
    expect(source.index['action:a']?.line).toBe(3);
  });

  it('prefers the inline index over the link file, and reports no repo root', () => {
    writeFileSync(linkPath, JSON.stringify({ projectId: 'from-disk', index: {} }), 'utf8');

    const source = asSource(
      resolveIndexSource(
        { linkPath },
        {
          projectId: 'from-caller',
          index: { 'surface:s': { status: 'partial', file: 's.ts', line: 1, signature: 'class S' } }
        }
      )
    );

    // No repo root is the signal downstream uses to skip snippet reads and
    // line-healing — both need files the server cannot see on this path.
    expect(source.repoRoot).toBeNull();
    expect(source.projectId).toBe('from-caller');
    expect(source.index['surface:s']?.status).toBe('partial');
  });

  it('works with no link at all when the index is inline', () => {
    const source = asSource(resolveIndexSource(undefined, { projectId: 'proj-1', index: {} }));

    expect(source.projectId).toBe('proj-1');
    expect(source.repoRoot).toBeNull();
  });

  it('rejects an inline index with no projectId — nothing would scope the report', () => {
    const result = resolveIndexSource(undefined, { index: { 'action:a': {} } as never });

    expect(isIndexSourceError(result)).toBe(true);
    expect(isIndexSourceError(result) && result.error).toMatch(/projectId is required/);
  });

  it('points at both remedies when there is neither a link nor an inline index', () => {
    const result = resolveIndexSource(undefined);

    expect(isIndexSourceError(result)).toBe(true);
    expect(isIndexSourceError(result) && result.error).toMatch(/unspa link/);
    expect(isIndexSourceError(result) && result.error).toMatch(/inline/);
  });

  it('reports an unreadable link file rather than silently returning an empty index', () => {
    writeFileSync(linkPath, 'not json', 'utf8');

    const result = resolveIndexSource({ linkPath });

    expect(isIndexSourceError(result)).toBe(true);
    expect(isIndexSourceError(result) && result.error).toMatch(/Could not read/);
  });

  it('treats a link with no index as empty, not as an error', () => {
    writeFileSync(linkPath, JSON.stringify({ projectId: 'proj-1' }), 'utf8');

    const source = asSource(resolveIndexSource({ linkPath }));

    expect(source.index).toEqual({});
    expect(source.projectId).toBe('proj-1');
  });
});
