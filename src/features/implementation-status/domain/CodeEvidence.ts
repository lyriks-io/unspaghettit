import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { SourceSpan } from '$features/source-provenance/domain/Provenance';
import {
  deriveIndexKey,
  normalizeRepoPath,
  type AdoptionSourceMeta
} from '$features/source-provenance/domain/CodeAdoption';

/**
 * Code evidence for spec↔code mappings: one concept, whichever direction the
 * mapping came from (adopting existing code, implementing from the spec, or
 * tracing code that was written without one).
 *
 * A reported location is only worth trusting when the server holds the code
 * it points at. Evidence comes from exactly three places, tried in order:
 *
 *   1. The caller sent the code itself (`snippet` on the location).
 *   2. The server can read the checkout and slice the file at the line.
 *   3. The adoption flow attached the source file and recorded a span for the
 *      element, so the code is already stored server-side.
 *
 * A location that exhausts all three is stamped `unverified`: kept, since it
 * is still a claim worth listing, but displayed as a claim, never as proof.
 *
 * Pure module (no I/O): callers pass a `readLines` function and the span
 * evidence map; the MCP tool layer owns the filesystem and repositories.
 */

/** One recorded span, resolved to its code source, ready to back a location. */
export type SpanEvidence = {
  /** Normalized repo-relative path of the span's source file. */
  readonly file: string;
  /** 1-based line where the span starts. */
  readonly startLine: number;
  /** 1-based line where the span ends. */
  readonly endLine: number;
  /** Capped slice of the span's source text (see capSnippet). */
  readonly snippet: string;
};

/** Shape every reported location shares, whatever transport it rode in on. */
export type ClaimedLocation = {
  readonly file: string;
  readonly line?: number;
  readonly snippet?: string;
};

/** Keep stored snippets short: evidence is a glimpse, not a mirror of the file. */
export const EVIDENCE_SNIPPET_MAX_LINES = 3;

export const capSnippet = (
  snippet: string,
  maxLines: number = EVIDENCE_SNIPPET_MAX_LINES
): string => {
  const lines = snippet.split(/\r?\n/);
  if (lines.length <= maxLines) return snippet;
  return [...lines.slice(0, maxLines), '…'].join('\n');
};

/** Normalize a caller-claimed path for comparison with attached source paths. */
export const normalizeClaimedPath = (file: string): string => {
  let p = file.replace(/\\/g, '/').trim();
  while (p.startsWith('./')) p = p.slice(2);
  return p;
};

/**
 * A ±1 slice of real file lines around a 1-based line: the snippet shown
 * beside a location when the server can read the file itself.
 */
export const sliceAround = (
  lines: readonly string[],
  line: number,
  before = 1,
  after = 1
): string | undefined => {
  if (line <= 0) return undefined;
  const start = Math.max(0, line - 1 - before);
  const end = Math.min(lines.length, line + after);
  if (start >= end) return undefined;
  return lines.slice(start, end).join('\n');
};

/**
 * Resolve every recorded span into evidence keyed by the REPORT entity space
 * (`<entityType>:<entityId>` as report_implementation_status receives it).
 * Reuses `deriveIndexKey` so scope resolution (rule vs surface_rule, state
 * path, event name) stays defined in exactly one place; the only translations
 * on top of it are the report-space quirks: an `entity` span answers as
 * `data:<id>`, and a state answers to BOTH its dotted path and its hex id
 * (the report tool accepts either).
 */
export const buildSpanEvidenceMap = (
  feature: Feature,
  spans: readonly SourceSpan[],
  sources: ReadonlyMap<string, AdoptionSourceMeta>
): ReadonlyMap<string, readonly SpanEvidence[]> => {
  const out = new Map<string, SpanEvidence[]>();
  const add = (key: string, ev: SpanEvidence): void => {
    const arr = out.get(key);
    if (arr) arr.push(ev);
    else out.set(key, [ev]);
  };
  for (const span of spans) {
    const source = span.sourceId ? sources.get(span.sourceId) : undefined;
    if (!source || source.kind !== 'code') continue;
    const normalized = normalizeRepoPath(source.name);
    if (!normalized.ok) continue;
    const keyed = deriveIndexKey(feature, span.elementId, span.elementType);
    if (!keyed.ok) continue;
    const ev: SpanEvidence = {
      file: normalized.path,
      startLine: span.startLine,
      endLine: span.endLine,
      snippet: capSnippet(span.snippet)
    };
    if (keyed.key.startsWith('entity:')) {
      add(`data:${span.elementId}`, ev);
    } else if (keyed.key.startsWith('state:')) {
      add(keyed.key, ev);
      add(`state:${span.elementId}`, ev);
    } else {
      add(keyed.key, ev);
    }
  }
  return out;
};

/**
 * Complete one claimed location with code evidence, or stamp it `unverified`.
 *
 * Order matters: a caller-supplied snippet wins (it is the code the caller
 * actually looked at), then a real slice of the checkout, then the recorded
 * span. Only a span whose source file matches the claimed file counts,
 * because showing code from a different file under this location would
 * manufacture confidence instead of earning it. When several spans back the
 * same element in the same file, the one covering the claimed line wins.
 */
export const enrichLocation = <T extends ClaimedLocation>(
  loc: T,
  evidence: readonly SpanEvidence[],
  readLines?: ((file: string) => readonly string[] | null) | null
): T & { line?: number; snippet?: string; unverified?: true } => {
  if (loc.snippet) return loc;
  if (readLines && loc.line !== undefined && loc.line > 0) {
    const lines = readLines(loc.file);
    if (lines) {
      const snippet = sliceAround(lines, loc.line);
      if (snippet) return { ...loc, snippet };
    }
  }
  const claimed = normalizeClaimedPath(loc.file);
  const inFile = evidence.filter((s) => s.file === claimed);
  const span =
    inFile.find(
      (s) =>
        loc.line !== undefined && loc.line >= s.startLine - 2 && loc.line <= s.endLine + 2
    ) ?? inFile[0];
  if (span) {
    return {
      ...loc,
      ...(loc.line === undefined ? { line: span.startLine } : {}),
      snippet: span.snippet
    };
  }
  return { ...loc, unverified: true };
};
