import type { SourceSpan } from '$features/source-provenance/domain/Provenance';

/**
 * Pure rendering logic for the Source Viewer: turn a stored file plus its spans
 * into highlighted, line-numbered tokens. Kept out of the Svelte component so it
 * is unit-testable and the UI stays a dumb renderer.
 */

export type HighlightSegment = {
  readonly text: string;
  /** The span this segment belongs to, or null for un-highlighted text. */
  readonly span: SourceSpan | null;
};

export type LineToken = HighlightSegment;

export type HighlightedLine = {
  readonly number: number;
  readonly tokens: readonly LineToken[];
};

const clamp = (n: number, max: number): number => Math.max(0, Math.min(n, max));

/**
 * Split `content` into consecutive segments, each tagged with the span that
 * covers it (or null). Overlapping spans resolve to the *smallest* covering
 * span so a nested rule highlights over its enclosing action rather than being
 * hidden by it.
 */
export const segmentContent = (
  content: string,
  spans: readonly SourceSpan[]
): readonly HighlightSegment[] => {
  if (content.length === 0) return [];
  if (spans.length === 0) return [{ text: content, span: null }];

  const boundaries = new Set<number>([0, content.length]);
  for (const s of spans) {
    boundaries.add(clamp(s.startOffset, content.length));
    boundaries.add(clamp(s.endOffset, content.length));
  }
  const sorted = [...boundaries].sort((a, b) => a - b);

  const segments: HighlightSegment[] = [];
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const a = sorted[i]!;
    const b = sorted[i + 1]!;
    if (a >= b) continue;
    let best: SourceSpan | null = null;
    for (const s of spans) {
      if (s.startOffset <= a && s.endOffset >= b) {
        if (best === null || s.endOffset - s.startOffset < best.endOffset - best.startOffset) {
          best = s;
        }
      }
    }
    segments.push({ text: content.slice(a, b), span: best });
  }
  return segments;
};

/**
 * Segment the content and break it into 1-based numbered lines, so the viewer
 * can render a line gutter with inline highlights. A trailing newline yields a
 * final empty line, matching how editors display files.
 */
export const toHighlightedLines = (
  content: string,
  spans: readonly SourceSpan[]
): readonly HighlightedLine[] => {
  const segments = segmentContent(content, spans);
  const lines: HighlightedLine[] = [];
  let current: LineToken[] = [];
  let lineNumber = 1;

  const pushLine = (): void => {
    lines.push({ number: lineNumber, tokens: current });
    current = [];
    lineNumber += 1;
  };

  for (const segment of segments) {
    const parts = segment.text.split('\n');
    for (let i = 0; i < parts.length; i += 1) {
      if (i > 0) pushLine();
      if (parts[i]!.length > 0) current.push({ text: parts[i]!, span: segment.span });
    }
  }
  pushLine();
  return lines;
};
