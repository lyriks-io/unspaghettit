import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { SourceSpan } from '$features/source-provenance/domain/Provenance';
import type { SourceKind } from '$features/source-provenance/domain/ProjectSource';

/**
 * Codebase adoption: turn provenance spans recorded against `code`-kind
 * sources into behavioral-index entries (`.unspa.json`), so one analysis
 * pass over an existing codebase yields the model, its provenance, AND the
 * spec-to-code mapping that coverage and drift detection run on.
 *
 * Pure module (no I/O): the MCP `seed_index_from_analysis` tool loads the
 * feature, spans, and sources, calls `buildAdoptionEntries`, and persists
 * the merge. Keys and entry shape follow the documented `.unspa.json`
 * contract (the same universe `sync_from_index`'s orphan check and
 * `detectDrift` accept): every traced element gets an entry, including
 * entities, feature-level invariants, surface-declared transitions, and
 * declared-but-unemitted events. Those extra kinds don't surface in the
 * per-action coverage report, but they document where the thing lives and
 * arm drift detection. Only an element that no longer resolves in the
 * feature is returned as `skipped`, never silently dropped.
 */

/** The `.unspa.json` entry shape this module emits (mirrors IndexEntry). */
export type AdoptionIndexEntry = {
  readonly status: 'implemented';
  /** Repo-relative path, taken from the code source's name. */
  readonly file: string;
  /** 1-based line where the span starts. */
  readonly line: number;
  /** One meaningful line from the span, used by the line auto-healer. */
  readonly signature: string;
  readonly auditedAt: string;
  /** Feature updatedAt at seeding time, so drift detection starts armed. */
  readonly specVersion: string;
};

export type AdoptionEntry = {
  readonly key: string;
  readonly elementId: string;
  readonly elementType: string;
  readonly entry: AdoptionIndexEntry;
};

export type AdoptionSkip = {
  readonly elementId: string;
  readonly elementType: string;
  readonly reason: string;
};

export type AdoptionResult = {
  readonly entries: readonly AdoptionEntry[];
  readonly skipped: readonly AdoptionSkip[];
  /** Spans pointing into pasted/file (non-code) sources: fine, just not seedable. */
  readonly nonCodeSpanCount: number;
};

/**
 * Validate + normalize a repo-relative path for a `code` source name.
 * Backslashes are normalized to forward slashes; absolute paths, drive
 * letters, and `..` walks are rejected because the path lands verbatim in
 * `.unspa.json` (LLM-writable, so containment is checked again at read time
 * by the sync tooling, but a bad path should fail loudly at attach time).
 */
export const normalizeRepoPath = (
  raw: string
): { readonly ok: true; readonly path: string } | { readonly ok: false; readonly reason: string } => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, reason: 'A code source needs a file path.' };
  const path = trimmed.replace(/\\/g, '/');
  if (path.startsWith('/') || /^[a-zA-Z]:/.test(path)) {
    return {
      ok: false,
      reason: `Code source paths must be repo-relative (got "${raw}"). Strip the absolute prefix.`
    };
  }
  const segments = path.split('/');
  if (segments.some((s) => s === '..' || s === '.' || s.length === 0)) {
    return {
      ok: false,
      reason: `Code source paths must not contain "..", "." or empty segments (got "${raw}").`
    };
  }
  return { ok: true, path };
};

/** Max length of the signature line stored in an index entry. */
const SIGNATURE_MAX_CHARS = 160;
/** The line auto-healer ignores signatures shorter than this. */
const SIGNATURE_MIN_CHARS = 6;

/**
 * Pick the signature line for an index entry from the span's snippet: the
 * first line long enough for the auto-healer to relocate after refactors,
 * else the first non-empty line, else the trimmed snippet itself.
 */
export const signatureFromSnippet = (snippet: string): string => {
  const lines = snippet.split(/\r?\n/).map((l) => l.trim());
  const healable = lines.find((l) => l.length >= SIGNATURE_MIN_CHARS);
  const chosen = healable ?? lines.find((l) => l.length > 0) ?? snippet.trim();
  return chosen.slice(0, SIGNATURE_MAX_CHARS);
};

