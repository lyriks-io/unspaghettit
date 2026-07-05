import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { ProjectSource } from '$features/source-provenance/domain/ProjectSource';
import {
  exportProvenanceToJson,
  importProvenanceFromJson
} from '$features/source-provenance/infrastructure/io/ProvenanceJson';
import {
  exportSourceToJson,
  importSourceFromJson
} from '$features/source-provenance/infrastructure/io/SourceJson';
import { cryptoIdGenerator } from '$shared/domain/IdGenerator';
import {
  PROVENANCE_SUFFIX,
  UNASSIGNED_FOLDER,
  ensureSourcesDir,
  isSafeSegment,
  projectFilePath,
  sourceFilePath,
  walkBySuffix,
  walkSources
} from '$shared/infrastructure/persistence/snapshotLayout';

/**
 * One-shot, idempotent migration from provenance sidecars that EMBED the
 * analyzed document (format version 1) to the project-level source store:
 * the document moves to `<projectFolder>/sources/<id>.source.json`, the
 * sidecar keeps only spans + a `sourceIds` link, and every span is stamped
 * with the extracted source's id. Re-running on a migrated tree is a no-op
 * (sidecars whose `file` is null are skipped), and an identical document
 * already in the folder's store is reused instead of duplicated.
 *
 * Runs at startup next to `migrateFlatLayout`, from both the dashboard
 * server and the MCP binary.
 */
export const migrateEmbeddedSourceDocs = (root: string): number => {
  let moved = 0;
  for (const { folder, path } of walkBySuffix(root, PROVENANCE_SUFFIX)) {
    let prov;
    try {
      prov = importProvenanceFromJson(readFileSync(path, 'utf8'));
    } catch {
      continue; // Malformed sidecar: leave it for the API's own error path.
    }
    const file = prov.file;
    if (!file) continue;

    const projectId = readProjectId(root, folder);
    const slug = folder === UNASSIGNED_FOLDER ? null : folder;

    // Reuse an identical document already stored in this folder (same hash +
    // content), otherwise extract the embedded file under its original id.
    const existing = findByContent(root, folder, file.contentHash, file.content);
    const sourceId = existing?.id ?? (isSafeSegment(file.id) ? file.id : cryptoIdGenerator());
    if (!existing) {
      const source: ProjectSource = {
        id: sourceId,
        projectId,
        name: file.fileName,
        kind: 'file',
        content: file.content,
        byteLength: file.byteLength,
        contentHash: file.contentHash,
        attachedAt: file.attachedAt,
        supersedes: null
      };
      ensureSourcesDir(root, slug);
      writeFileSync(sourceFilePath(root, slug, sourceId), exportSourceToJson(source), 'utf8');
    }

    const migrated = {
      ...prov,
      file: null,
      sourceIds: prov.sourceIds.includes(sourceId) ? prov.sourceIds : [...prov.sourceIds, sourceId],
      spans: prov.spans.map((s) => (s.sourceId ? s : { ...s, sourceId }))
    };
    writeFileSync(path, exportProvenanceToJson(migrated), 'utf8');
    moved += 1;
  }
  return moved;
};

/** Migrate idempotently and log a single-line summary to stderr. */
export const migrateEmbeddedSourceDocsAndLog = (root: string, label: string): boolean => {
  const moved = migrateEmbeddedSourceDocs(root);
  if (moved === 0) return false;
  process.stderr.write(
    `[${label}] extracted ${moved} embedded provenance document(s) into the project source store\n`
  );
  return true;
};

const readProjectId = (root: string, folder: string): string | null => {
  if (folder === UNASSIGNED_FOLDER) return null;
  try {
    const raw = readFileSync(projectFilePath(root, folder), 'utf8');
    const data = JSON.parse(raw) as { project?: { id?: string }; id?: string };
    return data.project?.id ?? data.id ?? null;
  } catch {
    return null;
  }
};

const findByContent = (
  root: string,
  folder: string,
  contentHash: string,
  content: string
): ProjectSource | null => {
  for (const { folder: sourceFolder, path } of walkSources(root)) {
    if (sourceFolder !== folder || !existsSync(path)) continue;
    try {
      const source = importSourceFromJson(readFileSync(path, 'utf8'));
      if (source.contentHash === contentHash && source.content === content) return source;
    } catch {
      // Skip malformed source files.
    }
  }
  return null;
};
