import { describe, expect, it } from 'vitest';
import { createProjectSource, toSourceMeta, type ProjectSource } from './ProjectSource';
import {
  exportSourceToJson,
  importSourceFromJson
} from '$features/source-provenance/infrastructure/io/SourceJson';

const input = (overrides: Partial<Parameters<typeof createProjectSource>[0]> = {}) => ({
  id: 'src-1',
  projectId: 'proj-1',
  name: 'Checkout PRD',
  kind: 'pasted' as const,
  content: 'The checkout flow shall total the cart.',
  attachedAt: 't0',
  ...overrides
});

describe('createProjectSource', () => {
  it('stores a new source with byte length + hash', () => {
    const r = createProjectSource(input(), []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.deduped).toBe(false);
    expect(r.source.byteLength).toBe(input().content.length);
    expect(r.source.contentHash).toMatch(/^[0-9a-f]{8}$/);
    expect(r.source.supersedes).toBeNull();
  });

  it('rejects an empty name and empty content', () => {
    expect(createProjectSource(input({ name: '  ' }), []).ok).toBe(false);
    expect(createProjectSource(input({ content: '' }), []).ok).toBe(false);
  });

  it('rejects content over the storage cap', () => {
    expect(createProjectSource(input({ maxBytes: 4 }), []).ok).toBe(false);
  });

  it('dedupes identical content onto the existing source', () => {
    const first = createProjectSource(input(), []);
    if (!first.ok) throw new Error(first.reason);
    const second = createProjectSource(input({ id: 'src-2', name: 'Checkout PRD again' }), [
      first.source
    ]);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.deduped).toBe(true);
    expect(second.source.id).toBe('src-1');
  });

  it('stores different content as a separate source', () => {
    const first = createProjectSource(input(), []);
    if (!first.ok) throw new Error(first.reason);
    const second = createProjectSource(input({ id: 'src-2', content: 'A different document.' }), [
      first.source
    ]);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.deduped).toBe(false);
    expect(second.source.id).toBe('src-2');
  });
});

describe('source JSON round-trip', () => {
  it('exports and re-imports a source losslessly', () => {
    const r = createProjectSource(input({ supersedes: 'src-0' }), []);
    if (!r.ok) throw new Error(r.reason);
    const back = importSourceFromJson(exportSourceToJson(r.source));
    expect(back).toEqual(r.source);
  });

  it('meta drops the content but keeps everything else', () => {
    const r = createProjectSource(input(), []);
    if (!r.ok) throw new Error(r.reason);
    const meta = toSourceMeta(r.source);
    expect((meta as Partial<ProjectSource>).content).toBeUndefined();
    expect(meta.contentHash).toBe(r.source.contentHash);
    expect(meta.name).toBe('Checkout PRD');
  });

  it('rejects a non-source envelope', () => {
    expect(() => importSourceFromJson('{"format":"nope","version":1}')).toThrow();
  });
});
