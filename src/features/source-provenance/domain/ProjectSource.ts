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

/** How the document arrived: pasted in the dashboard, or attached by an agent. */
export const SOURCE_KINDS = ['pasted', 'file'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export type ProjectSource = {
  readonly id: string;
  /** Owning project id, or null when the linked feature is unassigned. */
  readonly projectId: string | null;
  /** Human name ("Checkout PRD v2") or the original file name. */
  readonly name: string;
  readonly kind: SourceKind;
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

/** Listing shape: everything except the content itself. */
export type ProjectSourceMeta = Omit<ProjectSource, 'content'>;

export const toSourceMeta = (s: ProjectSource): ProjectSourceMeta => ({
  id: s.id,
  projectId: s.projectId,
  name: s.name,
  kind: s.kind,
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
  if (duplicate) return { ok: true, source: duplicate, deduped: true };
  return {
    ok: true,
    deduped: false,
    source: {
      id: input.id,
      projectId: input.projectId,
      name,
      kind: input.kind,
      content: input.content,
      byteLength,
      contentHash,
      attachedAt: input.attachedAt,
      supersedes: input.supersedes ?? null
    }
  };
};
