import { describe, expect, it } from 'vitest';
import { asFeatureId } from '$features/behavior-model/domain/value-objects/ids';
import {
  emptyImplementationStatus,
  removeCriterionEvidence,
  upsertCriterionEvidence,
  type CriterionEvidence,
  type ImplementationStatus
} from './ImplementationStatus';

const FEATURE_ID = asFeatureId('feat-1');
const T0 = '2026-09-20T10:00:00.000Z';
const T1 = '2026-09-20T11:00:00.000Z';

const evidence = (criterionId: string, extra: Partial<CriterionEvidence> = {}): CriterionEvidence => ({
  criterionId,
  key: `criterion:${criterionId}`,
  status: 'implemented',
  syncedAt: T0,
  ...extra
});

describe('criterion evidence updates', () => {
  it('inserts a record, bumps the revision and leaves the input untouched', () => {
    const before = emptyImplementationStatus(FEATURE_ID, T0);
    const frozen = JSON.stringify(before);

    const after = upsertCriterionEvidence(before, evidence('c1'), T1);

    expect(after).not.toBe(before);
    expect(JSON.stringify(before)).toBe(frozen);
    expect(before.criteria).toBeUndefined();
    expect(after.revision).toBe(before.revision + 1);
    expect(after.updatedAt).toBe(T1);
    expect(after.criteria).toEqual([evidence('c1')]);
  });

  it('replaces the record of the same criterion and keeps every other one', () => {
    const start: ImplementationStatus = {
      ...emptyImplementationStatus(FEATURE_ID, T0),
      criteria: [evidence('c1', { file: 'old.test.ts' }), evidence('c2', { file: 'kept.test.ts' })]
    };

    const after = upsertCriterionEvidence(start, evidence('c1', { file: 'new.test.ts' }), T1);

    expect(after.criteria).toHaveLength(2);
    expect(after.criteria!.find((c) => c.criterionId === 'c1')?.file).toBe('new.test.ts');
    expect(after.criteria!.find((c) => c.criterionId === 'c2')?.file).toBe('kept.test.ts');
    // The previous list was not edited in place.
    expect(start.criteria![0]!.file).toBe('old.test.ts');
  });

  it('never touches action or surface reports', () => {
    const start = {
      ...emptyImplementationStatus(FEATURE_ID, T0),
      actions: [{ actionId: 'a1' }],
      surfaces: [{ surfaceId: 's1' }]
    } as unknown as ImplementationStatus;

    const after = upsertCriterionEvidence(start, evidence('c1'), T1);

    expect(after.actions).toBe(start.actions);
    expect(after.surfaces).toBe(start.surfaces);
  });

  it('removes a record and bumps the revision', () => {
    const start: ImplementationStatus = {
      ...emptyImplementationStatus(FEATURE_ID, T0),
      criteria: [evidence('c1'), evidence('c2')]
    };

    const after = removeCriterionEvidence(start, 'c1', T1);

    expect(after.criteria?.map((c) => c.criterionId)).toEqual(['c2']);
    expect(after.revision).toBe(start.revision + 1);
    expect(start.criteria).toHaveLength(2);
  });

  it('returns the very same status when there is nothing to remove', () => {
    const start: ImplementationStatus = {
      ...emptyImplementationStatus(FEATURE_ID, T0),
      criteria: [evidence('c1')]
    };
    expect(removeCriterionEvidence(start, 'gone', T1)).toBe(start);
    const bare = emptyImplementationStatus(FEATURE_ID, T0);
    expect(removeCriterionEvidence(bare, 'c1', T1)).toBe(bare);
  });

  it('drops the criteria key with the last record, so the record serializes as it did before', () => {
    const start: ImplementationStatus = {
      ...emptyImplementationStatus(FEATURE_ID, T0),
      criteria: [evidence('c1')]
    };

    const after = removeCriterionEvidence(start, 'c1', T1);

    expect('criteria' in after).toBe(false);
    expect(Object.keys(after).sort()).toEqual(
      Object.keys(emptyImplementationStatus(FEATURE_ID, T0)).sort()
    );
  });
});
