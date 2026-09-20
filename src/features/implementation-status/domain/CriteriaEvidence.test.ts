import { describe, expect, it } from 'vitest';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { CriterionEvidence, ImplementationStatus } from './ImplementationStatus';
import {
  criteriaEvidenceReport,
  criterionEvidenceState,
  isCriterionEvidenceStale,
  verifiedActionsOf
} from './CriteriaEvidence';

const FEATURE_UPDATED = '2026-09-20T12:00:00.000Z';
const CRITERION_CHANGED = '2026-09-10T00:00:00.000Z';
const BEFORE_CHANGE = '2026-09-01T00:00:00.000Z';
const AFTER_CHANGE = '2026-09-15T00:00:00.000Z';
const SYNCED = '2026-09-16T00:00:00.000Z';

const criterion = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
  id,
  title,
  given: '',
  when: '',
  then: '',
  expectedOutcome: 'success',
  ...extra
});

const featureWith = (
  criteria: readonly ReturnType<typeof criterion>[],
  elementVersions?: Record<string, string>
): Feature =>
  ({
    id: 'feat-1',
    name: 'Footsteps',
    description: 'What a step sounds like.',
    surfaces: [],
    personas: [],
    resources: [],
    entities: [],
    events: [],
    acceptanceCriteria: criteria,
    createdAt: BEFORE_CHANGE,
    updatedAt: FEATURE_UPDATED,
    ...(elementVersions ? { elementVersions } : {})
  }) as unknown as Feature;

const record = (criterionId: string, extra: Partial<CriterionEvidence> = {}): CriterionEvidence => ({
  criterionId,
  key: `criterion:${criterionId}`,
  status: 'implemented',
  syncedAt: SYNCED,
  ...extra
});

describe('criterionEvidenceState', () => {
  it('maps the last recorded run, its absence, and the absence of a record', () => {
    const at = SYNCED;
    expect(criterionEvidenceState(undefined)).toBe('none');
    expect(criterionEvidenceState(record('c1'))).toBe('unverified');
    expect(criterionEvidenceState(record('c1', { verification: { kind: 'manual' } }))).toBe(
      'unverified'
    );
    expect(
      criterionEvidenceState(
        record('c1', { verification: { kind: 'unit', lastResult: { passed: true, at } } })
      )
    ).toBe('verified');
    expect(
      criterionEvidenceState(
        record('c1', { verification: { kind: 'e2e', lastResult: { passed: false, at } } })
      )
    ).toBe('failing');
  });
});

describe('isCriterionEvidenceStale', () => {
  const stamped = featureWith([criterion('c1', 'Silent in water')], {
    'criterion:c1': CRITERION_CHANGED
  });

  it('is stale when the criterion changed after the recorded specVersion', () => {
    expect(isCriterionEvidenceStale(stamped, record('c1', { specVersion: BEFORE_CHANGE }))).toBe(true);
  });

  it('is fresh when the check was written against the current wording, whatever else moved', () => {
    // The feature itself moved later (FEATURE_UPDATED); only the element stamp counts.
    expect(isCriterionEvidenceStale(stamped, record('c1', { specVersion: AFTER_CHANGE }))).toBe(false);
  });

  it('cannot judge a record without a readable specVersion, and does not call it stale', () => {
    expect(isCriterionEvidenceStale(stamped, record('c1'))).toBe(false);
    expect(isCriterionEvidenceStale(stamped, record('c1', { specVersion: 'not a date' }))).toBe(false);
  });

  it('falls back to the feature stamp for a snapshot written before element stamps, as drift does', () => {
    const unstamped = featureWith([criterion('c1', 'Silent in water')]);
    expect(isCriterionEvidenceStale(unstamped, record('c1', { specVersion: AFTER_CHANGE }))).toBe(true);
    expect(
      isCriterionEvidenceStale(unstamped, record('c1', { specVersion: '2026-09-21T00:00:00.000Z' }))
    ).toBe(false);
  });
});

