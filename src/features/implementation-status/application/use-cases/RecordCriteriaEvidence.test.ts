import { beforeEach, describe, expect, it } from 'vitest';
import { fixedClock } from '$shared/domain/Clock';
import { asFeatureId } from '$features/behavior-model/domain/value-objects/ids';
import { InMemoryFeatureRepository } from '$features/behavior-model/infrastructure/persistence/InMemoryFeatureRepository';
import { InMemoryImplementationStatusRepository } from '$features/implementation-status/infrastructure/persistence/InMemoryImplementationStatusRepository';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import { FeatureNotFoundForReportError } from './ReportImplementationStatus';
import { recordCriteriaEvidenceUseCase } from './RecordCriteriaEvidence';

const FEATURE_ID = asFeatureId('feat-1');
const FIRST = '2026-09-20T10:00:00.000Z';
const SECOND = '2026-09-20T11:00:00.000Z';

const feature = {
  id: FEATURE_ID,
  name: 'Footsteps',
  description: 'What a step sounds like.',
  surfaces: [],
  personas: [],
  resources: [],
  entities: [],
  events: [],
  acceptanceCriteria: ['c1', 'c2', 'c3'].map((id) => ({
    id,
    title: `Criterion ${id}`,
    given: '',
    when: '',
    then: '',
    expectedOutcome: 'success'
  })),
  createdAt: FIRST,
  updatedAt: FIRST
} as unknown as Feature;

let featureRepo: InMemoryFeatureRepository;
let statusRepo: InMemoryImplementationStatusRepository;

const at = (now: string) =>
  recordCriteriaEvidenceUseCase({ features: featureRepo, statuses: statusRepo, clock: fixedClock(now) });

beforeEach(async () => {
  featureRepo = new InMemoryFeatureRepository();
  statusRepo = new InMemoryImplementationStatusRepository();
  await featureRepo.save(feature);
});

describe('recordCriteriaEvidenceUseCase', () => {
  it('keeps a record per criterion, stamped with its key and the time of the sync', async () => {
    const out = await at(FIRST)({
      featureId: FEATURE_ID,
      evidence: [
        { criterionId: 'c1', status: 'implemented', file: 'silent.test.ts' },
        { criterionId: 'c2', status: 'partial' }
      ],
      missing: []
    });

    expect(out).toMatchObject({ written: 2, removed: 0, rejected: [] });
    const stored = await statusRepo.get(FEATURE_ID);
    expect(stored?.criteria).toEqual([
      { criterionId: 'c1', key: 'criterion:c1', status: 'implemented', file: 'silent.test.ts', syncedAt: FIRST },
      { criterionId: 'c2', key: 'criterion:c2', status: 'partial', syncedAt: FIRST }
    ]);
    expect(stored?.revision).toBe(out.revision);
  });

  it('follows the partial-index rule: a criterion the sync does not name keeps its record', async () => {
    await at(FIRST)({
      featureId: FEATURE_ID,
      evidence: [
        { criterionId: 'c1', status: 'implemented', file: 'silent.test.ts' },
        { criterionId: 'c2', status: 'implemented', file: 'shallow.test.ts' }
      ],
      missing: []
    });

    await at(SECOND)({
      featureId: FEATURE_ID,
      evidence: [{ criterionId: 'c2', status: 'implemented', file: 'shallow.v2.test.ts' }],
      missing: []
    });

    const byId = new Map((await statusRepo.get(FEATURE_ID))!.criteria!.map((c) => [c.criterionId, c]));
    expect(byId.get('c1')).toMatchObject({ file: 'silent.test.ts', syncedAt: FIRST });
    expect(byId.get('c2')).toMatchObject({ file: 'shallow.v2.test.ts', syncedAt: SECOND });
  });

  it('removes the record of a criterion the index names as missing', async () => {
    await at(FIRST)({
      featureId: FEATURE_ID,
      evidence: [
        { criterionId: 'c1', status: 'implemented' },
        { criterionId: 'c2', status: 'implemented' }
      ],
      missing: []
    });

    const out = await at(SECOND)({ featureId: FEATURE_ID, evidence: [], missing: ['c1', 'c3'] });

    // c3 never had a record: naming it missing removes nothing.
    expect(out.removed).toBe(1);
    expect((await statusRepo.get(FEATURE_ID))!.criteria!.map((c) => c.criterionId)).toEqual(['c2']);
  });

  it('writes nothing when the sync names no criterion', async () => {
    const out = await at(FIRST)({ featureId: FEATURE_ID, evidence: [], missing: [] });
    expect(out).toMatchObject({ written: 0, removed: 0, revision: 0 });
    expect(await statusRepo.get(FEATURE_ID)).toBeNull();
  });

  it('never keeps a record for a criterion the feature does not hold', async () => {
    const out = await at(FIRST)({
      featureId: FEATURE_ID,
      evidence: [{ criterionId: 'ghost', status: 'implemented' }],
      missing: ['phantom']
    });
    expect(out).toMatchObject({ written: 0, removed: 0, rejected: ['ghost', 'phantom'] });
    expect(await statusRepo.get(FEATURE_ID)).toBeNull();
  });

  it('leaves the action and surface reports of the record alone', async () => {
    const seeded = {
      featureId: FEATURE_ID,
      revision: 7,
      updatedAt: FIRST,
      actions: [{ actionId: 'a1' }],
      surfaces: [{ surfaceId: 's1' }]
    } as never;
    await statusRepo.save(seeded);

    await at(SECOND)({
      featureId: FEATURE_ID,
      evidence: [{ criterionId: 'c1', status: 'implemented' }],
      missing: []
    });

    const stored = await statusRepo.get(FEATURE_ID);
    expect(stored).toMatchObject({ revision: 8, actions: [{ actionId: 'a1' }], surfaces: [{ surfaceId: 's1' }] });
  });

  it('refuses a feature that does not exist', async () => {
    await expect(
      at(FIRST)({ featureId: asFeatureId('nope'), evidence: [], missing: [] })
    ).rejects.toBeInstanceOf(FeatureNotFoundForReportError);
  });
});
