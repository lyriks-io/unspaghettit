import {
  SOURCE_ARTIFACTS,
  SOURCE_AUTHORITIES,
  SOURCE_KINDS,
  type ProjectSource,
  type SourceArtifact,
  type SourceAuthority,
  type SourceKind
} from '$features/source-provenance/domain/ProjectSource';

type Envelope = {
  readonly format: 'unspaghettit-source';
  readonly version: 1;
  readonly source: ProjectSource;
};

export const exportSourceToJson = (source: ProjectSource): string => {
  const envelope: Envelope = { format: 'unspaghettit-source', version: 1, source };
  return JSON.stringify(envelope, null, 2);
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const KIND_SET: ReadonlySet<SourceKind> = new Set(SOURCE_KINDS);
const AUTHORITY_SET: ReadonlySet<SourceAuthority> = new Set(SOURCE_AUTHORITIES);
const ARTIFACT_SET: ReadonlySet<SourceArtifact> = new Set(SOURCE_ARTIFACTS);

export const importSourceFromJson = (raw: string): ProjectSource => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON: ${(err as Error).message}`);
  }
  if (!isObject(parsed)) throw new Error('Expected a source envelope');
  if (parsed.format !== 'unspaghettit-source') {
    throw new Error('Not an Unspaghettit source export (format mismatch)');
  }
  if (parsed.version !== 1) {
    throw new Error(`Unsupported source version: ${String(parsed.version)}`);
  }
  const s = parsed.source;
  if (!isObject(s)) throw new Error('Envelope is missing the source object');
  if (typeof s.id !== 'string') throw new Error('Source missing id');
  if (typeof s.name !== 'string') throw new Error('Source missing name');
  if (typeof s.content !== 'string') throw new Error('Source missing content');
  if (typeof s.attachedAt !== 'string') throw new Error('Source missing attachedAt');
  const kind = KIND_SET.has(s.kind as SourceKind) ? (s.kind as SourceKind) : 'file';
  // Classification is optional and additive: an unknown or absent value is
  // dropped (reads back as `unknown`/unclassified), never a parse failure, so
  // pre-authority sources round-trip untouched.
  const authority = AUTHORITY_SET.has(s.authority as SourceAuthority)
    ? (s.authority as SourceAuthority)
    : undefined;
  const artifact = ARTIFACT_SET.has(s.artifact as SourceArtifact)
    ? (s.artifact as SourceArtifact)
    : undefined;
  return {
    id: s.id,
    projectId: typeof s.projectId === 'string' ? s.projectId : null,
    name: s.name,
    kind,
    ...(authority !== undefined ? { authority } : {}),
    ...(artifact !== undefined ? { artifact } : {}),
    content: s.content,
    byteLength:
      typeof s.byteLength === 'number' && Number.isFinite(s.byteLength)
        ? s.byteLength
        : s.content.length,
    contentHash: typeof s.contentHash === 'string' ? s.contentHash : '',
    attachedAt: s.attachedAt,
    supersedes: typeof s.supersedes === 'string' ? s.supersedes : null
  };
};
