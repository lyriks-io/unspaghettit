import { describe, expect, it } from 'vitest';
import type { SourceSpan } from './Provenance';
import { segmentContent, toHighlightedLines } from './Highlighting';

const span = (overrides: Partial<SourceSpan> & { startOffset: number; endOffset: number }): SourceSpan => ({
  id: `s-${overrides.startOffset}`,
  elementId: `el-${overrides.startOffset}`,
  elementType: 'action',
  startLine: 1,
  endLine: 1,
  snippet: '',
  ...overrides
});

describe('segmentContent', () => {
  it('returns one un-highlighted segment when there are no spans', () => {
    const segs = segmentContent('hello world', []);
    expect(segs).toEqual([{ text: 'hello world', span: null }]);
  });

  it('splits content around a span', () => {
    const segs = segmentContent('abcdef', [span({ startOffset: 2, endOffset: 4 })]);
    expect(segs.map((s) => s.text)).toEqual(['ab', 'cd', 'ef']);
    expect(segs[1]?.span?.elementId).toBe('el-2');
    expect(segs[0]?.span).toBeNull();
    expect(segs[2]?.span).toBeNull();
  });

  it('prefers the smallest covering span for nested highlights', () => {
    const outer = span({ startOffset: 0, endOffset: 6, elementId: 'outer' });
    const inner = span({ startOffset: 2, endOffset: 4, elementId: 'inner' });
    const segs = segmentContent('abcdef', [outer, inner]);
    const mid = segs.find((s) => s.text === 'cd');
    expect(mid?.span?.elementId).toBe('inner');
  });

  it('returns nothing for empty content', () => {
    expect(segmentContent('', [span({ startOffset: 0, endOffset: 1 })])).toEqual([]);
  });
});

describe('toHighlightedLines', () => {
  it('numbers lines from 1 and keeps highlights inline', () => {
    const content = 'ab\ncd\nef';
    const lines = toHighlightedLines(content, [span({ startOffset: 3, endOffset: 5 })]);
    expect(lines.map((l) => l.number)).toEqual([1, 2, 3]);
    expect(lines[1]?.tokens[0]?.text).toBe('cd');
    expect(lines[1]?.tokens[0]?.span?.elementId).toBe('el-3');
    expect(lines[0]?.tokens[0]?.span).toBeNull();
  });

  it('yields a trailing empty line for a trailing newline', () => {
    const lines = toHighlightedLines('a\n', []);
    expect(lines).toHaveLength(2);
    expect(lines[1]?.tokens).toEqual([]);
  });
});
