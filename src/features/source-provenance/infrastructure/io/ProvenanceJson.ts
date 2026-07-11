import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';
import {
  ELEMENT_TYPES,
  type ElementType,
  type Provenance,
  type SourceFile,
  type SourceSpan
} from '$features/source-provenance/domain/Provenance';
import {
  CONFLICT_STATUSES,
  type Conflict,
  type ConflictClaim,
  type ConflictStatus
} from '$features/source-provenance/domain/Conflicts';

/**
 * Version history:
 *  - 1: the analyzed document embedded in the sidecar (`provenance.file`).
 *  - 2: adds `provenance.sourceIds` + per-span `sourceId`, pointing at
 *       project-level documents in the owning project's `sources/` folder.
 *       Later additive within v2: `provenance.conflicts` (absent = none), so
 *       older sidecars still parse.
 * Reads accept both; writes always emit version 2.
 */
type Envelope = {
  readonly format: 'unspaghettit-provenance';
  readonly version: 2;
  readonly provenance: Provenance;
};

export const exportProvenanceToJson = (provenance: Provenance): string => {
  const envelope: Envelope = { format: 'unspaghettit-provenance', version: 2, provenance };
  return JSON.stringify(envelope, null, 2);
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const ELEMENT_TYPE_SET: ReadonlySet<ElementType> = new Set(ELEMENT_TYPES);
const CONFLICT_STATUS_SET: ReadonlySet<ConflictStatus> = new Set(CONFLICT_STATUSES);

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const parseFile = (raw: unknown): SourceFile | null => {
  if (!isObject(raw)) return null;
  if (typeof raw.id !== 'string') return null;
  if (typeof raw.fileName !== 'string') return null;
  if (typeof raw.content !== 'string') return null;
  if (typeof raw.attachedAt !== 'string') return null;
  const byteLength = num(raw.byteLength) ?? raw.content.length;
  const contentHash = typeof raw.contentHash === 'string' ? raw.contentHash : '';
  return {
    id: raw.id,
    fileName: raw.fileName,
    content: raw.content,
    byteLength,
    contentHash,
    attachedAt: raw.attachedAt
  };
};

const parseSpan = (raw: unknown): SourceSpan | null => {
  if (!isObject(raw)) return null;
  if (typeof raw.id !== 'string') return null;
  if (typeof raw.elementId !== 'string') return null;
  if (
    typeof raw.elementType !== 'string' ||
    !ELEMENT_TYPE_SET.has(raw.elementType as ElementType)
  ) {
    return null;
  }
  const startOffset = num(raw.startOffset);
  const endOffset = num(raw.endOffset);
  if (startOffset === null || endOffset === null) return null;
  const snippet = typeof raw.snippet === 'string' ? raw.snippet : '';
  return {
    id: raw.id,
    elementId: raw.elementId,
    elementType: raw.elementType as ElementType,
    ...(typeof raw.sourceId === 'string' ? { sourceId: raw.sourceId } : {}),
    startOffset,
    endOffset,
    startLine: num(raw.startLine) ?? 1,
    endLine: num(raw.endLine) ?? 1,
    snippet
  };
};

const parseClaim = (raw: unknown): ConflictClaim | null => {
  if (!isObject(raw)) return null;
  if (typeof raw.sourceId !== 'string') return null;
  if (typeof raw.statement !== 'string') return null;
  return { sourceId: raw.sourceId, statement: raw.statement };
};

const parseConflict = (raw: unknown): Conflict | null => {
  if (!isObject(raw)) return null;
  if (typeof raw.id !== 'string') return null;
  if (typeof raw.summary !== 'string') return null;
  const claims = Array.isArray(raw.claims)
    ? raw.claims.map(parseClaim).filter((c): c is ConflictClaim => c !== null)
    : [];
  if (claims.length < 2) return null;
  const status =
    typeof raw.status === 'string' && CONFLICT_STATUS_SET.has(raw.status as ConflictStatus)
      ? (raw.status as ConflictStatus)
      : 'open';
  const affectedElements = Array.isArray(raw.affectedElements)
    ? raw.affectedElements.filter((e): e is string => typeof e === 'string')
    : [];
  const recordedAt = typeof raw.recordedAt === 'string' ? raw.recordedAt : '';
  return {
    id: raw.id,
    summary: raw.summary,
    claims,
    affectedElements,
    status,
    ...(typeof raw.resolution === 'string' ? { resolution: raw.resolution } : {}),
    ...(typeof raw.resolvedInFavorOf === 'string'
      ? { resolvedInFavorOf: raw.resolvedInFavorOf }
      : {}),
    recordedAt,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : recordedAt
  };
};

export const importProvenanceFromJson = (raw: string): Provenance => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON: ${(err as Error).message}`);
  }
  if (!isObject(parsed)) throw new Error('Expected a provenance envelope');
  if (parsed.format !== 'unspaghettit-provenance') {
    throw new Error('Not an Unspaghettit provenance export (format mismatch)');
  }
  if (parsed.version !== 1 && parsed.version !== 2) {
    throw new Error(`Unsupported provenance version: ${String(parsed.version)}`);
  }
  const prov = parsed.provenance;
  if (!isObject(prov)) throw new Error('Envelope is missing the provenance object');
  if (typeof prov.featureId !== 'string') throw new Error('Provenance missing featureId');
  if (typeof prov.updatedAt !== 'string') throw new Error('Provenance missing updatedAt');
  const spans = Array.isArray(prov.spans)
    ? prov.spans.map(parseSpan).filter((s): s is SourceSpan => s !== null)
    : [];
  const sourceIds = Array.isArray(prov.sourceIds)
    ? prov.sourceIds.filter((s): s is string => typeof s === 'string')
    : [];
  const conflicts = Array.isArray(prov.conflicts)
    ? prov.conflicts.map(parseConflict).filter((c): c is Conflict => c !== null)
    : [];
  return {
    featureId: prov.featureId as FeatureId,
    file: parseFile(prov.file),
    sourceIds,
    spans,
    conflicts,
    finalized: prov.finalized === true,
    updatedAt: prov.updatedAt
  };
};
