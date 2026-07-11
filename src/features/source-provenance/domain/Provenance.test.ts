import { describe, expect, it } from 'vitest';
import { asFeatureId } from '$features/behavior-model/domain/value-objects/ids';
import {
  attachSourceFile,
  computeSpanLines,
  emptyProvenance,
  finalizeProvenance,
  linkSource,
  recordSpan,
  type Provenance
} from './Provenance';
import {
  exportProvenanceToJson,
  importProvenanceFromJson
} from '$features/source-provenance/infrastructure/io/ProvenanceJson';
import { addConflict } from './Conflicts';
import { stageCandidate } from './Candidates';

const CONTENT = 'function add(a, b) {\n  return a + b\n}\n';

const stored = (): Provenance => {
  const r = attachSourceFile(emptyProvenance(asFeatureId('feat'), 't0'), {
    id: 'file-1',
    fileName: 'math.ts',
    content: CONTENT,
    attachedAt: 't0'
  });
  if (!r.ok) throw new Error(r.reason);
  return r.provenance;
};

describe('attachSourceFile', () => {
  it('stores the file and computes byte length + hash', () => {
    const r = attachSourceFile(emptyProvenance(asFeatureId('feat'), 't0'), {
      id: 'file-1',
      fileName: 'math.ts',
      content: CONTENT,
      attachedAt: 't0'
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.provenance.file?.fileName).toBe('math.ts');
    expect(r.provenance.file?.byteLength).toBe(CONTENT.length);
    expect(r.provenance.file?.contentHash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('blocks a second attach', () => {
    const r = attachSourceFile(stored(), {
      id: 'file-2',
      fileName: 'other.ts',
      content: 'x',
      attachedAt: 't1'
    });
    expect(r.ok).toBe(false);
  });

  it('rejects a file over the storage cap', () => {
    const r = attachSourceFile(emptyProvenance(asFeatureId('feat'), 't0'), {
      id: 'file-1',
      fileName: 'big.ts',
      content: 'abcdefghij',
      attachedAt: 't0',
      maxBytes: 4
    });
    expect(r.ok).toBe(false);
  });
});

describe('recordSpan', () => {
  it('records a span with computed lines and snippet', () => {
    const r = recordSpan(stored(), {
      id: 'span-1',
      elementId: 'el-1',
      elementType: 'action',
      startOffset: 0,
      endOffset: 8,
      recordedAt: 't1'
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const span = r.provenance.spans[0];
    expect(span?.snippet).toBe('function');
    expect(span?.startLine).toBe(1);
    expect(span?.endLine).toBe(1);
  });

  it('blocks recording a span before a file is stored', () => {
    const r = recordSpan(emptyProvenance(asFeatureId('feat'), 't0'), {
      id: 'span-1',
      elementId: 'el-1',
      elementType: 'action',
      startOffset: 0,
      endOffset: 4,
      recordedAt: 't1'
    });
    expect(r.ok).toBe(false);
  });

  it('rejects a span past the end of the file', () => {
    const r = recordSpan(stored(), {
      id: 'span-1',
      elementId: 'el-1',
      elementType: 'action',
      startOffset: 0,
      endOffset: 9999,
      recordedAt: 't1'
    });
    expect(r.ok).toBe(false);
  });

  it('rejects an inverted span', () => {
    const r = recordSpan(stored(), {
      id: 'span-1',
      elementId: 'el-1',
      elementType: 'action',
      startOffset: 10,
      endOffset: 4,
      recordedAt: 't1'
    });
    expect(r.ok).toBe(false);
  });

  it('rejects a second span for the same element', () => {
    const first = recordSpan(stored(), {
      id: 'span-1',
      elementId: 'el-1',
      elementType: 'action',
      startOffset: 0,
      endOffset: 8,
      recordedAt: 't1'
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = recordSpan(first.provenance, {
      id: 'span-2',
      elementId: 'el-1',
      elementType: 'action',
      startOffset: 9,
      endOffset: 12,
      recordedAt: 't2'
    });
    expect(second.ok).toBe(false);
  });

  it('computes the line for an offset on a later line', () => {
    const lines = computeSpanLines(
      CONTENT,
      CONTENT.indexOf('return'),
      CONTENT.indexOf('return') + 6
    );
    expect(lines.startLine).toBe(2);
    expect(lines.endLine).toBe(2);
  });
});

describe('finalizeProvenance', () => {
  it('blocks finalize while elements are untraced', () => {
    const r = finalizeProvenance(stored(), 3, 't9');
    expect(r.ok).toBe(false);
  });

  it('finalizes once every element has a span', () => {
    const span = recordSpan(stored(), {
      id: 'span-1',
      elementId: 'el-1',
      elementType: 'action',
      startOffset: 0,
      endOffset: 8,
      recordedAt: 't1'
    });
    expect(span.ok).toBe(true);
    if (!span.ok) return;
    const r = finalizeProvenance(span.provenance, 1, 't9');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.provenance.finalized).toBe(true);
  });
});

describe('project-source analyses', () => {
  const DOC = { id: 'src-1', content: CONTENT };

  it('links a source idempotently and blocks linking once finalized', () => {
    const linked = linkSource(emptyProvenance(asFeatureId('feat'), 't0'), 'src-1', 't1');
    expect(linked.ok).toBe(true);
    if (!linked.ok) return;
    expect(linked.provenance.sourceIds).toEqual(['src-1']);

    const again = linkSource(linked.provenance, 'src-1', 't2');
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.provenance.sourceIds).toEqual(['src-1']);

    const finalized: Provenance = { ...again.provenance, finalized: true };
    expect(linkSource(finalized, 'src-2', 't3').ok).toBe(false);
  });

  it('records a span against a resolved source and auto-links it', () => {
    const r = recordSpan(emptyProvenance(asFeatureId('feat'), 't0'), {
      id: 'span-1',
      elementId: 'el-1',
      elementType: 'action',
      startOffset: 0,
      endOffset: 8,
      recordedAt: 't1',
      source: DOC
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.provenance.spans[0]?.sourceId).toBe('src-1');
    expect(r.provenance.spans[0]?.snippet).toBe('function');
    expect(r.provenance.sourceIds).toEqual(['src-1']);
  });

  it('validates offsets against the source content, not the legacy file', () => {
    const r = recordSpan(emptyProvenance(asFeatureId('feat'), 't0'), {
      id: 'span-1',
      elementId: 'el-1',
      elementType: 'action',
      startOffset: 0,
      endOffset: CONTENT.length + 1,
      recordedAt: 't1',
      source: DOC
    });
    expect(r.ok).toBe(false);
  });

  it('finalizes an analysis whose document is a linked source (no embedded file)', () => {
    const span = recordSpan(emptyProvenance(asFeatureId('feat'), 't0'), {
      id: 'span-1',
      elementId: 'el-1',
      elementType: 'action',
      startOffset: 0,
      endOffset: 8,
      recordedAt: 't1',
      source: DOC
    });
    if (!span.ok) throw new Error(span.reason);
    const r = finalizeProvenance(span.provenance, 1, 't9');
    expect(r.ok).toBe(true);
  });
});

describe('JSON round-trip', () => {
  it('exports and re-imports a provenance sidecar losslessly', () => {
    const span = recordSpan(stored(), {
      id: 'span-1',
      elementId: 'el-1',
      elementType: 'rule',
      startOffset: 0,
      endOffset: 8,
      recordedAt: 't1'
    });
    if (!span.ok) throw new Error(span.reason);
    const json = exportProvenanceToJson(span.provenance);
    const back = importProvenanceFromJson(json);
    expect(back.file?.fileName).toBe('math.ts');
    expect(back.spans).toHaveLength(1);
    expect(back.spans[0]?.snippet).toBe('function');
    expect(back.spans[0]?.elementType).toBe('rule');
  });

  it('round-trips sourceIds and per-span sourceId', () => {
    const span = recordSpan(emptyProvenance(asFeatureId('feat'), 't0'), {
      id: 'span-1',
      elementId: 'el-1',
      elementType: 'rule',
      startOffset: 0,
      endOffset: 8,
      recordedAt: 't1',
      source: { id: 'src-9', content: CONTENT }
    });
    if (!span.ok) throw new Error(span.reason);
    const back = importProvenanceFromJson(exportProvenanceToJson(span.provenance));
    expect(back.sourceIds).toEqual(['src-9']);
    expect(back.spans[0]?.sourceId).toBe('src-9');
  });

  it('round-trips conflicts and drops a malformed one on read', () => {
    const added = addConflict([], {
      id: 'conf-1',
      summary: 'cap disagreement',
      claims: [
        { sourceId: 'a', statement: 'caps at 10' },
        { sourceId: 'b', statement: 'caps at 20' }
      ],
      affectedElements: ['el-1'],
      at: 't1'
    });
    if (!added.ok) throw new Error('seed failed');
    const withConflict: Provenance = { ...emptyProvenance(asFeatureId('feat'), 't0'), conflicts: added.conflicts };
    const back = importProvenanceFromJson(exportProvenanceToJson(withConflict));
    expect(back.conflicts).toHaveLength(1);
    expect(back.conflicts[0]?.summary).toBe('cap disagreement');
    expect(back.conflicts[0]?.claims).toHaveLength(2);

    // A conflict with fewer than two claims is not a conflict; the reader drops it.
    const malformed = JSON.stringify({
      format: 'unspaghettit-provenance',
      version: 2,
      provenance: {
        featureId: 'feat',
        file: null,
        sourceIds: [],
        spans: [],
        conflicts: [{ id: 'c', summary: 's', claims: [{ sourceId: 'a', statement: 'x' }], status: 'open' }],
        finalized: false,
        updatedAt: 't0'
      }
    });
    expect(importProvenanceFromJson(malformed).conflicts).toHaveLength(0);
  });

  it('round-trips candidates and drops one with an unknown proposedKind', () => {
    const staged = stageCandidate([], {
      id: 'cand-1',
      sourceId: 'src-9',
      sourceContent: CONTENT,
      proposedKind: 'action',
      summary: 'Add two numbers',
      startOffset: 0,
      endOffset: 8,
      disposition: 'accepted',
      at: 't1'
    });
    if (!staged.ok) throw new Error('seed failed');
    const withCandidate: Provenance = {
      ...emptyProvenance(asFeatureId('feat'), 't0'),
      candidates: staged.candidates
    };
    const back = importProvenanceFromJson(exportProvenanceToJson(withCandidate));
    expect(back.candidates).toHaveLength(1);
    expect(back.candidates[0]?.proposedKind).toBe('action');
    expect(back.candidates[0]?.disposition).toBe('accepted');
    expect(back.candidates[0]?.span.sourceId).toBe('src-9');

    // A candidate whose proposedKind is not an element type is dropped on read.
    const malformed = JSON.stringify({
      format: 'unspaghettit-provenance',
      version: 2,
      provenance: {
        featureId: 'feat',
        file: null,
        sourceIds: [],
        spans: [],
        candidates: [
          { id: 'c', summary: 's', proposedKind: 'gizmo', span: { sourceId: 'x', startOffset: 0, endOffset: 1 } }
        ],
        finalized: false,
        updatedAt: 't0'
      }
    });
    expect(importProvenanceFromJson(malformed).candidates).toHaveLength(0);
  });

  it('imports a version-1 sidecar (no sourceIds field)', () => {
    const v1 = JSON.stringify({
      format: 'unspaghettit-provenance',
      version: 1,
      provenance: {
        featureId: 'feat',
        file: {
          id: 'file-1',
          fileName: 'math.ts',
          content: CONTENT,
          byteLength: CONTENT.length,
          contentHash: 'deadbeef',
          attachedAt: 't0'
        },
        spans: [],
        finalized: false,
        updatedAt: 't0'
      }
    });
    const back = importProvenanceFromJson(v1);
    expect(back.file?.fileName).toBe('math.ts');
    expect(back.sourceIds).toEqual([]);
  });

  it('rejects a non-provenance envelope', () => {
    expect(() => importProvenanceFromJson('{"format":"nope","version":1}')).toThrow();
  });
});