describe('criteriaEvidenceReport', () => {
  const feature = featureWith(
    [
      criterion('c1', 'Silent in water', { status: 'superseded' }),
      criterion('c2', 'Shallow water is audible', {
        relations: [{ kind: 'supersedes', criterionId: 'c1' }]
      }),
      criterion('c3', 'Mud muffles every step')
    ],
    { 'criterion:c1': CRITERION_CHANGED, 'criterion:c2': CRITERION_CHANGED, 'criterion:c3': CRITERION_CHANGED }
  );

  it('lists every criterion in model order, with or without a record', () => {
    const status = {
      criteria: [
        record('c2', {
          file: 'shallow.test.ts',
          line: 12,
          specVersion: BEFORE_CHANGE,
          verification: { kind: 'e2e', lastResult: { passed: false, at: SYNCED } }
        }),
        record('c1', {
          file: 'silent.test.ts',
          specVersion: AFTER_CHANGE,
          verification: { kind: 'unit', lastResult: { passed: true, at: SYNCED } }
        })
      ]
    } as Pick<ImplementationStatus, 'criteria'>;

    const report = criteriaEvidenceReport(feature, status);

    expect(report.orphanedCriteria).toBe(0);
    expect(report.criteria.map((row) => row.criterionId)).toEqual(['c1', 'c2', 'c3']);
    expect(report.criteria[0]).toEqual({
      criterionId: 'c1',
      title: 'Silent in water',
      standing: 'superseded by c2',
      key: 'criterion:c1',
      indexed: true,
      state: 'verified',
      stale: false,
      file: 'silent.test.ts',
      verification: { kind: 'unit', lastResult: { passed: true, at: SYNCED } },
      specVersion: AFTER_CHANGE,
      syncedAt: SYNCED
    });
    expect(report.criteria[1]).toMatchObject({ state: 'failing', stale: true, line: 12 });
    // No record: still a row, and nothing invented for it.
    expect(report.criteria[2]).toEqual({
      criterionId: 'c3',
      title: 'Mud muffles every step',
      standing: 'active',
      key: 'criterion:c3',
      indexed: false,
      state: 'none',
      stale: false
    });
  });

  it('leaves out a record whose criterion is gone, and counts it', () => {
    const report = criteriaEvidenceReport(feature, {
      criteria: [record('c1'), record('removed-1'), record('removed-2')]
    });
    expect(report.criteria.map((row) => row.criterionId)).toEqual(['c1', 'c2', 'c3']);
    expect(report.orphanedCriteria).toBe(2);
  });

  it('reads a record written before criteria evidence existed, and no record at all', () => {
    const none = { criterionId: 'c1', indexed: false, state: 'none', stale: false };
    expect(criteriaEvidenceReport(feature, { criteria: undefined }).criteria[0]).toMatchObject(none);
    expect(criteriaEvidenceReport(feature, null).criteria[0]).toMatchObject(none);
    expect(criteriaEvidenceReport(feature, null).orphanedCriteria).toBe(0);
  });

  it('answers an empty list for a feature without criteria', () => {
    const bare = { ...feature, acceptanceCriteria: undefined } as unknown as Feature;
    expect(criteriaEvidenceReport(bare, null)).toEqual({ criteria: [], orphanedCriteria: 0 });
  });
});

describe('verifiedActionsOf', () => {
  it('counts reported actions carrying verifiedAt over reported actions', () => {
    const status = {
      actions: [
        { actionId: 'a1', auditMeta: { verifiedAt: SYNCED } },
        { actionId: 'a2', auditMeta: { auditedAt: SYNCED } },
        { actionId: 'a3' }
      ]
    } as unknown as Pick<ImplementationStatus, 'actions'>;
    expect(verifiedActionsOf(status)).toEqual({ actions: 1, total: 3 });
    expect(verifiedActionsOf(null)).toEqual({ actions: 0, total: 0 });
  });
});
