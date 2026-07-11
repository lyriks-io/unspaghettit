import { DEFAULT_MAX_BYTES, byteLengthOf, hashContent } from './Provenance';

/**
 * Project-level source store: the documents behind Source Provenance.
 *
 * A ProjectSource is one text document (a pasted PRD, an attached file)
 * stored in the owning project's `sources/` folder. Sources are IMMUTABLE
 * once stored and deduplicated by content hash: pasting the same text twice
 * resolves to the existing source, and an updated document is a NEW source
 * that records which one it supersedes. Spans reference a source by id, so
 * they stay valid forever against the exact text they were recorded on.
 *
 * Pure module (no I/O), shared by the MCP server, the dashboard API, and the
 * browser panel, mirroring how Provenance.ts is shared.
 */

/**
 * What the source is and how it arrived: pasted in the dashboard, attached as
 * a document by an agent, or attached as a snapshot of a source-code file
 * during codebase adoption. A `code` source's `name` IS its repo-relative
 * file path (e.g. `src/lib/cart.ts`), which is what lets a span recorded
 * against it double as an implementation location in `.unspa.json`.
 */
export const SOURCE_KINDS = ['pasted', 'file', 'code'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/**
 * How much this source is allowed to SETTLE a disagreement, not just how it
 * arrived. When two sources describe the same behavior differently, the one
 * with the higher authority wins rather than whichever was ingested last:
 *
 *  - `normative`   the source of truth for intended behavior (a signed
 *                  contract, an accepted spec, the API schema a client must obey)
 *  - `supporting`  evidences behavior but isn't the authority on intent
 *                  (implementation code, tests, internal docs)
 *  - `observed`    a report of what happens in the wild, not a decision
 *                  (an interview, a log, a captured trace)
 *  - `unknown`     not yet ranked (the honest default)
 */
export const SOURCE_AUTHORITIES = ['normative', 'supporting', 'observed', 'unknown'] as const;
export type SourceAuthority = (typeof SOURCE_AUTHORITIES)[number];

/**
 * What KIND of artifact the source is — the audit's second axis, named
 * `artifact` (not `kind`) so it doesn't collide with the arrival-mode `kind`
 * above. Informs a default authority when none is stated (see
 * `defaultAuthorityForArtifact`), so tagging a source `contract` is enough to
 * make it outrank a `documentation` source without spelling out the authority.
 */
export const SOURCE_ARTIFACTS = [
  'implementation',
  'test',
  'contract',
  'documentation',
  'interview'
] as const;
export type SourceArtifact = (typeof SOURCE_ARTIFACTS)[number];

export type ProjectSource = {
  readonly id: string;
  /** Owning project id, or null when the linked feature is unassigned. */
  readonly projectId: string | null;
  /** Human name ("Checkout PRD v2") or the original file name. */
  readonly name: string;
  readonly kind: SourceKind;
  /**
   * Evidentiary weight, used to resolve contradictions by authority rather than
   * ingestion order. Absent = derived from `artifact`, else `unknown`; read it
   * through `effectiveAuthority` so the default policy lives in one place.
   */
  readonly authority?: SourceAuthority;
  /** What kind of artifact this is (implementation, test, contract, …). Absent = unclassified. */
  readonly artifact?: SourceArtifact;
  /** The document text, verbatim and immutable. */
  readonly content: string;
  /** UTF-8 size of the content, used for the storage cap and display. */
  readonly byteLength: number;
  /** Non-cryptographic content hash: the dedupe / integrity key. */
  readonly contentHash: string;
  readonly attachedAt: string;
  /** Id of the older source this one replaces, or null for a first version. */
  readonly supersedes: string | null;
};

/** Comparable strength of each authority level (higher wins a contradiction). */
export const authorityRank: Readonly<Record<SourceAuthority, number>> = {
  normative: 3,
  supporting: 2,
  observed: 1,
  unknown: 0
};

/**
 * Default authority for a source that declared its artifact but not its
 * authority. A contract is normative; code, tests and docs support; an
 * interview is an observation. Conservative on purpose: code is `supporting`,
 * not `normative`, because what the code does is evidence of behavior, not a
 * decision about what the behavior should be.
 */
export const defaultAuthorityForArtifact = (artifact: SourceArtifact): SourceAuthority => {
  switch (artifact) {
    case 'contract':
      return 'normative';
    case 'implementation':
    case 'test':
    case 'documentation':
      return 'supporting';
    case 'interview':
      return 'observed';
  }
};

/**
 * The authority to actually rank a source by: an explicit `authority` always
 * wins; otherwise it's derived from the `artifact`; otherwise `unknown`.
 * Deriving at read time (rather than freezing a value at attach time) keeps
 * storage minimal and lets the default policy change without rewriting sources.
 */
export const effectiveAuthority = (
  s: Pick<ProjectSource, 'authority' | 'artifact'>
): SourceAuthority =>
  s.authority ?? (s.artifact ? defaultAuthorityForArtifact(s.artifact) : 'unknown');

/** Listing shape: everything except the content itself. */
export type ProjectSourceMeta = Omit<ProjectSource, 'content'>;

export const toSourceMeta = (s: ProjectSource): ProjectSourceMeta => ({
  id: s.id,
  projectId: s.projectId,
  name: s.name,
  kind: s.kind,
  ...(s.authority !== undefined ? { authority: s.authority } : {}),
  ...(s.artifact !== undefined ? { artifact: s.artifact } : {}),
  byteLength: s.byteLength,
  contentHash: s.contentHash,
  attachedAt: s.attachedAt,
  supersedes: s.supersedes
});

export type CreateSourceInput = {
  readonly id: string;
  readonly projectId: string | null;
  readonly name: string;
  readonly kind: SourceKind;
  readonly authority?: SourceAuthority;
  readonly artifact?: SourceArtifact;
  readonly content: string;
  readonly attachedAt: string;
  readonly maxBytes?: number;
  readonly supersedes?: string | null;
};

/** Guarded creation result. `deduped` marks a paste that resolved to an existing source. */
export type CreateSourceResult =
  | { readonly ok: true; readonly source: ProjectSource; readonly deduped: boolean }
  | { readonly ok: false; readonly reason: string };

/**
 * Create a new source, or resolve to an existing one when the content hash
 * matches (dedupe). Mirrors the spec's "Paste Source Text" rules: name
 * required, content required, size capped.
 */
export const createProjectSource = (
  input: CreateSourceInput,
  existing: readonly ProjectSource[]
): CreateSourceResult => {
  const name = input.name.trim();
  if (name.length === 0) {
    return { ok: false, reason: 'Name the source so you can find it later.' };
  }
  if (input.content.length === 0) {
    return { ok: false, reason: "Paste some text first, the source can't be empty." };
  }
  const byteLength = byteLengthOf(input.content);
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;
  if (byteLength > maxBytes) {
    return {
      ok: false,
      reason: `The text exceeds the per-source storage cap (${maxBytes} bytes).`
    };
  }
  const contentHash = hashContent(input.content);
  const duplicate = existing.find(
    (s) => s.contentHash === contentHash && s.content === input.content
  );
  // Dedupe resolves to the existing source, so its classification wins over the
  // re-attach's; use classifySource to (re)tag an already-stored document.
  if (duplicate) return { ok: true, source: duplicate, deduped: true };
  return {
    ok: true,
    deduped: false,
    source: {
      id: input.id,
      projectId: input.projectId,
      name,
      kind: input.kind,
      ...(input.authority !== undefined ? { authority: input.authority } : {}),
      ...(input.artifact !== undefined ? { artifact: input.artifact } : {}),
      content: input.content,
      byteLength,
      contentHash,
      attachedAt: input.attachedAt,
      supersedes: input.supersedes ?? null
    }
  };
};

export type ClassifyInput = {
  readonly authority?: SourceAuthority;
  readonly artifact?: SourceArtifact;
};

/**
 * Re-tag a stored source's authority / artifact. Metadata only: content,
 * hash, id and every other field are untouched, so the immutability contract
 * (which is about the document text, not its classification) still holds and
 * the source stays at the same place on disk. A field left `undefined` in the
 * patch is preserved; pass `null`-like intent by not calling this at all.
 */
export const classifySource = (source: ProjectSource, patch: ClassifyInput): ProjectSource => ({
  ...source,
  ...(patch.authority !== undefined ? { authority: patch.authority } : {}),
  ...(patch.artifact !== undefined ? { artifact: patch.artifact } : {})
});
