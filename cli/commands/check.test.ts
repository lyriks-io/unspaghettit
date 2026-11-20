import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JsonFolderFeatureRepository } from '../../src/features/behavior-model/infrastructure/persistence/JsonFolderFeatureRepository';
import { storefrontFeature } from '../../src/features/behavior-model/infrastructure/seed/seedStorefront';
import { runCheckCommand } from './check';

/**
 * `unspa check` named a feature or a project that does not exist: the gate
 * verified nothing and passed (exit 0), so a mistyped or removed feature in a
 * CI job read green. It is now an error, exit 2, like a missing snapshots folder.
 */

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const hubWithStorefront = async (): Promise<string> => {
  const root = mkdtempSync(join(tmpdir(), 'unspa-check-'));
  roots.push(root);
  const snapshots = join(root, 'unspa');
  await new JsonFolderFeatureRepository(snapshots).save(storefrontFeature);
  return snapshots;
};

const run = async (options: Parameters<typeof runCheckCommand>[0]) => {
  const written: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    written.push(String(chunk));
    return true;
  });
  const code = await runCheckCommand(options);
  return { code, out: written.join('') };
};

describe('unspa check scoped to what does not exist', () => {
  it('fails on a feature that does not exist', async () => {
    const snapshots = await hubWithStorefront();
    const { code, out } = await run({ snapshots, cwd: snapshots, featureId: 'feature-gone', json: true });
    expect(code).toBe(2);
    expect(JSON.parse(out)).toMatchObject({ error: 'not-found', featureId: 'feature-gone' });
  });

  it('fails on a project that does not exist', async () => {
    const snapshots = await hubWithStorefront();
    const { code, out } = await run({ snapshots, cwd: snapshots, project: 'project-gone', json: true });
    expect(code).toBe(2);
    expect(JSON.parse(out)).toMatchObject({ error: 'not-found', projectId: 'project-gone' });
  });

  it('still verifies a feature that exists', async () => {
    const snapshots = await hubWithStorefront();
    const { code, out } = await run({ snapshots, cwd: snapshots, featureId: String(storefrontFeature.id), json: true });
    expect(code).toBe(0);
    expect(JSON.parse(out).summary.featuresChecked).toBe(1);
  });
});
