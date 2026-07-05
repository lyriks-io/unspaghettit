import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';
import {
  ELEMENT_TYPES,
  type ElementType,
  type Provenance,
  type SourceFile,
  type SourceSpan
} from '$features/source-provenance/domain/Provenance';

/**
 * Version history:
 *  - 1: the analyzed document embedded in the sidecar (`provenance.file`).
 *  - 2: adds `provenance.sourceIds` + per-span `sourceId`, pointing at
 *       project-level documents in the owning project's `sources/` folder.
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
  return {
    featureId: prov.featureId as FeatureId,
    file: parseFile(prov.file),
    sourceIds,
    spans,
    finalized: prov.finalized === true,
    updatedAt: prov.updatedAt
  };
};
