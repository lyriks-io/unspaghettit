import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { asProjectId } from '$features/projects/domain/value-objects/ids';
import { JsonFolderProjectRepository } from './JsonFolderProjectRepository';

const makeTempRoot = (): string => mkdtempSync(join(tmpdir(), 'unspa-projects-'));

const seedProject = (root: string, slug: string, projectId: string, name = slug): void => {
  mkdirSync(join(root, slug), { recursive: true });
  writeFileSync(
    join(root, slug, `${slug}.project.json`),
    JSON.stringify({
      format: 'unspaghettit-project',
      version: 1,
      project: {
        id: projectId,
        name,
        description: `Project ${name}.`,
        tags: [],
        featureIds: [],
        createdAt: '2026-08-13T00:00:00.000Z',
        updatedAt: '2026-08-13T00:00:00.000Z'
      }
    }),
    'utf8'
  );
};

describe('JsonFolderProjectRepository.get', () => {
  it('resolves by the id inside the file', async () => {
    const root = makeTempRoot();
    seedProject(root, 'my-product-a1b2c3', 'my-product-a1b2c3');
    const repo = new JsonFolderProjectRepository(root);

    const project = await repo.get(asProjectId('my-product-a1b2c3'));
    expect(project?.name).toBe('my-product-a1b2c3');
  });

  it('falls back to the folder name when the content id differs', async () => {
    // A host application mirroring snapshots (e.g. the Lyriks back) keys the
    // folder by the shared kernel id while a legacy writer stamped its own
    // UUID inside the file. Deep links carry the folder key.
    const root = makeTempRoot();
    seedProject(root, 'my-product-a1b2c3', '3f2c9a10-aaaa-bbbb-cccc-000000000001', 'My Product');
    const repo = new JsonFolderProjectRepository(root);

    expect((await repo.get(asProjectId('3f2c9a10-aaaa-bbbb-cccc-000000000001')))?.name).toBe(
      'My Product'
    );
    expect((await repo.get(asProjectId('my-product-a1b2c3')))?.name).toBe('My Product');
  });

  it('prefers a content-id match over a folder-name match', async () => {
    const root = makeTempRoot();
    // Folder "alpha" holds a project whose content id is "beta"; folder
    // "gamma" holds the project whose content id is "alpha". Asking for
    // "alpha" must return the content match, not the folder match.
    seedProject(root, 'alpha', 'beta', 'Folder Alpha');
    seedProject(root, 'gamma', 'alpha', 'Content Alpha');
    const repo = new JsonFolderProjectRepository(root);

    expect((await repo.get(asProjectId('alpha')))?.name).toBe('Content Alpha');
    expect((await repo.get(asProjectId('beta')))?.name).toBe('Folder Alpha');
  });

  it('returns null when neither a content id nor a folder matches', async () => {
    const root = makeTempRoot();
    seedProject(root, 'my-product-a1b2c3', 'my-product-a1b2c3');
    const repo = new JsonFolderProjectRepository(root);

    expect(await repo.get(asProjectId('nope'))).toBeNull();
  });
});
