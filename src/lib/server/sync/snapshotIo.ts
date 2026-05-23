import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import writeFileAtomic from 'write-file-atomic';
import type { RoomKind } from '../../sync/roomId';
import {
  FEATURE_SUFFIX,
  PROJECT_SUFFIX,
  STATUS_SUFFIX,
  UNASSIGNED_FOLDER,
  ensureProjectDir,
  featureFilePath,
  findProjectSlugForFeature,
  projectFilePath,
  statusFilePath,
  walkBySuffix
} from '../../../shared/infrastructure/persistence/snapshotLayout';

const slugify = (name: string, fallback: string): string => {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return base.length > 0 ? base : fallback;
};

const suffixFor = (kind: RoomKind): string => {
  if (kind === 'feature') return FEATURE_SUFFIX;
  if (kind === 'project') return PROJECT_SUFFIX;
  return STATUS_SUFFIX;
};

const envelopeFormatFor = (kind: RoomKind): string => {
  if (kind === 'feature') return 'unspaghettit';
  if (kind === 'project') return 'unspaghettit-project';
  return 'unspaghettit-implementation-status';
};

const envelopeVersionFor = (kind: RoomKind): number =>
  kind === 'implementation-status' ? 3 : 1;

const envelopeBodyKey = (kind: RoomKind): 'feature' | 'project' | 'status' => {
  if (kind === 'feature') return 'feature';
  if (kind === 'project') return 'project';
  return 'status';
};

const unwrapEnvelope = (kind: RoomKind, raw: unknown): unknown => {
  if (raw && typeof raw === 'object') {
    const key = envelopeBodyKey(kind);
    const body = (raw as Record<string, unknown>)[key];
    if (body !== undefined) return body;
  }
  return raw;
};

const wrapEnvelope = (kind: RoomKind, body: unknown): unknown => ({
  format: envelopeFormatFor(kind),
  version: envelopeVersionFor(kind),
  [envelopeBodyKey(kind)]: body
});

type Located = { readonly path: string; readonly folder: string; readonly slug: string };

const findFileById = (
  directory: string,
  kind: RoomKind,
  id: string
): Located | null => {
  const suffix = suffixFor(kind);
  if (kind === 'implementation-status') {
    // Status files are keyed by featureId; locate via the layout walker so we
    // pick up whichever project folder currently owns it.
    const wanted = `${id}${suffix}`;
    for (const { folder, file, path } of walkBySuffix(directory, suffix)) {
      if (file === wanted) return { path, folder, slug: id };
    }
    return null;
  }
  const bodyKey = envelopeBodyKey(kind);
  for (const { folder, file, path } of walkBySuffix(directory, suffix)) {
    try {
      const data = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
      const body = (data[bodyKey] ?? data) as { id?: string };
      if (body && body.id === id) {
        return { path, folder, slug: file.slice(0, -suffix.length) };
      }
    } catch {
      // skip malformed
    }
  }
  return null;
};

export const loadSnapshotFromDisk = async (
  directory: string,
  kind: RoomKind,
  id: string
): Promise<unknown | null> => {
  const found = findFileById(directory, kind, id);
  if (!found) return null;
  try {
    return unwrapEnvelope(kind, JSON.parse(readFileSync(found.path, 'utf8')));
  } catch {
    return null;
  }
};

export const persistSnapshotToDisk = async (
  directory: string,
  kind: RoomKind,
  id: string,
  body: unknown
): Promise<void> => {
  const envelope = wrapEnvelope(kind, body);

  if (kind === 'implementation-status') {
    const ownerSlug = findProjectSlugForFeature(directory, id);
    ensureProjectDir(directory, ownerSlug);
    const destination = statusFilePath(directory, ownerSlug, id);
    // Sweep up a stale sidecar in another folder (feature was reassigned).
    const existing = findFileById(directory, kind, id);
    if (existing && existing.path !== destination) unlinkSync(existing.path);
    await writeFileAtomic(destination, JSON.stringify(envelope, null, 2), 'utf8');
    return;
  }

  const entity = body as { id?: string; name?: string } | undefined;
  const entityId = entity?.id ?? id;
  const entityName = entity?.name ?? id;

  if (kind === 'project') {
    const existing = findFileById(directory, kind, entityId);
    const target = slugify(entityName, 'project');
    const taken = collectTakenSlugs(directory, PROJECT_SUFFIX, existing);
    const finalSlug = taken.includes(target)
      ? `${target}-${entityId.slice(0, 8)}`
      : target;
    if (existing && existing.slug !== finalSlug && existsSync(existing.path)) {
      unlinkSync(existing.path);
    }
    ensureProjectDir(directory, finalSlug);
    await writeFileAtomic(
      projectFilePath(directory, finalSlug),
      JSON.stringify(envelope, null, 2),
      'utf8'
    );
    return;
  }

  // kind === 'feature'
  const ownerSlug = findProjectSlugForFeature(directory, entityId);
  const ownerFolder = ownerSlug ?? UNASSIGNED_FOLDER;
  ensureProjectDir(directory, ownerSlug);
  const existing = findFileById(directory, kind, entityId);
  const target = slugify(entityName, 'feature');
  const taken = collectTakenSlugs(directory, FEATURE_SUFFIX, existing, ownerFolder);
  const finalSlug = taken.includes(target)
    ? `${target}-${entityId.slice(0, 8)}`
    : target;
  if (
    existing &&
    (existing.folder !== ownerFolder || existing.slug !== finalSlug) &&
    existsSync(existing.path)
  ) {
    unlinkSync(existing.path);
  }
  await writeFileAtomic(
    featureFilePath(directory, ownerSlug, finalSlug),
    JSON.stringify(envelope, null, 2),
    'utf8'
  );
};

/**
 * Collect filename slugs already taken in the target folder so the writer
 * doesn't pick a colliding name. Excludes the entity's own current file.
 * For projects we look across all project folders (slugs are global); for
 * features we restrict to the owning folder (slugs are per-folder).
 */
const collectTakenSlugs = (
  directory: string,
  suffix: string,
  existing: Located | null,
  ownerFolder?: string
): readonly string[] => {
  const out: string[] = [];
  for (const { folder, file } of walkBySuffix(directory, suffix)) {
    if (ownerFolder !== undefined && folder !== ownerFolder) continue;
    const slug = file.slice(0, -suffix.length);
    if (existing && existing.folder === folder && existing.slug === slug) continue;
    out.push(slug);
  }
  return out;
};
