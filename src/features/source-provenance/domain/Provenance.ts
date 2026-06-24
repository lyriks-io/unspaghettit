import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';

/**
 * Source Provenance — the data behind feature 39e57ee0.
 *
 * When an AI agent analyzes an uploaded file and extracts behavior through the
 * MCP, we store the original file alongside the model and stamp every extracted
 * element with the source span it was derived from. The dashboard then renders
 * the file with each span highlighted and linked back to its element.
 *
 * This module is pure (no I/O) so the MCP server, the persistence layer, and the
 * browser viewer all share one definition of what a valid span / attach / finalize
 * is. The guard helpers below mirror the spec's rules one-for-one.
 */

/** The kinds of behavior element a span can be traced to (mirrors the spec enum). */
export const ELEMENT_TYPES = [
  'surface',
  'action',
  'rule',
  'invariant',
  'transition',
  'effect',
  'state',
  'event',
  'entity'
] as const;

export type ElementType = (typeof ELEMENT_TYPES)[number];

/** The uploaded file as stored inside Unspaghettit for provenance. */
export type SourceFile = {
  readonly id: string;
  readonly fileName: string;
  readonly content: string;
  /** UTF-8 size of the content, used for the storage cap and display. */
  readonly byteLength: number;
  /** Non-cryptographic content hash for dedupe / integrity display. */
  readonly contentHash: string;
  readonly attachedAt: string;
};

/** A recorded mapping from one extracted element to the span it came from. */
export type SourceSpan = {
  readonly id: string;
  readonly elementId: string;
  readonly elementType: ElementType;
  /** Character offset where the span starts (inclusive), into SourceFile.content. */
  readonly startOffset: number;
  /** Character offset where the span ends (exclusive). */
  readonly endOffset: number;
  /** 1-based line where the span starts, for display. */
  readonly startLine: number;
  /** 1-based line where the span ends, for display. */
  readonly endLine: number;
  /** The exact source text the element was derived from. */
  readonly snippet: string;
};

/** The provenance sidecar for one feature: the stored file plus its spans. */
export type Provenance = {
  readonly featureId: FeatureId;
  readonly file: SourceFile | null;
  readonly spans: readonly SourceSpan[];
  /** Locked once every extracted element has a span (the finalize gate). */
  readonly finalized: boolean;
  readonly updatedAt: string;
};

/** Discriminated result of a guarded mutation — mirrors the simulator's success/blocked. */
export type ProvenanceResult =
  | { readonly ok: true; readonly provenance: Provenance }
  | { readonly ok: false; readonly reason: string };

/** Default source-file storage cap (1 MiB), matching `source.maxBytes` in the spec. */
export const DEFAULT_MAX_BYTES = 1_048_576;

export const emptyProvenance = (featureId: FeatureId, at: string): Provenance => ({
  featureId,
  file: null,
  spans: [],
  finalized: false,
  updatedAt: at
});

const isElementType = (v: unknown): v is ElementType =>
  typeof v === 'string' && (ELEMENT_TYPES as readonly string[]).includes(v);

/** UTF-8 byte length of a string. TextEncoder is available in both Node and the browser. */
export const byteLengthOf = (content: string): number => new TextEncoder().encode(content).length;

/**
 * FNV-1a 32-bit hash, hex. Not cryptographic — only used to dedupe identical
 * uploads and show an integrity marker, so a fast pure hash beats pulling in
 * node:crypto (which would break the browser viewer that imports this module).
 */
export const hashContent = (content: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) {
    h ^= content.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
};

const lineAtOffset = (content: string, offset: number): number => {
  let line = 1;
  const limit = Math.min(Math.max(offset, 0), content.length);
  for (let i = 0; i < limit; i++) if (content.charCodeAt(i) === 10) line += 1;
  return line;
};

