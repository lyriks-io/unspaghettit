import { describe, expect, it } from 'vitest';
import {
  authorityRank,
  classifySource,
  createProjectSource,
  defaultAuthorityForArtifact,
  effectiveAuthority,
  toSourceMeta,
  type ProjectSource
} from './ProjectSource';
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

describe('source authority ranking', () => {
  it('stores authority and artifact when given, absent otherwise', () => {
    const tagged = createProjectSource(input({ authority: 'normative', artifact: 'contract' }), []);
    if (!tagged.ok) throw new Error(tagged.reason);
    expect(tagged.source.authority).toBe('normative');
    expect(tagged.source.artifact).toBe('contract');

    const bare = createProjectSource(input(), []);
    if (!bare.ok) throw new Error(bare.reason);
    // Absent, not `undefined`-valued, so serialization stays byte-identical to pre-authority sources.
    expect('authority' in bare.source).toBe(false);
    expect('artifact' in bare.source).toBe(false);
  });

  it('derives an effective authority: explicit wins, else artifact, else unknown', () => {
    expect(effectiveAuthority({ authority: 'observed', artifact: 'contract' })).toBe('observed');
    expect(effectiveAuthority({ artifact: 'contract' })).toBe('normative');
    expect(effectiveAuthority({ artifact: 'implementation' })).toBe('supporting');
    expect(effectiveAuthority({ artifact: 'interview' })).toBe('observed');
    expect(effectiveAuthority({})).toBe('unknown');
  });

  it('ranks normative over supporting over observed over unknown', () => {
    expect(authorityRank.normative).toBeGreaterThan(authorityRank.supporting);
    expect(authorityRank.supporting).toBeGreaterThan(authorityRank.observed);
    expect(authorityRank.observed).toBeGreaterThan(authorityRank.unknown);
  });

  it('maps every artifact to a default authority', () => {
    expect(defaultAuthorityForArtifact('contract')).toBe('normative');
    expect(defaultAuthorityForArtifact('implementation')).toBe('supporting');
    expect(defaultAuthorityForArtifact('test')).toBe('supporting');
    expect(defaultAuthorityForArtifact('documentation')).toBe('supporting');
    expect(defaultAuthorityForArtifact('interview')).toBe('observed');
  });

  it('classifySource re-tags metadata only, leaving content and hash untouched', () => {
    const r = createProjectSource(input({ artifact: 'implementation' }), []);
    if (!r.ok) throw new Error(r.reason);
    const retagged = classifySource(r.source, { authority: 'normative', artifact: 'contract' });
    expect(retagged.authority).toBe('normative');
    expect(retagged.artifact).toBe('contract');
    expect(retagged.content).toBe(r.source.content);
    expect(retagged.contentHash).toBe(r.source.contentHash);
    expect(retagged.id).toBe(r.source.id);
    // An omitted field in the patch is preserved, not cleared.
    expect(classifySource(r.source, { authority: 'observed' }).artifact).toBe('implementation');
  });

  it('round-trips authority and artifact through JSON, and drops unknown values', () => {
    const r = createProjectSource(input({ authority: 'supporting', artifact: 'test' }), []);
    if (!r.ok) throw new Error(r.reason);
    expect(importSourceFromJson(exportSourceToJson(r.source))).toEqual(r.source);

    const bogus = JSON.stringify({
      format: 'unspaghettit-source',
      version: 1,
      source: { ...r.source, authority: 'gospel', artifact: 'meeting' }
    });
    const back = importSourceFromJson(bogus);
    expect('authority' in back).toBe(false);
    expect('artifact' in back).toBe(false);
  });
});