type KeyResult =
  | { readonly ok: true; readonly key: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Map one traced element to its `.unspa.json` key. Provenance identifies
 * every element by id, but the index contract is scope-sensitive: an action
 * rule is `rule:<id>` while a surface rule is `surface_rule:<id>`, a state
 * is keyed by its dotted path, an event by its name. Only an element that
 * no longer resolves in the feature is refused, with the reason.
 */
export const deriveIndexKey = (
  feature: Feature,
  elementId: string,
  elementType: string
): KeyResult => {
  switch (elementType) {
    case 'surface':
      return { ok: true, key: `surface:${elementId}` };
    case 'action':
      return { ok: true, key: `action:${elementId}` };
    case 'state': {
      for (const surface of feature.surfaces) {
        const sd = surface.stateDefinitions.find((s) => String(s.id) === elementId);
        if (sd) return { ok: true, key: `state:${String(sd.path)}` };
      }
      return { ok: false, reason: 'State definition not found in the feature.' };
    }
    case 'event': {
      const event = (feature.events ?? []).find((e) => String(e.id) === elementId);
      if (!event) return { ok: false, reason: 'Event not found in the feature.' };
      return { ok: true, key: `event:${String(event.name)}` };
    }
    case 'rule': {
      for (const surface of feature.surfaces) {
        if (surface.rules.some((r) => String(r.id) === elementId)) {
          return { ok: true, key: `surface_rule:${elementId}` };
        }
        for (const action of surface.actions) {
          if (action.rules.some((r) => String(r.id) === elementId)) {
            return { ok: true, key: `rule:${elementId}` };
          }
        }
      }
      return { ok: false, reason: 'Rule not found in the feature.' };
    }
    case 'invariant': {
      for (const surface of feature.surfaces) {
        if (surface.invariants.some((i) => String(i.id) === elementId)) {
          return { ok: true, key: `surface_invariant:${elementId}` };
        }
        for (const action of surface.actions) {
          if (action.invariants.some((i) => String(i.id) === elementId)) {
            return { ok: true, key: `invariant:${elementId}` };
          }
        }
      }
      if ((feature.featureInvariants ?? []).some((i) => String(i.id) === elementId)) {
        return { ok: true, key: `invariant:${elementId}` };
      }
      return { ok: false, reason: 'Invariant not found in the feature.' };
    }
    case 'transition': {
      for (const surface of feature.surfaces) {
        for (const action of surface.actions) {
          if (action.transitions.some((t) => String(t.id) === elementId)) {
            return { ok: true, key: `transition:${elementId}` };
          }
        }
      }
      for (const surface of feature.surfaces) {
        if (surface.transitions.some((t) => String(t.id) === elementId)) {
          return { ok: true, key: `transition:${elementId}` };
        }
      }
      return { ok: false, reason: 'Transition not found in the feature.' };
    }
    case 'entity': {
      if (feature.entities.some((e) => String(e.id) === elementId)) {
        return { ok: true, key: `entity:${elementId}` };
      }
      return { ok: false, reason: 'Entity not found in the feature.' };
    }
    default:
      return { ok: false, reason: `Unsupported element type "${elementType}".` };
  }
};

export type AdoptionSourceMeta = {
  readonly kind: SourceKind;
  /** The source's name; for `code` sources, the repo-relative path. */
  readonly name: string;
};

export type BuildAdoptionInput = {
  readonly feature: Feature;
  readonly spans: readonly SourceSpan[];
  /** Linked sources by id, so each span can be resolved to its source's kind + path. */
  readonly sources: ReadonlyMap<string, AdoptionSourceMeta>;
  readonly auditedAt: string;
  /** The feature's updatedAt, stamped as specVersion on every entry. */
  readonly specVersion: string;
};

/**
 * Turn every span recorded against a `code`-kind source into a ready-to-merge
 * `.unspa.json` entry. Spans against pasted/file sources are counted but not
 * seeded (they trace to prose, not code); an element that no longer resolves
 * in the feature lands in `skipped` with the reason.
 */
export const buildAdoptionEntries = (input: BuildAdoptionInput): AdoptionResult => {
  const entries: AdoptionEntry[] = [];
  const skipped: AdoptionSkip[] = [];
  let nonCodeSpanCount = 0;

  for (const span of input.spans) {
    const source = span.sourceId ? input.sources.get(span.sourceId) : undefined;
    if (!source || source.kind !== 'code') {
      nonCodeSpanCount += 1;
      continue;
    }
    const normalized = normalizeRepoPath(source.name);
    if (!normalized.ok) {
      skipped.push({
        elementId: span.elementId,
        elementType: span.elementType,
        reason: `Source "${source.name}": ${normalized.reason}`
      });
      continue;
    }
    const keyed = deriveIndexKey(input.feature, span.elementId, span.elementType);
    if (!keyed.ok) {
      skipped.push({
        elementId: span.elementId,
        elementType: span.elementType,
        reason: keyed.reason
      });
      continue;
    }
    entries.push({
      key: keyed.key,
      elementId: span.elementId,
      elementType: span.elementType,
      entry: {
        status: 'implemented',
        file: normalized.path,
        line: span.startLine,
        signature: signatureFromSnippet(span.snippet),
        auditedAt: input.auditedAt,
        specVersion: input.specVersion
      }
    });
  }

  return { entries, skipped, nonCodeSpanCount };
};
