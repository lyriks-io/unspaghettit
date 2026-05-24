import { beforeEach, describe, expect, it } from 'vitest';
import { fixedClock } from '$shared/domain/Clock';
import {
  asActionId,
  asFeatureId,
  asSurfaceId
} from '$features/behavior-model/domain/value-objects/ids';
import { InMemoryFeatureRepository } from '$features/behavior-model/infrastructure/persistence/InMemoryFeatureRepository';
import { InMemoryImplementationStatusRepository } from '$features/implementation-status/infrastructure/persistence/InMemoryImplementationStatusRepository';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import { reportImplementationStatusUseCase } from './ReportImplementationStatus';

let featureRepo: InMemoryFeatureRepository;
let statusRepo: InMemoryImplementationStatusRepository;

const FEATURE_ID = asFeatureId('feat-1');
const SURFACE_ID = asSurfaceId('surf-1');
const ACTION_ID = asActionId('act-1');
const STATE_HEX_ID = 'a1b2c3d4';
const STATE_PATH = 'cart.itemCount';
const RULE_HEX_ID = 'r1234567';

const feature: Feature = {
  id: FEATURE_ID,
  name: 'Cart',
  description: 'cart',
  surfaces: [
    {
      id: SURFACE_ID,
      name: 'Checkout',
      description: 'checkout',
      stateDefinitions: [
        {
          id: STATE_HEX_ID as never,
          path: STATE_PATH as never,
          type: 'number',
          defaultValue: 0
        } as never
      ],
      actions: [
        {
          id: ACTION_ID,
          name: 'Add To Cart',
          intent: 'add an item',
          parameters: [],
          requiredStates: [],
          emittedEvents: ['ItemAdded' as never],
          rules: [
            {
              id: RULE_HEX_ID as never,
              description: 'stock must be > 0',
              category: 'guard',
              condition: { type: 'literal', value: true } as never
            } as never
          ],
          effects: [],
          invariants: [],
          transitions: []
        } as never
      ],
      rules: [],
      invariants: [],
      transitions: []
    } as never
  ],
  personas: [],
  resources: [],
  entities: [],
  events: [{ id: 'e-1' as never, name: 'ItemAdded' as never } as never],
  createdAt: '2026-05-24T00:00:00.000Z',
  updatedAt: '2026-05-24T00:00:00.000Z'
};

const NOW = '2026-05-24T12:00:00.000Z';

const run = () =>
  reportImplementationStatusUseCase({
    features: featureRepo,
    statuses: statusRepo,
    clock: fixedClock(NOW)
  });

beforeEach(async () => {
  featureRepo = new InMemoryFeatureRepository();
  statusRepo = new InMemoryImplementationStatusRepository();
  await featureRepo.save(feature);
});

describe('reportImplementationStatusUseCase — state path normalization', () => {
  it('matches state entities reported by path against the spec keyed by hex id', async () => {
    const result = await run()({
      featureId: FEATURE_ID,
      surfaceId: SURFACE_ID,
      foundEntities: [
        {
          entityType: 'state',
          entityId: STATE_PATH, // path, not id
          locations: [{ file: 'src/cart.ts', line: 9 }]
        }
      ]
    });

    expect(result.foundEntities).toHaveLength(1);
    expect(result.foundEntities[0]).toMatchObject({
      entityType: 'state',
      entityId: STATE_HEX_ID,
      locations: [{ file: 'src/cart.ts', line: 9 }]
    });
    expect(result.rejectedEntities).toEqual([]);
  });

  it('still matches state entities reported by hex id', async () => {
    const result = await run()({
      featureId: FEATURE_ID,
      surfaceId: SURFACE_ID,
      foundEntities: [
        {
          entityType: 'state',
          entityId: STATE_HEX_ID, // hex id
          locations: [{ file: 'src/cart.ts', line: 9 }]
        }
      ]
    });

    expect(result.foundEntities).toHaveLength(1);
    expect(result.foundEntities[0]?.entityId).toBe(STATE_HEX_ID);
    expect(result.rejectedEntities).toEqual([]);
  });
});

describe('reportImplementationStatusUseCase — rejectedEntities surfacing', () => {
  it('returns a rejectedEntity (not silently drops) when an action id does not match', async () => {
    const result = await run()({
      featureId: FEATURE_ID,
      actionId: ACTION_ID,
      foundEntities: [
        {
          entityType: 'action',
          entityId: 'add-to-cart', // slug, wrong format
          locations: [{ file: 'src/cart.ts', line: 1 }]
        }
      ]
    });

    expect(result.foundEntities).toHaveLength(0);
    expect(result.rejectedEntities).toHaveLength(1);
    expect(result.rejectedEntities[0]).toMatchObject({
      entityType: 'action',
      entityId: 'add-to-cart'
    });
    expect(result.rejectedEntities[0]?.reason).toMatch(/no action matching id "add-to-cart"/i);
    expect(result.rejectedEntities[0]?.reason).toMatch(/8-char hex/);
  });

  it('mentions the path-or-id rule in the reason for a rejected state entity', async () => {
    const result = await run()({
      featureId: FEATURE_ID,
      surfaceId: SURFACE_ID,
      foundEntities: [
        {
          entityType: 'state',
          entityId: 'totally.unknown.path',
          locations: [{ file: 'x', line: 1 }]
        }
      ]
    });

    expect(result.rejectedEntities).toHaveLength(1);
    expect(result.rejectedEntities[0]?.reason).toMatch(/path/i);
    expect(result.rejectedEntities[0]?.reason).toMatch(/hex id/i);
  });

  it('mentions the event-name rule in the reason for a rejected event entity', async () => {
    const result = await run()({
      featureId: FEATURE_ID,
      actionId: ACTION_ID,
      foundEntities: [
        {
          entityType: 'event',
          entityId: 'e1234567', // hex-looking, but events use names
          locations: [{ file: 'x', line: 1 }]
        }
      ]
    });

    expect(result.rejectedEntities).toHaveLength(1);
    expect(result.rejectedEntities[0]?.reason).toMatch(/event/i);
    expect(result.rejectedEntities[0]?.reason).toMatch(/name/i);
  });

  it('returns an empty rejectedEntities list when every reported entity matches', async () => {
    const result = await run()({
      featureId: FEATURE_ID,
      actionId: ACTION_ID,
      foundEntities: [
        { entityType: 'action', entityId: String(ACTION_ID), locations: [{ file: 'x', line: 1 }] },
        { entityType: 'rule', entityId: RULE_HEX_ID, locations: [{ file: 'x', line: 2 }] },
        { entityType: 'event', entityId: 'ItemAdded', locations: [{ file: 'x', line: 3 }] }
      ]
    });

    expect(result.foundEntities).toHaveLength(3);
    expect(result.rejectedEntities).toEqual([]);
  });

  it('separates caller-supplied extraTags from rejected reported entities', async () => {
    // Pre-0.1.5 these would have been mixed in extraTags. Now extraTags only
    // carries caller-supplied tags; unmatched reportedEntities go to rejected.
    const result = await run()({
      featureId: FEATURE_ID,
      actionId: ACTION_ID,
      foundEntities: [
        { entityType: 'action', entityId: 'wrong-id', locations: [{ file: 'x', line: 1 }] }
      ],
      extraTags: [
        { tag: '@unspa:custom', locations: [{ file: 'x', line: 2 }] }
      ]
    });

    expect(result.rejectedEntities).toHaveLength(1);
    expect(result.rejectedEntities[0]?.entityId).toBe('wrong-id');
    // foundEntities is empty (the only reported one was rejected)
    expect(result.foundEntities).toEqual([]);
  });
});
