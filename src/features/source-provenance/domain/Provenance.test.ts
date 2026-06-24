import { describe, expect, it } from 'vitest';
import { asFeatureId } from '$features/behavior-model/domain/value-objects/ids';
import {
  attachSourceFile,
  computeSpanLines,
  emptyProvenance,
  finalizeProvenance,
  recordSpan,
  type Provenance
} from './Provenance';
import {
  exportProvenanceToJson,
  importProvenanceFromJson
} from '$features/source-provenance/infrastructure/io/ProvenanceJson';

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
    const lines = computeSpanLines(CONTENT, CONTENT.indexOf('return'), CONTENT.indexOf('return') + 6);
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

  it('rejects a non-provenance envelope', () => {
    expect(() => importProvenanceFromJson('{"format":"nope","version":1}')).toThrow();
  });
});
