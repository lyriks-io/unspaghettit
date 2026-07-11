import { describe, expect, it } from 'vitest';
import { simulate } from './SimulatorEngine';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Surface } from '$features/behavior-model/domain/entities/Surface';
import type { Action } from '$features/behavior-model/domain/entities/Action';
import {
  asActionId,
  asDependencyId,
  asEffectId,
  asEventDefinitionId,
  asFeatureId,
  asInvariantId,
  asOutcomeId,
  asParameterId,
  asRuleId,
  asStateDefinitionId,
  asSurfaceId
} from '$features/behavior-model/domain/value-objects/ids';
import { asStatePath } from '$features/behavior-model/domain/value-objects/StatePath';
import { asEventName } from '$features/behavior-model/domain/value-objects/EventName';
import { buildInitialSnapshot } from '$features/behavior-model/domain/services/StateSnapshot';

const buildCanvasSurface = (): Surface => ({
  id: asSurfaceId('s'),
  name: 'Board',
  type: 'canvas',
  stateDefinitions: [
    {
      id: asStateDefinitionId('d1'),
      path: asStatePath('selection.count'),
      type: 'number',
      defaultValue: 0
    },
    {
      id: asStateDefinitionId('d2'),
      path: asStatePath('selection.locked'),
      type: 'boolean',
      defaultValue: false
    },
    {
      id: asStateDefinitionId('d3'),
      path: asStatePath('user.role'),
      type: 'enum',
      enumValues: ['viewer', 'editor'],
      defaultValue: 'editor'
    }
  ],
  actions: [],
  rules: [],
  invariants: [],
  transitions: []
});

const deleteSelection: Action = {
  id: asActionId('c1'),
  name: 'Delete selection',
  intent: 'remove selected',
  parameters: [],
  requiredStates: [],
  rules: [
    {
      id: asRuleId('r1'),
      category: 'ux_feedback',
      condition: { left: asStatePath('selection.count'), operator: 'equals', right: 0 },
      effect: { id: asEffectId('e1'), type: 'block_action', reason: 'Nothing to delete' }
    },
    {
      id: asRuleId('r2'),
      category: 'business',
      condition: { left: asStatePath('selection.locked'), operator: 'is_true' },
      effect: { id: asEffectId('e2'), type: 'block_action', reason: 'Locked' }
    },
    {
      id: asRuleId('r3'),
      category: 'permissions',
      condition: { left: asStatePath('user.role'), operator: 'not_equals', right: 'editor' },
      effect: { id: asEffectId('e3'), type: 'block_action', reason: 'Not editor' }
    }
  ],
  invariants: [],
  effects: [
    {
      id: asEffectId('e4'),
      type: 'set_state',
      path: asStatePath('selection.count'),
      value: 0
    },
    { id: asEffectId('e5'), type: 'emit_event', event: asEventName('selection.deleted') }
  ],
  emittedEvents: [asEventName('selection.deleted')],
  transitions: []
};

