import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import {
  asFeatureId,
  asSurfaceId
} from '$features/behavior-model/domain/value-objects/ids';
import { exportFeatureToJson } from '$features/behavior-model/infrastructure/io/FeatureJson';
import { JsonFolderFeatureRepository } from './JsonFolderFeatureRepository';
import { exportProjectToJson } from '$features/projects/infrastructure/io/ProjectJson';
import { asProjectId } from '$features/projects/domain/value-objects/ids';
import {
  PROJECT_SUFFIX,
  UNASSIGNED_FOLDER
} from '$shared/infrastructure/persistence/snapshotLayout';

const tempRoots: string[] = [];
const makeTempRoot = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'unspa-repo-'));
  tempRoots.push(dir);
  return dir;
};

afterEach(() => {
  tempRoots.length = 0;
});

const buildFeature = (overrides: Partial<Feature> = {}): Feature => ({
  id: asFeatureId(overrides.id ?? 'exp-checkout-1234abcd'),
  name: overrides.name ?? 'Checkout',
  description: 'Sample',
  surfaces: [
    {
      id: asSurfaceId('s1'),
      name: 'Cart',
      type: 'screen',
      stateDefinitions: [],
      actions: [],
      rules: [],
      invariants: [],
      transitions: []
    }
  ],
  personas: [],
  resources: [],
  entities: [],
  createdAt: '2026-05-09T10:00:00.000Z',
  updatedAt: '2026-05-09T10:00:00.000Z',
  ...overrides
});

/**
 * Seed a project file inside the given folder so `findProjectSlugForFeature`
 * routes the test feature into a real project folder instead of __unassigned/.
 */
