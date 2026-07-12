import { describe, expect, it } from 'vitest';
import type { Project } from '$features/projects/domain/entities/Project';
import { exportProjectToJson, importProjectFromJson } from './ProjectJson';

// Minimal project carrying one queue item; the queue entry is loosely typed so
// each test can inject the exact on-disk shape it's exercising (incl. legacy).
const projectWithQueue = (queue: readonly unknown[]): Project =>
  ({
    id: 'p1',
    name: 'P',
    description: 'd',
    featureIds: [],
    implementationQueue: queue,
    createdAt: '2026-05-22T00:00:00.000Z',
    updatedAt: '2026-05-22T00:00:00.000Z'
  }) as unknown as Project;

const envelope = (project: Project): string =>
  JSON.stringify({ format: 'unspaghettit-project', version: 1, project });

describe('ProjectJson queue-goal round-trip', () => {
  it('preserves a queue item goal through export -> import', () => {
    const p = projectWithQueue([
      {
        id: 'q1',
        kind: 'action',
        featureId: 'f1',
        actionId: 'a1',
        addedAt: '2026-05-22T00:00:00.000Z',
        target: { implementation: 80, report: true }
      }
    ]);
    const back = importProjectFromJson(exportProjectToJson(p));
    expect(back.implementationQueue?.[0]?.target).toEqual({ implementation: 80, report: true });
  });

  it('migrates the legacy {metric,level,value} goal shape', () => {
    const back = importProjectFromJson(
      envelope(
        projectWithQueue([
          {
            id: 'q1',
            kind: 'feature',
            featureId: 'f1',
            addedAt: '2026-05-22T00:00:00.000Z',
            target: { metric: 'maturity', level: 'half', value: 50 }
          }
        ])
      )
    );
    expect(back.implementationQueue?.[0]?.target).toEqual({ maturity: 50 });
  });

  it('drops an all-empty goal', () => {
    const p = projectWithQueue([
      {
        id: 'q1',
        kind: 'feature',
        featureId: 'f1',
        addedAt: '2026-05-22T00:00:00.000Z',
        target: { report: false }
      }
    ]);
    const back = importProjectFromJson(exportProjectToJson(p));
    expect(back.implementationQueue?.[0]?.target).toBeUndefined();
  });
});

describe('ProjectJson core-features round-trip', () => {
  const project = (over: Record<string, unknown>): Project =>
    ({
      id: 'p1',
      name: 'P',
      description: 'd',
      featureIds: [],
      createdAt: '2026-05-22T00:00:00.000Z',
      updatedAt: '2026-05-22T00:00:00.000Z',
      ...over
    }) as unknown as Project;

  it('preserves the core-feature registry through export -> import', () => {
    const p = project({
      coreFeatures: [
        { value: 'auth', description: 'sign-in' },
        { value: 'billing', description: 'payments' }
      ]
    });
    const back = importProjectFromJson(exportProjectToJson(p));
    expect(back.coreFeatures).toEqual(p.coreFeatures);
  });

  it('loads a project with no coreFeatures key as absent', () => {
    const back = importProjectFromJson(exportProjectToJson(project({})));
    expect(back.coreFeatures).toBeUndefined();
  });
});