describe('simulate', () => {
  it('blocks when selection is empty (matches user-facing example)', () => {
    const surface = buildCanvasSurface();
    const result = simulate({
      surface,
      action: deleteSelection,
      snapshot: buildInitialSnapshot(surface.stateDefinitions),
      parameters: {}
    });
    expect(result.status).toBe('blocked');
    expect(result.messages.map((m) => m.text)).toContain('Nothing to delete');
    expect(result.emittedEvents).toEqual([]);
    expect(result.nextState).toEqual(result.previousState);
  });

  it('blocks when selection is locked', () => {
    const surface = buildCanvasSurface();
    const snapshot = buildInitialSnapshot(surface.stateDefinitions);
    const result = simulate({
      surface,
      action: deleteSelection,
      snapshot: { ...snapshot, selection: { count: 2, locked: true } },
      parameters: {}
    });
    expect(result.status).toBe('blocked');
    expect(result.messages.map((m) => m.text)).toContain('Locked');
  });

  it('blocks when role is not editor', () => {
    const surface = buildCanvasSurface();
    const snapshot = buildInitialSnapshot(surface.stateDefinitions);
    const result = simulate({
      surface,
      action: deleteSelection,
      snapshot: { ...snapshot, selection: { count: 2, locked: false }, user: { role: 'viewer' } },
      parameters: {}
    });
    expect(result.status).toBe('blocked');
    expect(result.messages.map((m) => m.text)).toContain('Not editor');
  });

  it('succeeds and applies default effects when nothing blocks', () => {
    const surface = buildCanvasSurface();
    const snapshot = buildInitialSnapshot(surface.stateDefinitions);
    const result = simulate({
      surface,
      action: deleteSelection,
      snapshot: { ...snapshot, selection: { count: 2, locked: false }, user: { role: 'editor' } },
      parameters: {}
    });
    expect(result.status).toBe('success');
    expect(result.emittedEvents).toContain('selection.deleted');
    expect((result.nextState.selection as { count: number }).count).toBe(0);
  });

  it('reports parameter errors as failed', () => {
    const surface = buildCanvasSurface();
    const cap: Action = {
      ...deleteSelection,
      parameters: [
        {
          id: asEffectId('p1') as unknown as never,
          name: 'reason',
          type: 'string',
          required: true
        }
      ]
    };
    const result = simulate({
      surface,
      action: cap,
      snapshot: buildInitialSnapshot(surface.stateDefinitions),
      parameters: {}
    });
    expect(result.status).toBe('blocked');
    expect(result.parameterErrors).toHaveLength(1);
  });

  it('runs onBlockedEffects when a rule blocks the action', () => {
    const cap: Action = {
      ...deleteSelection,
      rules: [
        {
          id: asRuleId('r-block'),
          category: 'permissions',
          condition: { left: asStatePath('user.role'), operator: 'equals', right: 'viewer' },
          effect: {
            id: asEffectId('e-block'),
            type: 'block_action',
            reason: 'Viewer access. Cannot delete.'
          }
        }
      ],
      effects: [
        {
          id: asEffectId('e-success'),
          type: 'emit_event',
          event: asEventName('selection.deleted')
        }
      ],
      onBlockedEffects: [
        {
          id: asEffectId('e-redirect'),
          type: 'transition_surface',
          target: asSurfaceId('upgrade-prompt')
        },
        {
          id: asEffectId('e-fallback-event'),
          type: 'emit_event',
          event: asEventName('blocked.delete_attempt')
        }
      ]
    };
    const surface: Surface = {
      ...buildCanvasSurface(),
      stateDefinitions: buildCanvasSurface().stateDefinitions
    };
    const baseSnapshot = buildInitialSnapshot(surface.stateDefinitions);
    const result = simulate({
      surface,
      action: cap,
      snapshot: { ...baseSnapshot, user: { role: 'viewer' } },
      parameters: {}
    });
    expect(result.status).toBe('blocked');
    // Default success effect did NOT fire
    expect(result.emittedEvents).not.toContain('selection.deleted');
    // onBlockedEffects DID fire
    expect(result.emittedEvents).toContain('blocked.delete_attempt');
    expect(result.transition).toBe('upgrade-prompt');
  });

  it('fills missing snapshot paths with their stateDefinition defaults before evaluating', () => {
    // Surface defines selection.count default = 0 and an invariant count >= 0.
    // If the caller passes an empty snapshot (no selection.count), the simulator
    // must NOT treat undefined as an invariant violation. It should fall back
    // to the declared default.
    const surface: Surface = {
      ...buildCanvasSurface(),
      invariants: [
        {
          id: asInvariantId('i-non-negative'),
          name: 'count >= 0',
          condition: {
            left: asStatePath('selection.count'),
            operator: 'greater_than',
            right: -1
          },
          message: 'count went negative'
        }
      ]
    };
    const cap: Action = {
      ...deleteSelection,
      // Drop all rules so nothing else interferes; only the invariant matters.
      rules: [],
      effects: [
        {
          id: asEffectId('e-emit'),
          type: 'emit_event',
          event: asEventName('test.completed')
        }
      ]
    };
    const result = simulate({
      surface,
      action: cap,
      snapshot: {},
      parameters: {}
    });
    expect(result.status).toBe('success');
    expect(result.invariantViolations).toEqual([]);
    // previousState should reflect the merged defaults so callers see what
    // was actually evaluated against.
    expect((result.previousState.selection as { count: number }).count).toBe(0);
  });

  const twoInvariantSurface = (): Surface => ({
    ...buildCanvasSurface(),
    invariants: [
      {
        id: asInvariantId('i-non-negative'),
        name: 'count >= 0',
        condition: {
          left: asStatePath('selection.count'),
          operator: 'greater_than',
          right: -1
        },
        message: 'count went negative'
      },
      {
        id: asInvariantId('i-unlocked'),
        name: 'not locked',
        condition: { left: asStatePath('selection.locked'), operator: 'is_false' },
        message: 'selection is locked'
      }
    ]
  });

  it('scoped invariantRelaxation skips only the named invariant', () => {
    const surface = twoInvariantSurface();
    const repair: Action = {
      ...deleteSelection,
      id: asActionId('repair'),
      rules: [],
      invariants: [],
      effects: [
        {
          id: asEffectId('drive-negative'),
          type: 'set_state',
          path: asStatePath('selection.count'),
          value: -5
        }
      ],
      emittedEvents: [],
      invariantRelaxation: {
        invariantIds: [asInvariantId('i-non-negative')],
        rationale: 'Repair action reconciles the counter.'
      }
    };
    const relaxed = simulate({ surface, action: repair, snapshot: {}, parameters: {} });
    expect(relaxed.status).toBe('success');
    expect(relaxed.invariantViolations).toEqual([]);

    // Control: without the relaxation the same write violates count >= 0.
    const strict: Action = { ...repair, invariantRelaxation: undefined };
    const blocked = simulate({ surface, action: strict, snapshot: {}, parameters: {} });
    expect(blocked.status).toBe('blocked');
    expect(blocked.invariantViolations.length).toBeGreaterThan(0);
  });

  it('resolves the first matching first-class outcome and applies its effects', () => {
    const surface: Surface = {
      id: asSurfaceId('checkout'),
      name: 'Checkout',
      type: 'screen',
      stateDefinitions: [
        {
          id: asStateDefinitionId('os'),
          path: asStatePath('order.status'),
          type: 'enum',
          enumValues: ['pending', 'charging', 'paid', 'declined'],
          defaultValue: 'pending'
        },
        {
          id: asStateDefinitionId('pd'),
          path: asStatePath('payment.declined'),
          type: 'boolean',
          defaultValue: false
        }
      ],
      actions: [],
      rules: [],
      invariants: [],
      transitions: []
    };
    const charge: Action = {
      id: asActionId('charge'),
      name: 'Charge',
      intent: 'Charge the card.',
      parameters: [],
      requiredStates: [],
      rules: [],
      invariants: [],
      effects: [
        {
          id: asEffectId('mark-charging'),
          type: 'set_state',
          path: asStatePath('order.status'),
          value: 'charging'
        }
      ],
      emittedEvents: [],
      transitions: [],
      outcomes: [
        {
          id: asOutcomeId('declined'),
          name: 'Declined',
          kind: 'failure',
          condition: { left: asStatePath('payment.declined'), operator: 'is_true' },
          effects: [
            {
              id: asEffectId('mark-declined'),
              type: 'set_state',
              path: asStatePath('order.status'),
              value: 'declined'
            }
          ]
        },
        {
          id: asOutcomeId('paid'),
          name: 'Paid',
          kind: 'success',
          effects: [
            {
              id: asEffectId('mark-paid'),
              type: 'set_state',
              path: asStatePath('order.status'),
              value: 'paid'
            }
          ]
        }
      ]
    };

    const declined = simulate({
      surface,
      action: charge,
      snapshot: { payment: { declined: true } },
      parameters: {}
    });
    expect(declined.status).toBe('success');
    expect(declined.outcome).toEqual({ name: 'Declined', kind: 'failure', outcomeId: 'declined' });
    expect((declined.nextState.order as { status: string }).status).toBe('declined');

    const paid = simulate({
      surface,
      action: charge,
      snapshot: { payment: { declined: false } },
      parameters: {}
    });
    expect(paid.outcome?.kind).toBe('success');
    expect((paid.nextState.order as { status: string }).status).toBe('paid');
  });

  it('leaves outcome undefined when an action declares none (back-compat)', () => {
    const result = simulate({
      surface: buildCanvasSurface(),
      action: deleteSelection,
      snapshot: { selection: { count: 3 } },
      parameters: {}
    });
    expect(result.status).toBe('success');
    expect(result.outcome).toBeUndefined();
  });

  it('invariantRelaxation still enforces the invariants it does not name', () => {
    const surface = twoInvariantSurface();
    const action: Action = {
      ...deleteSelection,
      id: asActionId('half-repair'),
      rules: [],
      invariants: [],
      // Relaxes only i-non-negative, but this write violates i-unlocked.
      effects: [
        {
          id: asEffectId('lock-it'),
          type: 'set_state',
          path: asStatePath('selection.locked'),
          value: true
        }
      ],
      emittedEvents: [],
      invariantRelaxation: {
        invariantIds: [asInvariantId('i-non-negative')],
        rationale: 'Only the counter invariant may be relaxed.'
      }
    };
    const result = simulate({ surface, action, snapshot: {}, parameters: {} });
    expect(result.status).toBe('blocked');
    expect(result.invariantViolations.length).toBeGreaterThan(0);
  });

  it('cascades event handlers in the same feature when the parent emits a matching event', () => {
    // Parent: emits `selection.deleted`. Handler: triggeredByEvent=`selection.deleted`,
    // increments a counter when it runs. The handler must live in the same
    // feature for the cascade to find it.
    const surface = buildCanvasSurface();
    const counterDef = {
      id: asStateDefinitionId('d-counter'),
      path: asStatePath('handlerRuns'),
      type: 'number' as const,
      defaultValue: 0
    };
    const surfaceWithCounter: Surface = {
      ...surface,
      stateDefinitions: [...surface.stateDefinitions, counterDef]
    };
    const handler: Action = {
      id: asActionId('handler-1'),
      name: 'On Delete Recount',
      intent: 'Count successful deletes via cascade.',
      parameters: [],
      requiredStates: [],
      rules: [],
      invariants: [],
      effects: [
        {
          id: asEffectId('e-count'),
          type: 'set_state',
          path: asStatePath('handlerRuns'),
          value: {
            kind: 'add',
            left: { kind: 'state', path: asStatePath('handlerRuns') },
            right: { kind: 'literal', value: 1 }
          }
        }
      ],
      emittedEvents: [],
      transitions: [],
      triggeredByEvent: asEventName('selection.deleted')
    };
    const surfaceWithHandler: Surface = {
      ...surfaceWithCounter,
      actions: [deleteSelection, handler]
    };
    const feature: Feature = {
      id: asFeatureId('feat-1'),
      name: 'Cascade Demo',
      surfaces: [surfaceWithHandler],
      personas: [],
      resources: [],
      entities: [],
      createdAt: '2026-05-16T00:00:00.000Z',
      updatedAt: '2026-05-16T00:00:00.000Z'
    };
    const snapshot = buildInitialSnapshot(surfaceWithHandler.stateDefinitions);
    const result = simulate({
      surface: surfaceWithHandler,
      action: deleteSelection,
      snapshot: { ...snapshot, selection: { count: 2, locked: false }, user: { role: 'editor' } },
      parameters: {},
      feature
    });
    expect(result.status).toBe('success');
    expect(result.cascadedHandlers).toBeDefined();
    expect(result.cascadedHandlers).toHaveLength(1);
    expect(result.cascadedHandlers?.[0]?.triggeredBy).toBe('selection.deleted');
    expect(result.cascadedHandlers?.[0]?.result.status).toBe('success');
    // The cascaded handler wrote handlerRuns=1 onto the final snapshot.
    expect((result.nextState as { handlerRuns?: number }).handlerRuns).toBe(1);
  });

  it('does not cascade when no feature context is passed (legacy callers)', () => {
    const surface = buildCanvasSurface();
    const snapshot = buildInitialSnapshot(surface.stateDefinitions);
    const result = simulate({
      surface,
      action: deleteSelection,
      snapshot: { ...snapshot, selection: { count: 2, locked: false } },
      parameters: {}
      // feature deliberately omitted, legacy signature
    });
    expect(result.status).toBe('success');
    expect(result.cascadedHandlers).toBeUndefined();
  });

  it('cascades into a handler declared in a sibling feature (cross-feature cascade)', () => {
    // Emitter feature: action emits an event but has no handlers.
    // Sibling feature: declares a handler subscribed to that event.
    // With projectFeatures passed, the cascade walks both and fires the
    // sibling's handler.
    const counterDef = {
      id: asStateDefinitionId('d-counter'),
      path: asStatePath('handlerRuns'),
      type: 'number' as const,
      defaultValue: 0
    };
    const emitterSurface: Surface = {
      id: asSurfaceId('emit-s'),
      name: 'Emit',
      type: 'screen',
      stateDefinitions: [counterDef],
      actions: [
        {
          id: asActionId('emit-act'),
          name: 'Kick',
          intent: 'Emits an event.',
          parameters: [],
          requiredStates: [],
          rules: [],
          invariants: [],
          effects: [
            { id: asEffectId('e-emit'), type: 'emit_event', event: asEventName('cross.event') }
          ],
          emittedEvents: [asEventName('cross.event')],
          transitions: []
        }
      ],
      rules: [],
      invariants: [],
      transitions: []
    };
    const emitterFeature: Feature = {
      id: asFeatureId('emitter-feat'),
      name: 'Emitter',
      surfaces: [emitterSurface],
      personas: [],
      resources: [],
      entities: [],
      createdAt: '2026-05-16T00:00:00.000Z',
      updatedAt: '2026-05-16T00:00:00.000Z'
    };
    const handlerSurface: Surface = {
      id: asSurfaceId('handle-s'),
      name: 'Handle',
      type: 'screen',
      stateDefinitions: [counterDef],
      actions: [
        {
          id: asActionId('handle-act'),
          name: 'React',
          intent: 'Lives in sibling feature, listens to cross.event.',
          parameters: [],
          requiredStates: [],
          rules: [],
          invariants: [],
          effects: [
            {
              id: asEffectId('e-inc'),
              type: 'set_state',
              path: asStatePath('handlerRuns'),
              value: {
                kind: 'add',
                left: { kind: 'state', path: asStatePath('handlerRuns') },
                right: { kind: 'literal', value: 1 }
              }
            }
          ],
          emittedEvents: [],
          transitions: [],
          triggeredByEvent: asEventName('cross.event')
        }
      ],
      rules: [],
      invariants: [],
      transitions: []
    };
    const handlerFeature: Feature = {
      id: asFeatureId('handler-feat'),
      name: 'Handler',
      surfaces: [handlerSurface],
      personas: [],
      resources: [],
      entities: [],
      createdAt: '2026-05-16T00:00:00.000Z',
      updatedAt: '2026-05-16T00:00:00.000Z'
    };

    // Without projectFeatures: no cross-feature cascade.
    const noProject = simulate({
      surface: emitterSurface,
      action: emitterSurface.actions[0]!,
      snapshot: {},
      parameters: {},
      feature: emitterFeature
    });
    expect(noProject.cascadedHandlers).toBeUndefined();

    // With projectFeatures: the sibling handler fires.
    const withProject = simulate({
      surface: emitterSurface,
      action: emitterSurface.actions[0]!,
      snapshot: {},
      parameters: {},
      feature: emitterFeature,
      projectFeatures: [handlerFeature]
    });
    expect(withProject.status).toBe('success');
    expect(withProject.cascadedHandlers).toHaveLength(1);
    expect(withProject.cascadedHandlers?.[0]?.triggeredBy).toBe('cross.event');
    expect(withProject.cascadedHandlers?.[0]?.result.status).toBe('success');
    expect((withProject.nextState as { handlerRuns?: number }).handlerRuns).toBe(1);
  });

  it('merges defaults from every surface in the focal feature for invariant evaluation', () => {
    // Feature invariant references a state path declared on a different
    // surface than the action being simulated. Without the cross-surface
    // default merge, the invariant evaluates against `undefined` and
    // false-positives as violated.
    const otherSurface: Surface = {
      id: asSurfaceId('other'),
      name: 'Other',
      type: 'screen',
      // 'counter' has a default of 0, must be applied even when the
      // simulated action lives on a different surface.
      stateDefinitions: [
        {
          id: asStateDefinitionId('d-counter'),
          path: asStatePath('counter'),
          type: 'number',
          defaultValue: 0
        }
      ],
      actions: [],
      rules: [],
      invariants: [],
      transitions: []
    };
    const actionSurface: Surface = {
      ...buildCanvasSurface(),
      actions: [{ ...deleteSelection, rules: [], effects: [] }]
    };
    const feature: Feature = {
      id: asFeatureId('feat-dm'),
      name: 'Default Merge',
      surfaces: [actionSurface, otherSurface],
      personas: [],
      resources: [],
      entities: [],
      featureInvariants: [
        {
          id: asInvariantId('i-counter'),
          name: 'counter_non_negative',
          condition: {
            left: asStatePath('counter'),
            operator: 'greater_than',
            right: -1
          },
          message: 'counter went negative'
        }
      ],
      createdAt: '2026-05-16T00:00:00.000Z',
      updatedAt: '2026-05-16T00:00:00.000Z'
    };
    const result = simulate({
      surface: actionSurface,
      action: actionSurface.actions[0]!,
      // Caller did NOT set counter. Default-merge should fill it from
      // the sibling surface's stateDefinitions and the invariant should
      // hold (0 > -1).
      snapshot: { selection: { count: 2, locked: false }, user: { role: 'editor' } },
      parameters: {},
      feature
    });
    expect(result.status).toBe('success');
    expect(result.invariantViolations).toEqual([]);
  });

  it('prevents a handler from triggering itself transitively (cycle guard)', () => {
    // A handler that emits the very event it subscribes to. Without the
    // visited set this would loop until the depth cap. With the guard, it
    // runs exactly once.
    const looper: Action = {
      id: asActionId('looper'),
      name: 'Self Loop',
      intent: 'Tries to retrigger itself.',
      parameters: [],
      requiredStates: [],
      rules: [],
      invariants: [],
      effects: [
        { id: asEffectId('e-self'), type: 'emit_event', event: asEventName('loop.tick') }
      ],
      emittedEvents: [asEventName('loop.tick')],
      transitions: [],
      triggeredByEvent: asEventName('loop.tick')
    };
    const trigger: Action = {
      id: asActionId('trigger'),
      name: 'Kick',
      intent: 'Emit loop.tick once.',
      parameters: [],
      requiredStates: [],
      rules: [],
      invariants: [],
      effects: [
        { id: asEffectId('e-kick'), type: 'emit_event', event: asEventName('loop.tick') }
      ],
      emittedEvents: [asEventName('loop.tick')],
      transitions: []
    };
    const surface: Surface = {
      id: asSurfaceId('s'),
      name: 'S',
      type: 'screen',
      stateDefinitions: [],
      actions: [trigger, looper],
      rules: [],
      invariants: [],
      transitions: []
    };
    const feature: Feature = {
      id: asFeatureId('feat-loop'),
      name: 'Loop',
      surfaces: [surface],
      personas: [],
      resources: [],
      entities: [],
      createdAt: '2026-05-16T00:00:00.000Z',
      updatedAt: '2026-05-16T00:00:00.000Z'
    };
    const result = simulate({
      surface,
      action: trigger,
      snapshot: {},
      parameters: {},
      feature
    });
    expect(result.status).toBe('success');
    // The handler runs exactly once even though it emits its own trigger.
    expect(result.cascadedHandlers).toHaveLength(1);
    expect(result.cascadedHandlers?.[0]?.result.actionId).toBe('looper');
  });

  it('marks status blocked when an invariant is violated post-effect', () => {
    const surface: Surface = {
      ...buildCanvasSurface(),
      invariants: [
        {
          id: asInvariantId('i1'),
          name: 'count >= 0',
          condition: {
            left: asStatePath('selection.count'),
            operator: 'greater_than',
            right: -1
          },
          message: 'count went negative'
        }
      ]
    };
    const cap: Action = {
      ...deleteSelection,
      rules: [],
      effects: [
        {
          id: asEffectId('e9'),
          type: 'set_state',
          path: asStatePath('selection.count'),
          value: -1
        }
      ]
    };
    const result = simulate({
      surface,
      action: cap,
      snapshot: buildInitialSnapshot(surface.stateDefinitions),
      parameters: {}
    });
    expect(result.status).toBe('blocked');
    expect(result.invariantViolations.map((v) => v.invariantName)).toContain('count >= 0');
  });

  it('does not check an action invariant when a rule blocked the action', () => {
    // "Finish" requires gate.open; its action invariant is the success
    // post-condition thing.done == true. Invoked while the gate is closed, the
    // rule blocks it and no effect runs — the post-condition must NOT be flagged
    // (it's vacuous), while the same invariant holds when the action succeeds.
    const surface: Surface = {
      id: asSurfaceId('s'),
      name: 'Flow',
      type: 'screen',
      stateDefinitions: [
        { id: asStateDefinitionId('d-gate'), path: asStatePath('gate.open'), type: 'boolean', defaultValue: false },
        { id: asStateDefinitionId('d-done'), path: asStatePath('thing.done'), type: 'boolean', defaultValue: false }
      ],
      actions: [],
      rules: [],
      invariants: [],
      transitions: []
    };
    const finish: Action = {
      id: asActionId('finish'),
      name: 'Finish',
      intent: 'complete the thing',
      parameters: [],
      requiredStates: [],
      rules: [
        {
          id: asRuleId('r-gate'),
          category: 'business',
          condition: { left: asStatePath('gate.open'), operator: 'is_false' },
          effect: { id: asEffectId('e-block'), type: 'block_action', reason: 'gate closed' }
        }
      ],
      invariants: [
        {
          id: asInvariantId('i-done'),
          name: 'Finish leaves thing done',
          condition: { left: asStatePath('thing.done'), operator: 'is_true' },
          message: 'thing should be done'
        }
      ],
      effects: [
        { id: asEffectId('e-done'), type: 'set_state', path: asStatePath('thing.done'), value: true }
      ],
      emittedEvents: [],
      transitions: []
    };

    const blocked = simulate({
      surface,
      action: finish,
      snapshot: buildInitialSnapshot(surface.stateDefinitions),
      parameters: {}
    });
    expect(blocked.status).toBe('blocked');
    // The post-condition invariant is skipped because the action never ran.
    expect(blocked.invariantViolations).toHaveLength(0);

    const succeeded = simulate({
      surface,
      action: finish,
      snapshot: { gate: { open: true }, thing: { done: false } },
      parameters: {}
    });
    expect(succeeded.status).toBe('success');
    expect(succeeded.invariantViolations).toHaveLength(0);
  });

  it('flows a collection mutation (append) through a real action with an Expression item', () => {
    const surface: Surface = {
      id: asSurfaceId('cart'),
      name: 'Cart',
      type: 'screen',
      stateDefinitions: [
        {
          id: asStateDefinitionId('d-lines'),
          path: asStatePath('cart.lines'),
          type: 'array',
          defaultValue: []
        }
      ],
      actions: [],
      rules: [],
      invariants: [],
      transitions: []
    };
    const addLine: Action = {
      id: asActionId('add-line'),
      name: 'Add line',
      intent: 'add a product line to the cart',
      parameters: [
        {
          id: asParameterId('p-pid'),
          name: 'productId',
          type: 'string',
          required: true,
          description: 'product to add'
        }
      ],
      requiredStates: [],
      rules: [],
      invariants: [],
      effects: [
        {
          id: asEffectId('e-append'),
          type: 'append_to_list',
          path: asStatePath('cart.lines'),
          item: { kind: 'param', name: 'productId' }
        }
      ],
      emittedEvents: [],
      transitions: []
    };
    const result = simulate({
      surface,
      action: addLine,
      snapshot: { cart: { lines: ['a'] } },
      parameters: { productId: 'b' }
    });
    expect(result.status).toBe('success');
    expect(result.nextState).toEqual({ cart: { lines: ['a', 'b'] } });
  });

  it('auto-recomputes a derived total when an action appends a line (no manual set_state)', () => {
    const surface: Surface = {
      id: asSurfaceId('cart'),
      name: 'Cart',
      type: 'screen',
      stateDefinitions: [
        {
          id: asStateDefinitionId('d-lines'),
          path: asStatePath('cart.lines'),
          type: 'array',
          defaultValue: []
        },
        {
          id: asStateDefinitionId('d-subtotal'),
          path: asStatePath('cart.subtotal'),
          type: 'number',
          defaultValue: 0,
          // subtotal is COMPUTED from the lines — the action never sets it.
          derived: {
            kind: 'sum_pluck',
            operand: { kind: 'state', path: asStatePath('cart.lines') },
            field: 'amount'
          }
        }
      ],
      actions: [],
      rules: [],
      invariants: [
        {
          id: asInvariantId('subtotal-nonneg'),
          name: 'subtotal >= 0',
          condition: { left: asStatePath('cart.subtotal'), operator: 'greater_than', right: -1 },
          message: 'subtotal went negative'
        }
      ],
      transitions: []
    };
    const addLine: Action = {
      id: asActionId('add-line'),
      name: 'Add line',
      intent: 'add a priced line to the cart',
      parameters: [
        {
          id: asParameterId('p-line'),
          name: 'line',
          type: 'object',
          required: true,
          description: 'the line to add ({ amount })'
        }
      ],
      requiredStates: [],
      rules: [],
      invariants: [],
      effects: [
        {
          id: asEffectId('e-append'),
          type: 'append_to_list',
          path: asStatePath('cart.lines'),
          item: { kind: 'param', name: 'line' }
        }
      ],
      emittedEvents: [],
      transitions: []
    };
    const result = simulate({
      surface,
      action: addLine,
      snapshot: { cart: { lines: [{ amount: 10 }] } },
      parameters: { line: { amount: 5 } }
    });
    expect(result.status).toBe('success');
    // The derived subtotal reflects the appended line without any set_state.
    expect((result.nextState.cart as { subtotal: number }).subtotal).toBe(15);
  });
});

