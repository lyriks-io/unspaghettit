import { describe, expect, it } from 'vitest';
import type { Action } from '../entities/Action';
import type { Feature } from '../entities/Feature';
import {
  asActionId,
  asEffectId,
  asFeatureId,
  asParameterId,
  asSurfaceId
} from '../value-objects/ids';
import { asEventName } from '../value-objects/EventName';
import { asStatePath } from '../value-objects/StatePath';
import { rollupActions } from './ActionRollup';

const action = (id: string, event: string): Action => ({
  id: asActionId(id),
  name: `Action ${id}`,
  intent: 'Change shared state',
  parameters: [
    {
      id: asParameterId(`param-${id}`),
      name: 'status',
      type: 'string',
      required: true,
      bindToStatePath: asStatePath('rma.status')
    }
  ],
  requiredStates: [asStatePath('rma.status')],
  rules: [],
  invariants: [],
  effects: [
    {
      id: asEffectId(`effect-${id}`),
      type: 'set_state',
      path: asStatePath('rma.status'),
      value: 'approved'
    },
    {
      id: asEffectId(`event-${id}`),
      type: 'emit_event',
      event: asEventName(event)
    }
  ],
  emittedEvents: [asEventName(event)],
  transitions: [],
  roles: ['primary', 'persistence'],
  scenarios: []
});

const feature = (id: string, containedAction: Action): Feature =>
  ({
    id: asFeatureId(id),
    name: `Feature ${id}`,
    description: 'Feature description',
    surfaces: [
      {
        id: asSurfaceId(`surface-${id}`),
        name: `Surface ${id}`,
        type: 'screen',
        description: 'Surface description',
        stateDefinitions: [],
        actions: [containedAction],
        rules: [],
        invariants: [],
        transitions: []
      }
    ],
    personas: [],
    resources: [],
    entities: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }) as Feature;

describe('action rollups', () => {
  it('rolls every action facet upward while preserving provenance', () => {
    const rollup = rollupActions([feature('one', action('approve', 'rma.approved'))]);

    expect(rollup.stats).toMatchObject({
      actions: 1,
      parameters: 1,
      effects: 2,
      uniqueStatePaths: 1,
      uniqueEvents: 1,
      roles: expect.objectContaining({ primary: 1, persistence: 1 })
    });
    expect(rollup.actions[0]).toMatchObject({
      featureId: 'one',
      surfaceId: 'surface-one',
      actionId: 'approve',
      references: {
        statePaths: ['rma.status'],
        events: ['rma.approved'],
        resources: [],
        valueSets: [],
        parameterNames: ['status'],
        effectTypes: ['emit_event', 'set_state']
      }
    });
  });

  it('marks reusable concepts that cross feature boundaries', () => {
    const rollup = rollupActions([
      feature('one', action('approve', 'rma.changed')),
      feature('two', action('reject', 'rma.changed'))
    ]);

    expect(rollup.concepts).toContainEqual(
      expect.objectContaining({
        kind: 'state',
        value: 'rma.status',
        occurrences: 2,
        crossFeature: true,
        featureIds: [asFeatureId('one'), asFeatureId('two')]
      })
    );
    expect(rollup.concepts).toContainEqual(
      expect.objectContaining({ kind: 'event', value: 'rma.changed', crossFeature: true })
    );
  });
});
