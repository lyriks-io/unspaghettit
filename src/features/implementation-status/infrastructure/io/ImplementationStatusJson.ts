import type {
  AuditMeta,
  ActionImplementationStatus,
  EntityType,
  ExpectedEntity,
  ExtraTag,
  FoundEntity,
  ImplementationStatus,
  MissingEntity,
  SurfaceImplementationStatus,
  TagLocation
} from '$features/implementation-status/domain/ImplementationStatus';
import { ALL_ENTITY_TYPES } from '$features/implementation-status/domain/ImplementationStatus';
import type {
  ActionId,
  FeatureId,
  SurfaceId
} from '$features/behavior-model/domain/value-objects/ids';

type Envelope = {
  readonly format: 'unspaghettit-implementation-status';
  readonly version: 3;
  readonly status: ImplementationStatus;
};

export const exportImplementationStatusToJson = (status: ImplementationStatus): string => {
  const envelope: Envelope = {
    format: 'unspaghettit-implementation-status',
    version: 3,
    status
  };
  return JSON.stringify(envelope, null, 2);
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const ENTITY_TYPES: ReadonlySet<EntityType> = new Set(ALL_ENTITY_TYPES);

const parseEntityType = (raw: unknown): EntityType | null =>
  typeof raw === 'string' && ENTITY_TYPES.has(raw as EntityType) ? (raw as EntityType) : null;

const parseLocation = (raw: unknown): TagLocation | null => {
  if (!isObject(raw)) return null;
  const file = raw.file;
  if (typeof file !== 'string' || file.length === 0) return null;
  const line = typeof raw.line === 'number' && Number.isFinite(raw.line) ? raw.line : undefined;
  const snippet = typeof raw.snippet === 'string' ? raw.snippet : undefined;
  const stale = raw.stale === true ? true : undefined;
  const suggestedLine =
    typeof raw.suggestedLine === 'number' && Number.isFinite(raw.suggestedLine)
      ? raw.suggestedLine
      : undefined;
  return {
    file,
    ...(line !== undefined ? { line } : {}),
    ...(snippet !== undefined ? { snippet } : {}),
    ...(stale !== undefined ? { stale } : {}),
    ...(suggestedLine !== undefined ? { suggestedLine } : {})
  };
};

const parseLocations = (raw: unknown): readonly TagLocation[] => {
  if (!Array.isArray(raw)) return [];
  return raw.map(parseLocation).filter((l): l is TagLocation => l !== null);
};

const parseExpectedEntity = (raw: unknown): ExpectedEntity | null => {
  if (!isObject(raw)) return null;
  const entityType = parseEntityType(raw.entityType);
  if (!entityType) return null;
  if (typeof raw.entityId !== 'string' || typeof raw.tag !== 'string') return null;
  return {
    entityType,
    entityId: raw.entityId,
    entityName: typeof raw.entityName === 'string' ? raw.entityName : undefined,
    tag: raw.tag
  };
};

const parseFoundEntity = (raw: unknown): FoundEntity | null => {
  if (!isObject(raw)) return null;
  const entityType = parseEntityType(raw.entityType);
  if (!entityType) return null;
  if (typeof raw.entityId !== 'string' || typeof raw.tag !== 'string') return null;
  if (typeof raw.capturedAt !== 'string') return null;
  const out: FoundEntity = {
    entityType,
    entityId: raw.entityId,
    entityName: typeof raw.entityName === 'string' ? raw.entityName : undefined,
    tag: raw.tag,
    locations: parseLocations(raw.locations),
    capturedAt: raw.capturedAt
  };
  return raw.capturedFields !== undefined
    ? { ...out, capturedFields: raw.capturedFields }
    : out;
};

const parseMissingEntity = (raw: unknown): MissingEntity | null => {
  if (!isObject(raw)) return null;
  const entityType = parseEntityType(raw.entityType);
  if (!entityType) return null;
  if (typeof raw.entityId !== 'string' || typeof raw.tag !== 'string') return null;
  return {
    entityType,
    entityId: raw.entityId,
    entityName: typeof raw.entityName === 'string' ? raw.entityName : undefined,
    tag: raw.tag
  };
};

const parseRelatedFile = (raw: unknown): { file: string; line: number; role: string } | null => {
  if (!isObject(raw)) return null;
  if (typeof raw.file !== 'string' || typeof raw.role !== 'string') return null;
  const line = typeof raw.line === 'number' && Number.isFinite(raw.line) ? raw.line : 0;
  return { file: raw.file, line, role: raw.role };
};

const parseAuditMeta = (raw: unknown): AuditMeta | undefined => {
  if (!isObject(raw)) return undefined;
  const out: Record<string, unknown> = {};
  if (typeof raw.auditedAt === 'string') out.auditedAt = raw.auditedAt;
  if (typeof raw.gitCommit === 'string') out.gitCommit = raw.gitCommit;
  if (typeof raw.specVersion === 'string') out.specVersion = raw.specVersion;
  if (typeof raw.kind === 'string') out.kind = raw.kind;
  if (typeof raw.testFile === 'string') out.testFile = raw.testFile;
  if (Array.isArray(raw.relatedFiles)) {
    out.relatedFiles = raw.relatedFiles.map(parseRelatedFile).filter(
      (f): f is { file: string; line: number; role: string } => f !== null
    );
  }
  if (Array.isArray(raw.knownGaps)) {
    out.knownGaps = raw.knownGaps.filter((g): g is string => typeof g === 'string');
  }
  return Object.keys(out).length > 0 ? (out as AuditMeta) : undefined;
};

const parseExtraTag = (raw: unknown): ExtraTag | null => {
  if (!isObject(raw)) return null;
  if (typeof raw.tag !== 'string') return null;
  return { tag: raw.tag, locations: parseLocations(raw.locations) };
};

/**
 * Convert a v1 action entry (events-only) into the v2/v3 entity-based shape
 * so legacy sidecar files keep loading after the refactor. Action,
 * rule, invariant, transition data is unrecoverable from v1. Only events
 * survive the migration.
 */
const migrateLegacyCapability = (
  raw: Record<string, unknown>
): ActionImplementationStatus | null => {
  // Accept both pre- and post-rename field names so v1 sidecars keep loading.
  const actionId =
    (typeof raw.actionId === 'string' && raw.actionId) ||
    (typeof raw.capabilityId === 'string' && raw.capabilityId) ||
    null;
  const actionSlug =
    (typeof raw.actionSlug === 'string' && raw.actionSlug) ||
    (typeof raw.capabilitySlug === 'string' && raw.capabilitySlug) ||
    null;
  const actionName =
    (typeof raw.actionName === 'string' && raw.actionName) ||
    (typeof raw.capabilityName === 'string' && raw.capabilityName) ||
    null;
  if (!actionId || !actionSlug || !actionName) return null;
  if (typeof raw.surfaceId !== 'string') return null;
  if (typeof raw.reportedAt !== 'string') return null;

  const slug = actionSlug;
  const reportedAt = raw.reportedAt as string;

  const expectedEvents = Array.isArray(raw.expectedEvents)
    ? raw.expectedEvents.filter((e): e is string => typeof e === 'string')
    : [];

  const expectedEntities: ExpectedEntity[] = expectedEvents.map((e) => ({
    entityType: 'event',
    entityId: e,
    entityName: e,
    tag: `@unspa:${slug}#${e}`
  }));

  const legacyFoundEvents: { event: string; locations: readonly TagLocation[] }[] =
    Array.isArray(raw.foundEvents)
      ? raw.foundEvents
          .map((f) => {
            if (!isObject(f)) return null;
            if (typeof f.event !== 'string') return null;
            return { event: f.event, locations: parseLocations(f.locations) };
          })
          .filter((f): f is { event: string; locations: readonly TagLocation[] } => f !== null)
      : [];

  const foundEntities: FoundEntity[] = legacyFoundEvents.map((f) => ({
    entityType: 'event',
    entityId: f.event,
    entityName: f.event,
    tag: `@unspa:${slug}#${f.event}`,
    locations: f.locations,
    capturedAt: reportedAt
  }));

  const foundEventNames = new Set(legacyFoundEvents.map((f) => f.event));
  const missingEntities: MissingEntity[] = expectedEvents
    .filter((e) => !foundEventNames.has(e))
    .map((e) => ({
      entityType: 'event',
      entityId: e,
      entityName: e,
      tag: `@unspa:${slug}#${e}`
    }));

  const extraTags = Array.isArray(raw.extraTags)
    ? raw.extraTags.map(parseExtraTag).filter((t): t is ExtraTag => t !== null)
    : [];

  return {
    actionId: actionId as ActionId,
    actionSlug: slug,
    actionName: actionName,
    surfaceId: raw.surfaceId as SurfaceId,
    expectedEntities,
    foundEntities,
    missingEntities,
    extraTags,
    reportedAt
  };
};

const parseCapability = (rawIn: unknown): ActionImplementationStatus | null => {
  if (!isObject(rawIn)) return null;
  // Pre-rename sidecars used capabilityId/capabilitySlug/capabilityName; accept
  // both shapes so legacy sidecars deserialize without a separate migration.
  const raw = rawIn as Record<string, unknown>;
  const actionId =
    (typeof raw.actionId === 'string' && raw.actionId) ||
    (typeof raw.capabilityId === 'string' && raw.capabilityId) ||
    null;
  const actionSlug =
    (typeof raw.actionSlug === 'string' && raw.actionSlug) ||
    (typeof raw.capabilitySlug === 'string' && raw.capabilitySlug) ||
    null;
  const actionName =
    (typeof raw.actionName === 'string' && raw.actionName) ||
    (typeof raw.capabilityName === 'string' && raw.capabilityName) ||
    null;
  if (!actionId || !actionSlug || !actionName) return null;
  if (typeof raw.surfaceId !== 'string') return null;
  if (typeof raw.reportedAt !== 'string') return null;

  // v2/v3 path
  if (Array.isArray(raw.expectedEntities) || Array.isArray(raw.foundEntities)) {
    const expectedEntities = Array.isArray(raw.expectedEntities)
      ? raw.expectedEntities.map(parseExpectedEntity).filter((e): e is ExpectedEntity => e !== null)
      : [];
    const foundEntities = Array.isArray(raw.foundEntities)
      ? raw.foundEntities.map(parseFoundEntity).filter((e): e is FoundEntity => e !== null)
      : [];
    const missingEntities = Array.isArray(raw.missingEntities)
      ? raw.missingEntities.map(parseMissingEntity).filter((e): e is MissingEntity => e !== null)
      : [];
    const extraTags = Array.isArray(raw.extraTags)
      ? raw.extraTags.map(parseExtraTag).filter((t): t is ExtraTag => t !== null)
      : [];
    const auditMeta = parseAuditMeta(raw.auditMeta);
    const base: ActionImplementationStatus = {
      actionId: actionId as ActionId,
      actionSlug,
      actionName,
      surfaceId: raw.surfaceId as SurfaceId,
      expectedEntities,
      foundEntities,
      missingEntities,
      extraTags,
      reportedAt: raw.reportedAt as string
    };
    return auditMeta !== undefined ? { ...base, auditMeta } : base;
  }

  // v1 fallback (events-only)
  return migrateLegacyCapability(raw);
};

const parseSurface = (raw: unknown): SurfaceImplementationStatus | null => {
  if (!isObject(raw)) return null;
  if (typeof raw.surfaceId !== 'string') return null;
  if (typeof raw.surfaceSlug !== 'string') return null;
  if (typeof raw.surfaceName !== 'string') return null;
  if (typeof raw.reportedAt !== 'string') return null;

  const expectedEntities = Array.isArray(raw.expectedEntities)
    ? raw.expectedEntities.map(parseExpectedEntity).filter((e): e is ExpectedEntity => e !== null)
    : [];
  const foundEntities = Array.isArray(raw.foundEntities)
    ? raw.foundEntities.map(parseFoundEntity).filter((e): e is FoundEntity => e !== null)
    : [];
  const missingEntities = Array.isArray(raw.missingEntities)
    ? raw.missingEntities.map(parseMissingEntity).filter((e): e is MissingEntity => e !== null)
    : [];
  const extraTags = Array.isArray(raw.extraTags)
    ? raw.extraTags.map(parseExtraTag).filter((t): t is ExtraTag => t !== null)
    : [];

  const auditMeta = parseAuditMeta(raw.auditMeta);
  const base: SurfaceImplementationStatus = {
    surfaceId: raw.surfaceId as SurfaceId,
    surfaceSlug: raw.surfaceSlug,
    surfaceName: raw.surfaceName,
    expectedEntities,
    foundEntities,
    missingEntities,
    extraTags,
    reportedAt: raw.reportedAt
  };
  return auditMeta !== undefined ? { ...base, auditMeta } : base;
};

export const importImplementationStatusFromJson = (raw: string): ImplementationStatus => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON: ${(err as Error).message}`);
  }
  if (!isObject(parsed)) throw new Error('Expected an implementation-status envelope');
  if (parsed.version !== 1 && parsed.version !== 2 && parsed.version !== 3) {
    throw new Error(`Unsupported implementation-status version: ${String(parsed.version)}`);
  }
  if (parsed.format !== 'unspaghettit-implementation-status') {
    throw new Error('Not an Unspaghettit implementation-status export (format mismatch)');
  }
  const status = parsed.status;
  if (!isObject(status)) throw new Error('Envelope is missing the status object');
  if (typeof status.featureId !== 'string') throw new Error('Status missing featureId');
  if (typeof status.updatedAt !== 'string') throw new Error('Status missing updatedAt');
  const revision =
    typeof status.revision === 'number' && Number.isFinite(status.revision)
      ? status.revision
      : 0;
  // Pre-rename sidecars stored this list under `capabilities`; new ones write
  // `actions`. Accept either so legacy files keep loading.
  const rawActions = Array.isArray(status.actions)
    ? status.actions
    : Array.isArray((status as { capabilities?: unknown }).capabilities)
      ? ((status as { capabilities: unknown[] }).capabilities)
      : [];
  const actions = rawActions
    .map(parseCapability)
    .filter((c): c is ActionImplementationStatus => c !== null);
  const surfaces = Array.isArray(status.surfaces)
    ? status.surfaces.map(parseSurface).filter((s): s is SurfaceImplementationStatus => s !== null)
    : [];
  return {
    featureId: status.featureId as FeatureId,
    revision,
    updatedAt: status.updatedAt,
    actions,
    surfaces
  };
};
