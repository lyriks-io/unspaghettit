import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PROJECT_SUFFIX,
  FEATURE_SUFFIX,
  STATUS_SUFFIX,
  UNASSIGNED_FOLDER,
  fileNamingFromEnv,
  findProjectSlugForFeature,
  hasFlatLayout,
  migrateFlatLayout,
  walkBySuffix
} from './snapshotLayout';

const tempRoots: string[] = [];
const makeTempRoot = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'snapshot-layout-'));
  tempRoots.push(dir);
  return dir;
};

const writeJson = (path: string, body: unknown): void => {
  writeFileSync(path, JSON.stringify(body, null, 2), 'utf8');
};

afterEach(() => {
  tempRoots.length = 0;
});

describe('snapshotLayout', () => {
  describe('hasFlatLayout', () => {
    it('returns false on an empty or missing directory', () => {
      expect(hasFlatLayout(join(makeTempRoot(), 'absent'))).toBe(false);
      expect(hasFlatLayout(makeTempRoot())).toBe(false);
    });

    it('returns true when a *.feature.json sits at the root', () => {
      const dir = makeTempRoot();
      writeJson(join(dir, 'cart.feature.json'), { feature: { id: 'f1' } });
      expect(hasFlatLayout(dir)).toBe(true);
    });

    it('returns false once everything lives in subfolders', () => {
      const dir = makeTempRoot();
      mkdirSync(join(dir, 'storefront'));
      writeJson(join(dir, 'storefront', 'cart.feature.json'), { feature: { id: 'f1' } });
      expect(hasFlatLayout(dir)).toBe(false);
    });
  });

  describe('findProjectSlugForFeature', () => {
    it('locates the owning project by featureIds[] across subfolders', () => {
      const dir = makeTempRoot();
      mkdirSync(join(dir, 'shop'));
      writeJson(join(dir, 'shop', `shop${PROJECT_SUFFIX}`), {
        project: { id: 'p1', featureIds: ['f1', 'f2'] }
      });
      mkdirSync(join(dir, 'admin'));
      writeJson(join(dir, 'admin', `admin${PROJECT_SUFFIX}`), {
        project: { id: 'p2', featureIds: ['f3'] }
      });

      expect(findProjectSlugForFeature(dir, 'f2')).toBe('shop');
      expect(findProjectSlugForFeature(dir, 'f3')).toBe('admin');
      expect(findProjectSlugForFeature(dir, 'unknown')).toBeNull();
    });

    it('handles the legacy bare-project shape (no `project` envelope)', () => {
      const dir = makeTempRoot();
      mkdirSync(join(dir, 'legacy'));
      writeJson(join(dir, 'legacy', `legacy${PROJECT_SUFFIX}`), {
        id: 'p1',
        featureIds: ['f1']
      });
      expect(findProjectSlugForFeature(dir, 'f1')).toBe('legacy');
    });
  });

  describe('migrateFlatLayout', () => {
    it('is a no-op on a directory that is already nested', () => {
      const dir = makeTempRoot();
      mkdirSync(join(dir, 'shop'));
      writeJson(join(dir, 'shop', `shop${PROJECT_SUFFIX}`), {
        project: { id: 'p1', featureIds: [] }
      });
      const report = migrateFlatLayout(dir);
      expect(report).toEqual({
        movedProjects: 0,
        movedFeatures: 0,
        movedStatus: 0,
        movedHistory: 0
      });
    });

    it('moves projects, features, status, and history into per-project folders', () => {
      const dir = makeTempRoot();
      writeJson(join(dir, `shop${PROJECT_SUFFIX}`), {
        project: { id: 'p1', name: 'Shop', featureIds: ['f1', 'f2'] }
      });
      writeJson(join(dir, `cart${FEATURE_SUFFIX}`), { feature: { id: 'f1' } });
      writeJson(join(dir, `checkout${FEATURE_SUFFIX}`), { feature: { id: 'f2' } });
      writeJson(join(dir, `orphan${FEATURE_SUFFIX}`), { feature: { id: 'f3' } });
      writeJson(join(dir, `f1${STATUS_SUFFIX}`), { status: { featureId: 'f1' } });
      writeJson(join(dir, 'shop.project.history.json'), { id: 'p1', entries: [], cursor: -1 });
      writeJson(join(dir, 'cart.feature.history.json'), { id: 'f1', entries: [], cursor: -1 });

      const report = migrateFlatLayout(dir);

      expect(report).toEqual({
        movedProjects: 1,
        movedFeatures: 3,
        movedStatus: 1,
        movedHistory: 2
      });

      // Project + claimed features + status under shop/; history under
      // shop/history/ now that it lives in its own subfolder.
      const shopFiles = readdirSync(join(dir, 'shop')).sort();
      expect(shopFiles).toEqual([
        'cart.feature.json',
        'checkout.feature.json',
        'f1.implementation-status.json',
        'history',
        'shop.project.json'
      ]);
      const shopHistory = readdirSync(join(dir, 'shop', 'history')).sort();
      expect(shopHistory).toEqual(['cart.feature.history.json', 'shop.project.history.json']);

      // Orphan feature lands under __unassigned/.
      expect(readdirSync(join(dir, UNASSIGNED_FOLDER))).toEqual(['orphan.feature.json']);

      // Top-level is clean (no leftover *.json kinds we manage).
      const rootEntries = readdirSync(dir);
      for (const entry of rootEntries) {
        expect(
          entry === 'shop' ||
            entry === UNASSIGNED_FOLDER ||
            entry.endsWith('.domain.json'),
          `unexpected top-level entry after migration: ${entry}`
        ).toBe(true);
      }
    });

    it('is idempotent: a second run does nothing', () => {
      const dir = makeTempRoot();
      writeJson(join(dir, `shop${PROJECT_SUFFIX}`), {
        project: { id: 'p1', featureIds: ['f1'] }
      });
      writeJson(join(dir, `cart${FEATURE_SUFFIX}`), { feature: { id: 'f1' } });

      const first = migrateFlatLayout(dir);
      const second = migrateFlatLayout(dir);

      expect(first.movedProjects + first.movedFeatures).toBeGreaterThan(0);
      expect(second.movedProjects + second.movedFeatures).toBe(0);
    });

    it('moves orphan project history into __unassigned/ when no matching project exists', () => {
      const dir = makeTempRoot();
      // A history file whose project (id "ghost-project") was deleted before
      // this migration runs. There's no live project to sit it next to.
      writeJson(join(dir, 'ghost.project.history.json'), {
        id: 'ghost-project',
        entries: [],
        cursor: -1
      });

      const report = migrateFlatLayout(dir);

      expect(report.movedHistory).toBe(1);
      // Lands under __unassigned/history/ in the per-subfolder layout.
      expect(readdirSync(join(dir, UNASSIGNED_FOLDER, 'history'))).toContain(
        'ghost.project.history.json'
      );
      // And nothing left loose at the root.
      const rootFiles = readdirSync(dir).filter((f) => !f.startsWith('.'));
      const dirs = rootFiles.filter((f) => !f.includes('.'));
      const flatFiles = rootFiles.filter((f) => f.includes('.'));
      expect(flatFiles).toEqual([]);
      expect(dirs).toContain(UNASSIGNED_FOLDER);
    });

    it('leaves *.domain.json files at the root (domains span projects)', () => {
      const dir = makeTempRoot();
      writeJson(join(dir, 'tech.domain.json'), { id: 'd1', name: 'Tech' });
      writeJson(join(dir, `shop${PROJECT_SUFFIX}`), {
        project: { id: 'p1', featureIds: [] }
      });

      migrateFlatLayout(dir);

      expect(readdirSync(dir).sort()).toContain('tech.domain.json');
    });
  });

  describe('walkBySuffix', () => {
    it('walks every snapshot folder for files matching the suffix', () => {
      const dir = makeTempRoot();
      mkdirSync(join(dir, 'shop'));
      mkdirSync(join(dir, UNASSIGNED_FOLDER));
      writeJson(join(dir, 'shop', `shop${PROJECT_SUFFIX}`), { project: { id: 'p1' } });
      writeJson(join(dir, 'shop', `cart${FEATURE_SUFFIX}`), { feature: { id: 'f1' } });
      writeJson(join(dir, UNASSIGNED_FOLDER, `orphan${FEATURE_SUFFIX}`), { feature: { id: 'f2' } });

      const features = walkBySuffix(dir, FEATURE_SUFFIX).map((w) => w.file).sort();
      expect(features).toEqual(['cart.feature.json', 'orphan.feature.json']);
      const projects = walkBySuffix(dir, PROJECT_SUFFIX).map((w) => w.folder);
      expect(projects).toEqual(['shop']);
    });
  });

  it('reads back arbitrary JSON written into the per-project layout', () => {
    const dir = makeTempRoot();
    mkdirSync(join(dir, 'shop'));
    const payload = { feature: { id: 'f1', name: 'Cart' } };
    writeJson(join(dir, 'shop', `cart${FEATURE_SUFFIX}`), payload);
    const walked = walkBySuffix(dir, FEATURE_SUFFIX);
    expect(walked).toHaveLength(1);
    const onDisk = JSON.parse(readFileSync(walked[0]!.path, 'utf8'));
    expect(onDisk).toEqual(payload);
  });
});

describe('fileNamingFromEnv', () => {
  it('defaults to slug and accepts only the explicit id opt-in', () => {
    expect(fileNamingFromEnv({})).toBe('slug');
    expect(fileNamingFromEnv({ UNSPA_FILE_NAMING: 'id' })).toBe('id');
    expect(fileNamingFromEnv({ UNSPA_FILE_NAMING: 'ID' })).toBe('slug');
  });
});
