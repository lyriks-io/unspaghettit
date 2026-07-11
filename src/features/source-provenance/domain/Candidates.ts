import { computeSpanLines, type ElementType } from './Provenance';

/**
 * Candidate staging — the dual of a recorded span. A `SourceSpan` says "this
 * modeled element came from that source range" (attribution). A
 * `BehaviorCandidate` says "that source range proposes a behavior" BEFORE it is
 * committed to the authoritative model, and carries a `disposition` so a
 * reviewed behavior is distinguishable from an unreviewed guess. Together they
 * make "what in this source did we NOT model, and why?" an answerable question
 * instead of an invisible gap.
 *
 * Pure module (no I/O), shared by the MCP server and the viewer. Candidates
 * live on the per-feature Provenance sidecar; these helpers operate on a plain
 * `BehaviorCandidate[]` so the dependency on Provenance stays one-way (this
 * module only borrows `computeSpanLines` + the `ElementType` union).
 */

/**
 * What became of a staged candidate. `unreviewed` is the honest default;
 * `accepted` reached the model; `merged` folded into another candidate/element
 * (a duplicate); `rejected` / `out_of_scope` were deliberately excluded;
 * `conflict` is tied up in an open disagreement (see Conflicts.ts).
 */
export const CANDIDATE_DISPOSITIONS = [
  'unreviewed',
  'accepted',
  'rejected',
  'merged',
  'conflict',
  'out_of_scope'
] as const;
export type CandidateDisposition = (typeof CANDIDATE_DISPOSITIONS)[number];

/** Where in a source a candidate behavior was read from. */
export type CandidateSpan = {
  readonly sourceId: string;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly startLine: number;
  readonly endLine: number;
  readonly snippet: string;
};

export type BehaviorCandidate = {
  readonly id: string;
  readonly span: CandidateSpan;
  /** The element type this candidate proposes to become. */
  readonly proposedKind: ElementType;
  /** Plain-language description of the behavior read from the span. */
  readonly summary: string;
  /** Extractor confidence, 0..1. */
  readonly confidence: number;
  readonly disposition: CandidateDisposition;
  /** Why it landed at this disposition (required narration for a review decision). */
  readonly rationale?: string;
  /** The modeled element it maps to, once `accepted` or `merged`. */
  readonly elementId?: string;
  readonly recordedAt: string;
  readonly updatedAt: string;
};

export type CandidateResult =
  | {
      readonly ok: true;
      readonly candidates: readonly BehaviorCandidate[];
      readonly candidate: BehaviorCandidate;
    }
  | { readonly ok: false; readonly reason: string };

export type StageCandidateInput = {
  readonly id: string;
  readonly sourceId: string;
  /** The stored source text, to validate the offsets and slice the snippet. */
  readonly sourceContent: string;
  readonly proposedKind: ElementType;
  readonly summary: string;
  /** Defaults to 0.5 when the extractor gives no confidence. */
  readonly confidence?: number;
  readonly startOffset: number;
  readonly endOffset: number;
  /** Defaults to `unreviewed`. */
  readonly disposition?: CandidateDisposition;
  readonly at: string;
};

/**
 * Stage one proposed behavior read from a source span. Same offset validation
 * as `recordSpan`, so a candidate span can never point outside its source.
 */
export const stageCandidate = (
  candidates: readonly BehaviorCandidate[],
  input: StageCandidateInput
): CandidateResult => {
  const summary = input.summary.trim();
  if (summary.length === 0) {
    return { ok: false, reason: 'A candidate needs a plain-language summary of the behavior.' };
  }
  const { startOffset, endOffset } = input;
  if (!Number.isInteger(startOffset) || !Number.isInteger(endOffset) || startOffset < 0) {
    return { ok: false, reason: 'Span offsets must be non-negative integers.' };
  }
  if (startOffset >= endOffset) {
    return { ok: false, reason: 'Span start must come before its end.' };
  }
  if (endOffset > input.sourceContent.length) {
    return { ok: false, reason: 'Span end is past the end of the source.' };
  }
  const confidence = input.confidence ?? 0.5;
  if (!(confidence >= 0 && confidence <= 1)) {
    return { ok: false, reason: 'Confidence must be between 0 and 1.' };
  }
  const { startLine, endLine } = computeSpanLines(input.sourceContent, startOffset, endOffset);
  const candidate: BehaviorCandidate = {
    id: input.id,
    span: {
      sourceId: input.sourceId,
      startOffset,
      endOffset,
      startLine,
      endLine,
      snippet: input.sourceContent.slice(startOffset, endOffset)
    },
    proposedKind: input.proposedKind,
    summary,
    confidence,
    disposition: input.disposition ?? 'unreviewed',
    recordedAt: input.at,
    updatedAt: input.at
  };
  return { ok: true, candidates: [...candidates, candidate], candidate };
};

export type DisposeCandidateInput = {
  readonly id: string;
  readonly disposition: CandidateDisposition;
  readonly rationale?: string;
  /** The modeled element this candidate became; required for `accepted` / `merged`. */
  readonly elementId?: string;
  readonly at: string;
};

/**
 * Review a staged candidate: move it from `unreviewed` to a decision. A
 * candidate that reached the model (`accepted`) or folded into another
 * (`merged`) must name the element it maps to, so acceptance is always
 * traceable back to a real element.
 */
export const disposeCandidate = (
  candidates: readonly BehaviorCandidate[],
  input: DisposeCandidateInput
): CandidateResult => {
  const idx = candidates.findIndex((c) => c.id === input.id);
  if (idx < 0) return { ok: false, reason: `No candidate "${input.id}" on this analysis.` };
  const mapsToElement = input.disposition === 'accepted' || input.disposition === 'merged';
  if (mapsToElement && (input.elementId === undefined || input.elementId.length === 0)) {
    return {
      ok: false,
      reason: `Disposition "${input.disposition}" must name the modeled element it maps to (elementId).`
    };
  }
  const target = candidates[idx]!;
  const rationale = input.rationale?.trim();
  // Rebuilt (not spread) so a disposition that no longer maps to an element
  // drops a stale `elementId` instead of carrying the old one forward.
  const updated: BehaviorCandidate = {
    id: target.id,
    span: target.span,
    proposedKind: target.proposedKind,
    summary: target.summary,
    confidence: target.confidence,
    recordedAt: target.recordedAt,
    disposition: input.disposition,
    ...(rationale ? { rationale } : {}),
    ...(mapsToElement ? { elementId: input.elementId! } : {}),
    updatedAt: input.at
  };
  const next = [...candidates];
  next[idx] = updated;
  return { ok: true, candidate: updated, candidates: next };
};