describe('simulate — event delivery semantics', () => {
  const sendCommand: Action = {
    id: asActionId('send'),
    name: 'Send Command',
    intent: 'send a command and notify',
    parameters: [],
    requiredStates: [],
    rules: [],
    invariants: [],
    effects: [
      {
        id: asEffectId('inc'),
        type: 'set_state',
        path: asStatePath('command.count'),
        value: {
          kind: 'add',
          left: { kind: 'state', path: asStatePath('command.count') },
          right: { kind: 'literal', value: 1 }
        }
      },
      { id: asEffectId('emit'), type: 'emit_event', event: asEventName('command.sent') }
    ],
    emittedEvents: [asEventName('command.sent')],
    transitions: []
  };

  // Handler that always fails: it tries to break the interlock, which a surface
  // invariant forbids, so its run is blocked.
  const updateInterlock: Action = {
    id: asActionId('handler'),
    name: 'Update Interlock',
    intent: 'flip the interlock',
    parameters: [],
    requiredStates: [],
    rules: [],
    invariants: [],
    effects: [
      { id: asEffectId('flip'), type: 'set_state', path: asStatePath('interlock.ok'), value: false }
    ],
    emittedEvents: [],
    transitions: [],
    triggeredByEvent: asEventName('command.sent')
  };

  const featureWithDelivery = (delivery: 'best_effort' | 'required' | 'transactional'): Feature => ({
    id: asFeatureId('f'),
    name: 'Console',
    surfaces: [
      {
        id: asSurfaceId('s'),
        name: 'Console',
        type: 'screen',
        stateDefinitions: [
          {
            id: asStateDefinitionId('d-ok'),
            path: asStatePath('interlock.ok'),
            type: 'boolean',
            defaultValue: true
          },
          {
            id: asStateDefinitionId('d-count'),
            path: asStatePath('command.count'),
            type: 'number',
            defaultValue: 0
          }
        ],
        rules: [],
        invariants: [
          {
            id: asInvariantId('i-ok'),
            name: 'interlock stays ok',
            condition: { left: asStatePath('interlock.ok'), operator: 'is_true' },
            message: 'interlock update failed'
          }
        ],
        transitions: [],
        actions: [sendCommand, updateInterlock]
      }
    ],
    personas: [],
    resources: [],
    entities: [],
    events: [
      { id: asEventDefinitionId('ev'), name: asEventName('command.sent'), delivery }
    ],
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z'
  });

  const run = (delivery: 'best_effort' | 'required' | 'transactional') => {
    const feature = featureWithDelivery(delivery);
    return simulate({
      surface: feature.surfaces[0]!,
      action: sendCommand,
      snapshot: {},
      parameters: {},
      feature
    });
  };

  it('best_effort: a failing handler leaves the emitter a success', () => {
    const result = run('best_effort');
    expect(result.status).toBe('success');
    expect(result.cascadedHandlers?.[0]?.result.status).toBe('blocked');
    expect((result.nextState.command as { count: number }).count).toBe(1);
  });

  it('required: a failing handler blocks the emitter but its own effect stands', () => {
    const result = run('required');
    expect(result.status).toBe('blocked');
    expect((result.nextState.command as { count: number }).count).toBe(1);
  });

  it('transactional: a failing handler rolls the emitter back', () => {
    const result = run('transactional');
    expect(result.status).toBe('blocked');
    expect((result.nextState.command as { count: number }).count).toBe(0);
  });
});

describe('simulate — invoke_operation', () => {
  const surface: Surface = {
    id: asSurfaceId('s'),
    name: 'Pay',
    type: 'screen',
    stateDefinitions: [
      {
        id: asStateDefinitionId('d'),
        path: asStatePath('charge.status'),
        type: 'enum',
        enumValues: ['pending', 'ok'],
        defaultValue: 'pending'
      }
    ],
    rules: [],
    invariants: [],
    transitions: [],
    actions: [
      {
        id: asActionId('charge'),
        name: 'Charge',
        intent: 'charge the card',
        parameters: [],
        requiredStates: [],
        rules: [],
        invariants: [],
        effects: [
          {
            id: asEffectId('call'),
            type: 'invoke_operation',
            dependencyId: asDependencyId('dep'),
            operation: 'charge',
            resultPath: asStatePath('charge.status'),
            resultValue: 'ok'
          }
        ],
        emittedEvents: [],
        transitions: []
      }
    ]
  };

  it('writes its modeled result to resultPath', () => {
    const result = simulate({
      surface,
      action: surface.actions[0]!,
      snapshot: {},
      parameters: {}
    });
    expect(result.status).toBe('success');
    expect((result.nextState.charge as { status: string }).status).toBe('ok');
  });
});
