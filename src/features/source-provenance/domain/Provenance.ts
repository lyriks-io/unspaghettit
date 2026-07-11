import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';
import type { Conflict } from './Conflicts';
import type { BehaviorCandidate } from './Candidates';

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
  /**
   * Id of the project-level source this span points into. Absent on legacy
   * spans recorded against the embedded `Provenance.file` document.
   */
  readonly sourceId?: string;
  /** Character offset where the span starts (inclusive), into the document. */
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

/**
 * The provenance sidecar for one feature: its recorded spans plus the
 * documents behind them. New analyses link project-level sources by id
 * (`sourceIds`); `file` only survives on legacy sidecars whose document was
 * embedded before the project source store existed.
 */
export type Provenance = {
  readonly featureId: FeatureId;
  readonly file: SourceFile | null;
  /** Project-level sources linked to this analysis. */
  readonly sourceIds: readonly string[];
  readonly spans: readonly SourceSpan[];
  /**
   * Recorded disagreements between the linked sources. An `open` conflict is an
   * undecided behavior: a hole in the analysis's completeness, distinct from an
   * untraced element (a hole in its attribution).
   */
  readonly conflicts: readonly Conflict[];
  /**
   * Behaviors read from the sources, each with a review disposition, staged
   * before (or instead of) committing to the model. This is what lets source
   * coverage account for every extracted span, not just the modeled ones.
   */
  readonly candidates: readonly BehaviorCandidate[];
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
  sourceIds: [],
  spans: [],
  conflicts: [],
  candidates: [],
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

/**
 * LEGACY: store the uploaded file embedded in the sidecar (pre source-store
 * format). New attaches go through `createProjectSource` + `linkSource`; this
 * stays so v1 sidecars keep their exact semantics and for the migration tests.
 */
export const attachSourceFile = (p: Provenance, input: AttachInput): ProvenanceResult => {
  if (p.finalized) {
    return {
      ok: false,
      reason: 'This analysis is finalized; start a new one to attach a different file.'
    };
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

/**
 * Link a project-level source to this feature's analysis. Idempotent when the
 * source is already linked; blocked once the analysis is finalized.
 */
export const linkSource = (p: Provenance, sourceId: string, linkedAt: string): ProvenanceResult => {
  if (p.finalized) {
    return {
      ok: false,
      reason: 'This analysis is finalized; start a new one to link another source.'
    };
  }
  if (p.sourceIds.includes(sourceId)) return { ok: true, provenance: p };
  return {
    ok: true,
    provenance: { ...p, sourceIds: [...p.sourceIds, sourceId], updatedAt: linkedAt }
  };
};

export type RecordSpanInput = {
  readonly id: string;
  readonly elementId: string;
  readonly elementType: ElementType;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly recordedAt: string;
  /**
   * The resolved project source the span points into. When absent, the span
   * is validated against the legacy embedded `Provenance.file` document.
   */
  readonly source?: { readonly id: string; readonly content: string };
};

/** Stamp one extracted element with its source span. Mirrors "Record Element Span". */
export const recordSpan = (p: Provenance, input: RecordSpanInput): ProvenanceResult => {
  const content = input.source?.content ?? p.file?.content;
  if (content === undefined) {
    return { ok: false, reason: 'Store a source document before recording spans.' };
  }
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
  if (endOffset > content.length) {
    return { ok: false, reason: 'Span end is past the end of the stored document.' };
  }
  if (p.spans.some((s) => s.elementId === input.elementId)) {
    return { ok: false, reason: 'This element already has a recorded span.' };
  }
  const { startLine, endLine } = computeSpanLines(content, startOffset, endOffset);
  const span: SourceSpan = {
    id: input.id,
    elementId: input.elementId,
    elementType: input.elementType,
    ...(input.source ? { sourceId: input.source.id } : {}),
    startOffset,
    endOffset,
    startLine,
    endLine,
    snippet: content.slice(startOffset, endOffset)
  };
  // Recording against a source implicitly links it, so a span can never
  // reference a document the analysis doesn't know about.
  const sourceIds =
    input.source && !p.sourceIds.includes(input.source.id)
      ? [...p.sourceIds, input.source.id]
      : p.sourceIds;
  return {
    ok: true,
    provenance: { ...p, sourceIds, spans: [...p.spans, span], updatedAt: input.recordedAt }
  };
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
  if (!p.file && p.sourceIds.length === 0) {
    return { ok: false, reason: 'Store and analyze a source document before finalizing.' };
  }
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
