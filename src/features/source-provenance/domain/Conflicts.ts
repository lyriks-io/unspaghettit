import { authorityRank, type SourceAuthority } from './ProjectSource';

/**
 * Source conflicts — the data behind "two sources disagree about the same
 * behavior". Provenance proves every element came from somewhere; a Conflict
 * records that the somewheres contradict each other, instead of silently
 * taking whichever was ingested last. A conflict left `open` is a hole in a
 * project's completeness claim: the behavior is genuinely undecided.
 *
 * Pure module (no I/O), shared by the MCP server and the viewer, mirroring how
 * Provenance.ts and ProjectSource.ts are shared. Conflicts live on the
 * per-feature Provenance sidecar (next to the spans they dispute), but these
 * helpers operate on a plain `Conflict[]` so this module never has to import
 * the Provenance type back (keeping the dependency one-way).
 */

export const CONFLICT_STATUSES = ['open', 'resolved', 'accepted_ambiguity'] as const;
export type ConflictStatus = (typeof CONFLICT_STATUSES)[number];

/** One source's position in a disagreement. */
export type ConflictClaim = {
  readonly sourceId: string;
  /** What this source says about the disputed behavior, in plain language. */
  readonly statement: string;
};

export type Conflict = {
  readonly id: string;
  /** One line naming what is in dispute. */
  readonly summary: string;
  /** The disagreeing positions (at least two), each attributed to its source. */
  readonly claims: readonly ConflictClaim[];
  /** Ids of the model elements this disagreement bears on (may be empty). */
  readonly affectedElements: readonly string[];
  readonly status: ConflictStatus;
  /** How it was settled. Present once the status leaves `open`. */
  readonly resolution?: string;
  /** The source whose claim was taken as authoritative, when resolved that way. */
  readonly resolvedInFavorOf?: string;
  readonly recordedAt: string;
  readonly updatedAt: string;
};

export type ConflictResult =
  | { readonly ok: true; readonly conflicts: readonly Conflict[]; readonly conflict: Conflict }
  | { readonly ok: false; readonly reason: string };

/** Conflicts still holding up a completeness claim (not yet resolved or accepted). */
export const openConflicts = (conflicts: readonly Conflict[]): readonly Conflict[] =>
  conflicts.filter((c) => c.status === 'open');

export type AddConflictInput = {
  readonly id: string;
  readonly summary: string;
  readonly claims: readonly ConflictClaim[];
  readonly affectedElements: readonly string[];
  readonly at: string;
};

/** Record a new disagreement. Starts `open`; blocked unless it has a summary and >=2 distinct-source claims. */
export const addConflict = (
  conflicts: readonly Conflict[],
  input: AddConflictInput
): ConflictResult => {
  const summary = input.summary.trim();
  if (summary.length === 0) {
    return { ok: false, reason: 'A conflict needs a one-line summary of what is in dispute.' };
  }
  if (input.claims.length < 2) {
    return { ok: false, reason: 'A conflict needs at least two disagreeing claims.' };
  }
  const claims: ConflictClaim[] = [];
  const seen = new Set<string>();
  for (const c of input.claims) {
    const statement = c.statement.trim();
    if (statement.length === 0) {
      return { ok: false, reason: 'Every claim needs a statement of what its source says.' };
    }
    if (seen.has(c.sourceId)) {
      return { ok: false, reason: 'Each claim must come from a distinct source.' };
    }
    seen.add(c.sourceId);
    claims.push({ sourceId: c.sourceId, statement });
  }
  const conflict: Conflict = {
    id: input.id,
    summary,
    claims,
    affectedElements: input.affectedElements,
    status: 'open',
    recordedAt: input.at,
    updatedAt: input.at
  };
  return { ok: true, conflicts: [...conflicts, conflict], conflict };
};

export type ResolveConflictInput = {
  readonly id: string;
  readonly status: 'resolved' | 'accepted_ambiguity';
  readonly resolution: string;
  /** Optional: the claim source the resolution sided with (must be one of the claims). */
  readonly resolvedInFavorOf?: string;
  readonly at: string;
};

/**
 * Settle a conflict: `resolved` (one reading won) or `accepted_ambiguity` (the
 * disagreement is real and left in the open, on purpose). Either way a written
 * `resolution` is required, so a closed conflict always records WHY.
 */
export const resolveConflict = (
  conflicts: readonly Conflict[],
  input: ResolveConflictInput
): ConflictResult => {
  const idx = conflicts.findIndex((c) => c.id === input.id);
  if (idx < 0) return { ok: false, reason: `No conflict "${input.id}" on this analysis.` };
  const resolution = input.resolution.trim();
  if (resolution.length === 0) {
    return { ok: false, reason: 'Say how the conflict was settled (a resolution is required).' };
  }
  const target = conflicts[idx]!;
  if (
    input.resolvedInFavorOf !== undefined &&
    !target.claims.some((c) => c.sourceId === input.resolvedInFavorOf)
  ) {
    return { ok: false, reason: "resolvedInFavorOf must be one of the conflict's claim sources." };
  }
  const updated: Conflict = {
    ...target,
    status: input.status,
    resolution,
    ...(input.resolvedInFavorOf !== undefined
      ? { resolvedInFavorOf: input.resolvedInFavorOf }
      : {}),
    updatedAt: input.at
  };
  const next = [...conflicts];
  next[idx] = updated;
  return { ok: true, conflicts: next, conflict: updated };
};

export type ConflictSuggestion =
  | { readonly kind: 'winner'; readonly sourceId: string; readonly authority: SourceAuthority }
  | { readonly kind: 'ambiguous'; readonly authority: SourceAuthority; readonly sourceIds: readonly string[] };

/**
 * The whole point of ranking sources: a conflict where one claim comes from a
 * strictly higher-authority source than every other has a suggested winner.
 * When the top authority is shared (two normative sources, or all unknown),
 * authority cannot break the tie: it is genuine ambiguity for a human to
 * resolve or accept. `authorityOf` resolves each source's effective authority.
 */
export const suggestConflictWinner = (
  claims: readonly ConflictClaim[],
  authorityOf: (sourceId: string) => SourceAuthority
): ConflictSuggestion => {
  const ranked = claims.map((c) => {
    const authority = authorityOf(c.sourceId);
    return { sourceId: c.sourceId, authority, rank: authorityRank[authority] };
  });
  const top = Math.max(...ranked.map((r) => r.rank));
  const leaders = ranked.filter((r) => r.rank === top);
  const authority = leaders[0]!.authority;
  if (leaders.length === 1) {
    return { kind: 'winner', sourceId: leaders[0]!.sourceId, authority };
  }
  return { kind: 'ambiguous', authority, sourceIds: leaders.map((l) => l.sourceId) };
};