const seedProject = (root: string, slug: string, featureIds: readonly string[]): void => {
  const dir = join(root, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${slug}${PROJECT_SUFFIX}`),
    exportProjectToJson({
      id: asProjectId(`${slug}-project-id`),
      name: slug,
      description: `Container project for ${slug}.`,
      featureIds: featureIds.map(asFeatureId),
      createdAt: '2026-05-09T09:00:00.000Z',
      updatedAt: '2026-05-09T09:00:00.000Z'
    }),
    'utf8'
  );
};

describe('JsonFolderFeatureRepository', () => {
  it('returns empty list when the directory does not exist yet', async () => {
    const repo = new JsonFolderFeatureRepository(join(makeTempRoot(), 'missing'));
    expect(await repo.list()).toEqual([]);
  });

  it('writes an orphan feature into __unassigned/ when no project claims it', async () => {
    const dir = makeTempRoot();
    const repo = new JsonFolderFeatureRepository(dir);
    const exp = buildFeature();

    await repo.save(exp);

    expect(readdirSync(join(dir, UNASSIGNED_FOLDER))).toContain('checkout.feature.json');
    expect(await repo.get(exp.id)).toEqual(exp);
    const summaries = await repo.list();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      id: exp.id,
      name: 'Checkout',
      surfaceCount: 1,
      actionCount: 0
    });
  });

  it('writes a claimed feature into its owning project folder', async () => {
    const dir = makeTempRoot();
    const exp = buildFeature();
    seedProject(dir, 'storefront', [String(exp.id)]);

    const repo = new JsonFolderFeatureRepository(dir);
    await repo.save(exp);

    expect(readdirSync(join(dir, 'storefront'))).toContain('checkout.feature.json');
    expect(readdirSync(dir)).not.toContain('checkout.feature.json');
    expect(await repo.get(exp.id)).toEqual(exp);
  });

  it('orders list() by updatedAt descending', async () => {
    const repo = new JsonFolderFeatureRepository(makeTempRoot());
    await repo.save(
      buildFeature({
        id: asFeatureId('older-id'),
        name: 'Older',
        updatedAt: '2026-01-01T00:00:00.000Z'
      })
    );
    await repo.save(
      buildFeature({
        id: asFeatureId('newer-id'),
        name: 'Newer',
        updatedAt: '2026-05-09T00:00:00.000Z'
      })
    );

    const summaries = await repo.list();
    expect(summaries.map((s) => s.name)).toEqual(['Newer', 'Older']);
  });

  it('list() does not crash when a shell on disk has no updatedAt field', async () => {
    const dir = makeTempRoot();
    const repo = new JsonFolderFeatureRepository(dir);
    await repo.save(
      buildFeature({
        id: asFeatureId('dated-id'),
        name: 'Dated',
        updatedAt: '2026-05-09T00:00:00.000Z'
      })
    );
    const shellDir = join(dir, UNASSIGNED_FOLDER);
    mkdirSync(shellDir, { recursive: true });
    writeFileSync(
      join(shellDir, 'shell.feature.json'),
      JSON.stringify({
        format: 'unspaghettit',
        version: 1,
        feature: {
          id: 'shell-id-12345678',
          name: 'Shell',
          surfaces: [],
          createdAt: '2026-05-09T00:00:00.000Z'
        }
      }),
      'utf8'
    );

    const summaries = await repo.list();
    expect(summaries.map((s) => s.name)).toEqual(['Dated', 'Shell']);
  });

  it('renames the file when the feature name changes', async () => {
    const dir = makeTempRoot();
    const repo = new JsonFolderFeatureRepository(dir);
    const exp = buildFeature({ name: 'Cart' });
    await repo.save(exp);
    await repo.save({ ...exp, name: 'Checkout', updatedAt: '2026-05-09T11:00:00.000Z' });

    const files = readdirSync(join(dir, UNASSIGNED_FOLDER));
    expect(files).toContain('checkout.feature.json');
    expect(files).not.toContain('cart.feature.json');
  });

  it('disambiguates slug collisions across distinct features in the same folder', async () => {
    const dir = makeTempRoot();
    const repo = new JsonFolderFeatureRepository(dir);
    await repo.save(buildFeature({ id: asFeatureId('first-id-aaaaaaaa'), name: 'Checkout' }));
    await repo.save(buildFeature({ id: asFeatureId('second-id-bbbbbbbb'), name: 'Checkout' }));

    const files = readdirSync(join(dir, UNASSIGNED_FOLDER));
    expect(files).toContain('checkout.feature.json');
    expect(files).toContain('checkout-second-i.feature.json');
  });

  it('moves a feature between folders when its owning project changes', async () => {
    const dir = makeTempRoot();
    const exp = buildFeature();
    const repo = new JsonFolderFeatureRepository(dir);

    // First save: orphan.
    await repo.save(exp);
    expect(readdirSync(join(dir, UNASSIGNED_FOLDER))).toContain('checkout.feature.json');

    // Reassign to a project and save again. The old file should be cleaned up.
    seedProject(dir, 'storefront', [String(exp.id)]);
    await repo.save({ ...exp, updatedAt: '2026-05-09T11:00:00.000Z' });

    expect(readdirSync(join(dir, 'storefront'))).toContain('checkout.feature.json');
    expect(readdirSync(join(dir, UNASSIGNED_FOLDER))).not.toContain('checkout.feature.json');
  });

  it('deletes the file for a known id and is a no-op for unknown ids', async () => {
    const dir = makeTempRoot();
    const repo = new JsonFolderFeatureRepository(dir);
    const exp = buildFeature();
    await repo.save(exp);

    await repo.delete(exp.id);
    expect(readdirSync(join(dir, UNASSIGNED_FOLDER))).toEqual([]);
    await expect(repo.delete(asFeatureId('nope'))).resolves.toBeUndefined();
  });

  it('skips malformed snapshot files instead of throwing', async () => {
    const dir = makeTempRoot();
    mkdirSync(join(dir, UNASSIGNED_FOLDER), { recursive: true });
    writeFileSync(join(dir, UNASSIGNED_FOLDER, 'broken.feature.json'), '{ not json', 'utf8');
    const exp = buildFeature();
    writeFileSync(
      join(dir, UNASSIGNED_FOLDER, 'checkout.feature.json'),
      exportFeatureToJson(exp),
      'utf8'
    );

    const repo = new JsonFolderFeatureRepository(dir);
    const summaries = await repo.list();
    expect(summaries.map((s) => s.id)).toEqual([exp.id]);
  });
});

describe('JsonFolderFeatureRepository parse cache', () => {
  it('parses each file once and re-parses only after it changed on disk', async () => {
    const dir = makeTempRoot();
    const repo = new JsonFolderFeatureRepository(dir);
    const cart = buildFeature({ id: asFeatureId('cart-id-aaaaaaaa'), name: 'Cart' });
    const pay = buildFeature({ id: asFeatureId('pay-id-bbbbbbbb'), name: 'Pay' });
    await repo.save(cart);
    await repo.save(pay);

    expect(await repo.get(cart.id)).toEqual(cart);
    expect(await repo.get(pay.id)).toEqual(pay);
    expect(await repo.list()).toHaveLength(2);
    // Two files on disk, each parsed exactly once across the saves and reads.
    expect(repo.parseCount).toBe(2);

    // Another process rewrites a file in place: the next read sees it.
    const cartPath = join(dir, UNASSIGNED_FOLDER, 'cart.feature.json');
    writeFileSync(
      cartPath,
      exportFeatureToJson({ ...cart, name: 'Cart, renamed elsewhere' }),
      'utf8'
    );
    expect((await repo.get(cart.id))?.name).toBe('Cart, renamed elsewhere');
    expect(repo.parseCount).toBe(3);

    // Another process removes a file: it leaves the listing, nothing is re-parsed.
    rmSync(join(dir, UNASSIGNED_FOLDER, 'pay.feature.json'));
    expect(await repo.get(pay.id)).toBeNull();
    expect((await repo.list()).map((s) => s.id)).toEqual([cart.id]);
    expect(repo.parseCount).toBe(3);
  });
});

describe('JsonFolderFeatureRepository file naming', () => {
  it('names files by id when asked, and moves a slug-named file on its next save', async () => {
    const dir = makeTempRoot();
    const exp = buildFeature({ id: asFeatureId('exp-checkout-1234abcd'), name: 'Checkout' });
    await new JsonFolderFeatureRepository(dir).save(exp);
    expect(readdirSync(join(dir, UNASSIGNED_FOLDER))).toEqual(['checkout.feature.json']);

    const byId = new JsonFolderFeatureRepository(dir, { fileNaming: 'id' });
    // Reads never depend on the naming.
    expect(await byId.get(exp.id)).toEqual(exp);

    await byId.save({ ...exp, name: 'Checkout flow', updatedAt: '2026-05-09T11:00:00.000Z' });
    expect(readdirSync(join(dir, UNASSIGNED_FOLDER))).toEqual([
      'exp-checkout-1234abcd.feature.json'
    ]);
    expect((await byId.get(exp.id))?.name).toBe('Checkout flow');

    // A rename no longer moves the file.
    await byId.save({ ...exp, name: 'Basket', updatedAt: '2026-05-09T12:00:00.000Z' });
    expect(readdirSync(join(dir, UNASSIGNED_FOLDER))).toEqual([
      'exp-checkout-1234abcd.feature.json'
    ]);
    expect((await byId.get(exp.id))?.name).toBe('Basket');
  });
});