/** 1-based start/end lines for a `[startOffset, endOffset)` span into `content`. */
export const computeSpanLines = (
  content: string,
  startOffset: number,
  endOffset: number
): { startLine: number; endLine: number } => ({
  startLine: lineAtOffset(content, startOffset),
  endLine: lineAtOffset(content, Math.max(startOffset, endOffset - 1))
});

export type AttachInput = {
  readonly id: string;
  readonly fileName: string;
  readonly content: string;
  readonly attachedAt: string;
  readonly maxBytes?: number;
};

/** Store the uploaded file. Mirrors the spec's "Attach Source File" rules. */
export const attachSourceFile = (p: Provenance, input: AttachInput): ProvenanceResult => {
  if (p.finalized) {
    return { ok: false, reason: 'This analysis is finalized; start a new one to attach a different file.' };
  }
  if (p.file) {
    return { ok: false, reason: 'A source file is already stored for this analysis.' };
  }
  const fileName = input.fileName.trim();
  if (fileName.length === 0) return { ok: false, reason: 'A file name is required.' };
  const byteLength = byteLengthOf(input.content);
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;
  if (byteLength > maxBytes) {
    return { ok: false, reason: `File exceeds the provenance storage limit (${maxBytes} bytes).` };
  }
  const file: SourceFile = {
    id: input.id,
    fileName,
    content: input.content,
    byteLength,
    contentHash: hashContent(input.content),
    attachedAt: input.attachedAt
  };
  return { ok: true, provenance: { ...p, file, updatedAt: input.attachedAt } };
};

export type RecordSpanInput = {
  readonly id: string;
  readonly elementId: string;
  readonly elementType: ElementType;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly recordedAt: string;
};

/** Stamp one extracted element with its source span. Mirrors "Record Element Span". */
export const recordSpan = (p: Provenance, input: RecordSpanInput): ProvenanceResult => {
  if (!p.file) return { ok: false, reason: 'Store the source file before recording spans.' };
  if (p.finalized) return { ok: false, reason: 'Analysis is finalized; spans are locked.' };
  if (!isElementType(input.elementType)) {
    return { ok: false, reason: `Unknown element type: ${String(input.elementType)}.` };
  }
  const { startOffset, endOffset } = input;
  if (!Number.isInteger(startOffset) || !Number.isInteger(endOffset) || startOffset < 0) {
    return { ok: false, reason: 'Span offsets must be non-negative integers.' };
  }
  if (startOffset >= endOffset) {
    return { ok: false, reason: 'Span start must come before its end.' };
  }
  if (endOffset > p.file.content.length) {
    return { ok: false, reason: 'Span end is past the end of the stored file.' };
  }
  if (p.spans.some((s) => s.elementId === input.elementId)) {
    return { ok: false, reason: 'This element already has a recorded span.' };
  }
  const { startLine, endLine } = computeSpanLines(p.file.content, startOffset, endOffset);
  const span: SourceSpan = {
    id: input.id,
    elementId: input.elementId,
    elementType: input.elementType,
    startOffset,
    endOffset,
    startLine,
    endLine,
    snippet: p.file.content.slice(startOffset, endOffset)
  };
  return { ok: true, provenance: { ...p, spans: [...p.spans, span], updatedAt: input.recordedAt } };
};

/**
 * Lock the analysis. Mirrors "Finalize Analysis": blocked unless a file is
 * stored and every one of the feature's `expectedElementCount` elements is
 * traced to a span.
 */
export const finalizeProvenance = (
  p: Provenance,
  expectedElementCount: number,
  finalizedAt: string
): ProvenanceResult => {
  if (!p.file) return { ok: false, reason: 'Store and analyze a file before finalizing.' };
  if (p.finalized) return { ok: false, reason: 'Analysis is already finalized.' };
  if (p.spans.length !== expectedElementCount) {
    const untraced = expectedElementCount - p.spans.length;
    return {
      ok: false,
      reason: `Finalize blocked: ${untraced} extracted element(s) have no source span.`
    };
  }
  return { ok: true, provenance: { ...p, finalized: true, updatedAt: finalizedAt } };
};
