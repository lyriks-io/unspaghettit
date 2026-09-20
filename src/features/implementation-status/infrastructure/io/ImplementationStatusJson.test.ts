import { describe, expect, it } from 'vitest';
import {
  exportImplementationStatusToJson,
  importImplementationStatusFromJson
} from './ImplementationStatusJson';

const REPORTED = '2026-09-01T10:00:00.000Z';
const SYNCED = '2026-09-20T10:00:00.000Z';

/** A sidecar exactly as 0.23 wrote it: no `criteria`, no `verifiedAt` anywhere. */
const RECORD_0_23 = {
  format: 'unspaghettit-implementation-status',
  version: 3,
  status: {
    featureId: 'feat-1',
    revision: 4,
    updatedAt: REPORTED,
    actions: [
      {
        actionId: 'a1b2c3d4',
        actionSlug: 'take-a-step',
        actionName: 'Take a step',
        surfaceId: 's1s2s3s4',
        expectedEntities: [
          { entityType: 'action', entityId: 'a1b2c3d4', entityName: 'Take a step', tag: '@unspa:action:take-a-step' }
        ],
        foundEntities: [
          {
            entityType: 'action',
            entityId: 'a1b2c3d4',
            entityName: 'Take a step',
            tag: '@unspa:action:take-a-step',
            locations: [{ file: 'step.ts', line: 1, snippet: 'export const step' }],
            capturedAt: REPORTED
          }
        ],
        missingEntities: [],
        extraTags: [],
        reportedAt: REPORTED,
        auditMeta: { auditedAt: REPORTED, gitCommit: 'abc1234', kind: 'domain-service' }
      }
    ],
    surfaces: []
  }
};

describe('implementation status io', () => {
  it('loads a 0.23 record as before, and writes it back without a new key', () => {
    const loaded = importImplementationStatusFromJson(JSON.stringify(RECORD_0_23));

    expect(loaded).toEqual(RECORD_0_23.status);
    expect('criteria' in loaded).toBe(false);
    expect(loaded.actions[0]!.auditMeta).toEqual(RECORD_0_23.status.actions[0]!.auditMeta);
    expect(JSON.parse(exportImplementationStatusToJson(loaded))).toEqual(RECORD_0_23);
  });

  it('round-trips criteria evidence and the proven stamp of an action', () => {
    const criteria = [
      {
        criterionId: 'c1c1c1c1',
        key: 'criterion:c1c1c1c1',
        status: 'partial',
        file: 'silent.test.ts',
        line: 12,
        signature: "it('is silent in water'",
        verification: {
          kind: 'unit',
          command: 'npx vitest run silent.test.ts',
          files: ['silent.test.ts'],
          artifacts: ['recordings/water.wav'],
          lastResult: { passed: true, at: SYNCED, summary: '6 of 6', revision: 'abc1234' }
        },
        specVersion: REPORTED,
        syncedAt: SYNCED
      }
    ];
    const record = structuredClone(RECORD_0_23) as {
      status: { criteria?: unknown; actions: { auditMeta: Record<string, unknown> }[] };
    };
    record.status.criteria = criteria;
    record.status.actions[0]!.auditMeta.verifiedAt = SYNCED;

    const loaded = importImplementationStatusFromJson(JSON.stringify(record));

    expect(loaded.criteria).toEqual(criteria);
    expect(loaded.actions[0]!.auditMeta?.verifiedAt).toBe(SYNCED);
    expect(JSON.parse(exportImplementationStatusToJson(loaded))).toEqual(record);
  });

  it('reads criteria leniently: an unreadable part costs that part, an unnamed record is dropped', () => {
    const record = structuredClone(RECORD_0_23) as { status: { criteria?: unknown } };
    record.status.criteria = [
      { criterionId: 'c1', syncedAt: SYNCED, status: 'whatever', verification: { kind: 'vibes' }, line: 'x' },
      { criterionId: 'c2', syncedAt: SYNCED, verification: { kind: 'manual', lastResult: { passed: 'yes' } } },
      { syncedAt: SYNCED },
      { criterionId: 'c3' },
      'garbage'
    ];

    const loaded = importImplementationStatusFromJson(JSON.stringify(record));

    expect(loaded.criteria).toEqual([
      { criterionId: 'c1', key: 'criterion:c1', status: 'implemented', syncedAt: SYNCED },
      {
        criterionId: 'c2',
        key: 'criterion:c2',
        status: 'implemented',
        verification: { kind: 'manual' },
        syncedAt: SYNCED
      }
    ]);
  });
});
