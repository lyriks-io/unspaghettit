import { describe, expect, it } from 'vitest';
import type { Action } from '$features/behavior-model/domain/entities/Action';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import {
  asActionId,
  asFeatureId,
  asSurfaceId
} from '$features/behavior-model/domain/value-objects/ids';
import { asEventName } from '$features/behavior-model/domain/value-objects/EventName';
import { analyzeEventCoherence } from './analyzeEventCoherence';

const action = (id: string, name: string, over: Partial<Action> = {}): Action => ({
  id: asActionId(id),
  name,
  intent: 'x',
  parameters: [],
  requiredStates: [],
  rules: [],
  invariants: [],
  effects: [],
  emittedEvents: [],
  transitions: [],
  ...over
});

const feature = (id: string, actions: readonly Action[]): Feature => ({
  id: asFeatureId(id),
  name: `Feature ${id}`,
  surfaces: [
    {
      id: asSurfaceId(`${id}-s`),
      name: 'Main',
      type: 'screen',
      stateDefinitions: [],
      actions,
      rules: [],
      invariants: [],
      transitions: []
    }
  ],
  personas: [],
  resources: [],
  entities: [],
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z'
});

describe('analyzeEventCoherence', () => {
  it('flags a handler whose event nobody emits, across the whole project', () => {
    const emitter = feature('a', [
      action('a1', 'Place order', { emittedEvents: [asEventName('order.placed')] })
    ]);
    const handlers = feature('b', [
      // wired across features → NOT dead (emitter lives in feature a)
      action('b1', 'Log order', { triggeredByEvent: asEventName('order.placed') }),
      // nobody emits this → dead within the model
      action('b2', 'Ghost handler', { triggeredByEvent: asEventName('never.emitted') })
    ]);

    const report = analyzeEventCoherence([emitter, handlers]);

    expect(report.deadHandlers).toHaveLength(1);
    expect(report.deadHandlers[0]!.actionName).toBe('Ghost handler');
    expect(report.deadHandlers[0]!.event).toBe('never.emitted');
  });

  it('reports nothing when every handler is fed by some emitter', () => {
    const report = analyzeEventCoherence([
      feature('a', [
        action('a1', 'Emit', { emittedEvents: [asEventName('thing.done')] }),
        action('a2', 'Handle', { triggeredByEvent: asEventName('thing.done') })
      ])
    ]);
    expect(report.deadHandlers).toEqual([]);
  });
});
