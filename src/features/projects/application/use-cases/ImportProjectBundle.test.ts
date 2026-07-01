import { describe, expect, it, vi } from 'vitest';
import type { ProjectBundleV1 } from '$features/projects/domain/entities/ProjectBundle';
import {
  BundleValidationError,
  importProjectBundleUseCase
} from './ImportProjectBundle';

const makeDeps = () => ({
  features: { save: vi.fn(async () => {}) },
  projects: { save: vi.fn(async () => {}) },
  statuses: { save: vi.fn(async () => {}) }
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (bundle: any, deps = makeDeps()) => ({
  deps,
  promise: importProjectBundleUseCase(deps as never)(bundle as ProjectBundleV1)
});

const baseBundle = (overrides: Record<string, unknown>) =>
  ({
    format: 'unspaghettit-project-bundle',
    version: 1,
    exportedAt: '2026-01-01T00:00:00.000Z',
    project: { id: 'e8300ab2', name: 'P', featureIds: [], createdAt: '', updatedAt: '' },
    features: [],
    statuses: [],
    ...overrides
  }) as unknown as ProjectBundleV1;

describe('importProjectBundleUseCase id validation', () => {
  it('rejects a status featureId that escapes the snapshot tree — before any write', async () => {
    const { deps, promise } = run(
      baseBundle({
        statuses: [{ featureId: '../../../../../../tmp/evil', verifiedActions: [] }]
      })
    );
    await expect(promise).rejects.toBeInstanceOf(BundleValidationError);
    // Fail-closed: nothing persisted, so no partial import is left behind.
    expect(deps.features.save).not.toHaveBeenCalled();
    expect(deps.projects.save).not.toHaveBeenCalled();
    expect(deps.statuses.save).not.toHaveBeenCalled();
  });

  it('rejects a poisoned feature id', async () => {
    const { promise } = run(
      baseBundle({ features: [{ id: 'a/../../b', name: 'x', surfaces: [] }] })
    );
    await expect(promise).rejects.toBeInstanceOf(BundleValidationError);
  });

  it('rejects a poisoned project id', async () => {
    const { promise } = run(baseBundle({ project: { id: '..\\..\\evil', name: 'P', featureIds: [] } }));
    await expect(promise).rejects.toBeInstanceOf(BundleValidationError);
  });

  it('accepts a well-formed bundle (hex + UUID ids)', async () => {
    const { deps, promise } = run(
      baseBundle({
        features: [{ id: '39e57ee0', name: 'F', surfaces: [] }],
        statuses: [
          { featureId: '3f2b1c9a-1d2e-4a5b-8c7d-9e0f1a2b3c4d', verifiedActions: [] }
        ]
      })
    );
    await expect(promise).resolves.toMatchObject({ projectId: 'e8300ab2' });
    expect(deps.features.save).toHaveBeenCalledTimes(1);
    expect(deps.statuses.save).toHaveBeenCalledTimes(1);
  });
});
