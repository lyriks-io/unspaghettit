import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { asFeatureId } from '$features/behavior-model/domain/value-objects/ids';
import {
  attachSourceFile,
  emptyProvenance,
  recordSpan
} from '$features/source-provenance/domain/Provenance';
import { createProjectSource } from '$features/source-provenance/domain/ProjectSource';
import { exportProvenanceToJson } from '$features/source-provenance/infrastructure/io/ProvenanceJson';
import { JsonFolderProjectSourceRepository } from './JsonFolderProjectSourceRepository';
import { JsonFolderProvenanceRepository } from './JsonFolderProvenanceRepository';
import { migrateEmbeddedSourceDocs } from './migrateEmbeddedSourceDocs';

const makeTempRoot = (): string => mkdtempSync(join(tmpdir(), 'unspa-sources-'));

const writeJson = (path: string, body: unknown): void => {
  writeFileSync(path, JSON.stringify(body, null, 2), 'utf8');
};

const seedProject = (root: string, slug: string, projectId: string, featureIds: string[]): void => {
  mkdirSync(join(root, slug), { recursive: true });
  writeJson(join(root, slug, `${slug}.project.json`), {
    project: { id: projectId, name: slug, featureIds }
  });
};

const makeSource = (id: string, projectId: string | null, content: string) => {
  const r = createProjectSource(
    { id, projectId, name: `doc ${id}`, kind: 'pasted', content, attachedAt: 't0' },
    []
  );
  if (!r.ok) throw new Error(r.reason);
  return r.source;
};

describe('JsonFolderProjectSourceRepository', () => {
  it('saves into the owning project folder and finds by id', async () => {
    const root = makeTempRoot();
    seedProject(root, 'shop', 'p1', []);
    const repo = new JsonFolderProjectSourceRepository(root);

    await repo.save(makeSource('s1', 'p1', 'hello world'));
    expect(existsSync(join(root, 'shop', 'sources', 's1.source.json'))).toBe(true);

    const found = await repo.find('s1');
    expect(found?.content).toBe('hello world');
    expect(found?.projectId).toBe('p1');
  });

  it('lists only the requested project, newest first', async () => {
    const root = makeTempRoot();
    seedProject(root, 'shop', 'p1', []);
    seedProject(root, 'blog', 'p2', []);
    const repo = new JsonFolderProjectSourceRepository(root);

    await repo.save({ ...makeSource('s1', 'p1', 'one'), attachedAt: 't1' });
    await repo.save({ ...makeSource('s2', 'p1', 'two'), attachedAt: 't2' });
    await repo.save(makeSource('s3', 'p2', 'other'));

    const listed = await repo.listForProject('p1');
    expect(listed.map((s) => s.id)).toEqual(['s2', 's1']);
  });

  it('stores unassigned sources under __unassigned and deletes cleanly', async () => {
    const root = makeTempRoot();
    const repo = new JsonFolderProjectSourceRepository(root);

    await repo.save(makeSource('s1', null, 'orphan text'));
    expect(existsSync(join(root, '__unassigned', 'sources', 's1.source.json'))).toBe(true);

    await repo.delete('s1');
    expect(existsSync(join(root, '__unassigned', 'sources', 's1.source.json'))).toBe(false);
    expect(await repo.find('s1')).toBeNull();
  });
});

describe('migrateEmbeddedSourceDocs', () => {
  const CONTENT = 'The cart shall total its items.\nRule two lives here.';

  const seedV1Sidecar = (root: string, slug: string, featureId: string): void => {
    const attached = attachSourceFile(emptyProvenance(asFeatureId(featureId), 't0'), {
      id: 'file-77',
      fileName: 'prd.md',
      content: CONTENT,
      attachedAt: 't0'
    });
    if (!attached.ok) throw new Error(attached.reason);
    const spanned = recordSpan(attached.provenance, {
      id: 'span-1',
      elementId: 'el-1',
      elementType: 'rule',
      startOffset: 0,
      endOffset: 8,
      recordedAt: 't1'
    });
    if (!spanned.ok) throw new Error(spanned.reason);
    // Re-serialize as a version-1 envelope: exactly what pre-store installs hold.
    const v2 = exportProvenanceToJson(spanned.provenance);
    const legacyEnvelope = JSON.parse(v2) as {
      version: number;
      provenance: Record<string, unknown>;
    };
    legacyEnvelope.version = 1;
    delete legacyEnvelope.provenance.sourceIds;
    writeJson(join(root, slug, `${featureId}.provenance.json`), legacyEnvelope);
  };

  it('extracts the embedded document into sources/ and rewrites the sidecar', async () => {
    const root = makeTempRoot();
    seedProject(root, 'shop', 'p1', ['feat-1']);
    seedV1Sidecar(root, 'shop', 'feat-1');

    const moved = migrateEmbeddedSourceDocs(root);
    expect(moved).toBe(1);

    // The document now lives in the project's source store, under its old file id.
    const sourceRepo = new JsonFolderProjectSourceRepository(root);
    const source = await sourceRepo.find('file-77');
    expect(source?.content).toBe(CONTENT);
    expect(source?.projectId).toBe('p1');
    expect(source?.name).toBe('prd.md');

    // The sidecar dropped the embedded file, linked the source, stamped the span.
    const provRepo = new JsonFolderProvenanceRepository(root);
    const prov = await provRepo.get(asFeatureId('feat-1'));
    expect(prov?.file).toBeNull();
    expect(prov?.sourceIds).toEqual(['file-77']);
    expect(prov?.spans[0]?.sourceId).toBe('file-77');
    expect(prov?.spans[0]?.snippet).toBe('The cart');
  });

  it('is idempotent: a second run moves nothing', () => {
    const root = makeTempRoot();
    seedProject(root, 'shop', 'p1', ['feat-1']);
    seedV1Sidecar(root, 'shop', 'feat-1');

    expect(migrateEmbeddedSourceDocs(root)).toBe(1);
    expect(migrateEmbeddedSourceDocs(root)).toBe(0);
  });

  it('reuses an identical document already in the store instead of duplicating', () => {
    const root = makeTempRoot();
    seedProject(root, 'shop', 'p1', ['feat-1', 'feat-2']);
    seedV1Sidecar(root, 'shop', 'feat-1');
    seedV1Sidecar(root, 'shop', 'feat-2');

    expect(migrateEmbeddedSourceDocs(root)).toBe(2);

    // Both sidecars share ONE stored document (same content hash).
    const raw1 = readFileSync(join(root, 'shop', 'feat-1.provenance.json'), 'utf8');
    const raw2 = readFileSync(join(root, 'shop', 'feat-2.provenance.json'), 'utf8');
    const ids1 = (JSON.parse(raw1) as { provenance: { sourceIds: string[] } }).provenance.sourceIds;
    const ids2 = (JSON.parse(raw2) as { provenance: { sourceIds: string[] } }).provenance.sourceIds;
    expect(ids1).toEqual(ids2);
  });
});
