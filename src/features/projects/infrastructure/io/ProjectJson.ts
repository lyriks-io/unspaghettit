import type {
  ActionId,
  FeatureId,
  SurfaceId
} from '$features/behavior-model/domain/value-objects/ids';
import type { Project } from '$features/projects/domain/entities/Project';
import {
  asQueueItemId,
  type QueueItem
} from '$features/implementation-queue/domain/entities/QueueItem';

const CANONICAL_FORMAT = 'unspaghettit-project';
const ACCEPTED_FORMATS = new Set<string>([CANONICAL_FORMAT]);

export type ProjectExportEnvelope = {
  readonly format: typeof CANONICAL_FORMAT;
  readonly version: 1;
  readonly project: Project;
};

export const exportProjectToJson = (project: Project): string => {
  const envelope: ProjectExportEnvelope = {
    format: CANONICAL_FORMAT,
    version: 1,
    project
  };
  return JSON.stringify(envelope, null, 2);
};

export const importProjectFromJson = (raw: string): Project => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON: ${(error as Error).message}`);
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Expected a project export object');
  }
  const envelope = parsed as Partial<ProjectExportEnvelope> & { format?: string };
  if (!envelope.format || !ACCEPTED_FORMATS.has(envelope.format)) {
    throw new Error('Not an Unspaghettit project export (missing or unrecognized format field)');
  }
  if (envelope.version !== 1) {
    throw new Error(`Unsupported export version: ${envelope.version}`);
  }
  if (!envelope.project) {
    throw new Error('Export envelope is missing a project');
  }
  return {
    ...envelope.project,
    featureIds: (envelope.project.featureIds ?? []) as readonly FeatureId[],
    ...(envelope.project.implementationQueue !== undefined
      ? { implementationQueue: normalizeQueue(envelope.project.implementationQueue) }
      : {})
  };
};

/**
 * Drop malformed entries silently when loading a project file. Older
 * project files predate the queue field entirely; newer ones may carry
 * entries the schema doesn't recognize because the user hand-edited the
 * JSON. Either way we'd rather lose the offender than fail the whole
 * project load (which would knock the project off the dashboard).
 */
const normalizeQueue = (raw: unknown): readonly QueueItem[] => {
  if (!Array.isArray(raw)) return [];
  const out: QueueItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const id = typeof e.id === 'string' ? asQueueItemId(e.id) : null;
    const featureId = typeof e.featureId === 'string' ? (e.featureId as FeatureId) : null;
    const addedAt = typeof e.addedAt === 'string' ? e.addedAt : null;
    if (!id || !featureId || !addedAt) continue;
    const note = typeof e.note === 'string' && e.note.length > 0 ? e.note : undefined;
    if (e.kind === 'feature') {
      out.push({ id, kind: 'feature', featureId, addedAt, ...(note ? { note } : {}) });
    } else if (e.kind === 'surface' && typeof e.surfaceId === 'string') {
      out.push({
        id,
        kind: 'surface',
        featureId,
        surfaceId: e.surfaceId as SurfaceId,
        addedAt,
        ...(note ? { note } : {})
      });
    } else if (e.kind === 'action' && typeof e.actionId === 'string') {
      out.push({
        id,
        kind: 'action',
        featureId,
        actionId: e.actionId as ActionId,
        addedAt,
        ...(note ? { note } : {})
      });
    }
  }
  return out;
};
