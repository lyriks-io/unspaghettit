import { describe, expect, it } from 'vitest';
import { storefrontFeature } from '$features/behavior-model/infrastructure/seed/seedStorefront';
import {
  introducedValidationErrors,
  validateFeature,
  validateReferenceIntegrity
} from './FeatureValidator';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import {
  asActionId,
  asEffectId,
  asEventDefinitionId,
  asFeatureId,
  asReachabilityGoalId,
  asRuleId,
  asStateDefinitionId,
  asSurfaceId,
  asValueSetId
} from '$features/behavior-model/domain/value-objects/ids';
import { asEventName } from '$features/behavior-model/domain/value-objects/EventName';
import { asStatePath } from '$features/behavior-model/domain/value-objects/StatePath';

describe('validateFeature', () => {
  it('passes a healthy seed feature', () => {
    expect(validateFeature(storefrontFeature).valid).toBe(true);
  });

  it('accepts a well-formed reachability goal and rejects bad kind / undeclared path', () => {
    const goal = (over: Record<string, unknown>) => ({
      ...storefrontFeature,
      reachabilityGoals: [
        {
          id: asReachabilityGoalId('g1'),
          name: 'cart can hold items',
          kind: 'reachable' as const,
          condition: { left: asStatePath('cart.itemCount'), operator: 'greater_than' as const, right: 0 },
          description: 'a non-empty cart is reachable',
          ...over
        }
      ]
    });

    // Goal conditions are checked in reference-integrity (where feature
    // invariants are validated), which is the path MCP writes run.
    expect(validateReferenceIntegrity(goal({})).valid).toBe(true);

    const badKind = validateReferenceIntegrity(goal({ kind: 'eventually' }));
    expect(badKind.valid).toBe(false);
    if (!badKind.valid) expect(badKind.errors.some((e) => e.includes('kind must be'))).toBe(true);

    const badPath = validateReferenceIntegrity(
      goal({ condition: { left: asStatePath('nope.missing'), operator: 'is_true' } })
    );
    expect(badPath.valid).toBe(false);
    if (!badPath.valid) {
      expect(badPath.errors.some((e) => e.includes('not declared on any surface'))).toBe(true);
    }
  });

  it('rejects a missing feature name', () => {
    const result = validateFeature({
      ...storefrontFeature,
      name: '   '
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.toLowerCase().includes('name'))).toBe(true);
    }
  });

  it('rejects an unknown rule category with a "did you mean" hint for known legacy names', () => {
    const broken: Feature = {
      ...storefrontFeature,
      surfaces: storefrontFeature.surfaces.map((s, i) =>
        i === 0
          ? {
              ...s,
              rules: [
                ...s.rules,
                {
                  id: asRuleId('test-bad-cat'),
                  category: 'permission' as never, // singular typo
                  condition: { left: asStatePath('cart.itemCount'), operator: 'is_true' },
                  effect: { id: asEffectId('e'), type: 'allow_action' }
                }
              ]
            }
          : s
      )
    };
    const result = validateFeature(broken);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      const msg = result.errors.find((e) => e.includes('permission'));
      expect(msg).toBeDefined();
      expect(msg).toContain('Did you mean "permissions"');
    }
  });

  it('rejects an invalid event name with a snake_case suggestion', () => {
    // Reproduces a silent-disappearance bug found during BrewQ smoke tests:
    // event names with camelCase segments were accepted on write but threw
    // on import, so the saved feature vanished from list_features after the
    // next reload. The validator must catch this on write.
    const broken: Feature = {
      ...storefrontFeature,
      events: [
        ...(storefrontFeature.events ?? []),
        {
          id: asEventDefinitionId('test-bad-event'),
          name: 'codeEntry.draft_changed' as never
        }
      ]
    };
    const result = validateFeature(broken);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      const msg = result.errors.find((e) => e.includes('codeEntry.draft_changed'));
      expect(msg).toBeDefined();
      expect(msg).toContain('lowercase dot-separated');
      // Suggestion should be snake_case-ified.
      expect(msg).toContain('code_entry.draft_changed');
    }
  });

  it('rejects an invalid emittedEvents entry on an action', () => {
    const broken: Feature = {
      ...storefrontFeature,
      surfaces: storefrontFeature.surfaces.map((s, i) =>
        i === 0
          ? {
              ...s,
              actions: s.actions.map((c, j) =>
                j === 0
                  ? { ...c, emittedEvents: [...c.emittedEvents, 'BadName.X' as never] }
                  : c
              )
            }
          : s
      )
    };
    const result = validateFeature(broken);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.includes('BadName.X'))).toBe(true);
    }
  });

  it('rejects a completely unknown category by listing the valid ones', () => {
    const broken: Feature = {
      ...storefrontFeature,
      surfaces: storefrontFeature.surfaces.map((s, i) =>
        i === 0
          ? {
              ...s,
              rules: [
                ...s.rules,
                {
                  id: asRuleId('test-wild'),
                  category: 'made_up_thing' as never,
                  condition: { left: asStatePath('cart.itemCount'), operator: 'is_true' },
                  effect: { id: asEffectId('e2'), type: 'allow_action' }
                }
              ]
            }
          : s
      )
    };
    const result = validateFeature(broken);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      const msg = result.errors.find((e) => e.includes('made_up_thing'));
      expect(msg).toBeDefined();
      expect(msg).toContain('Valid categories:');
    }
  });

  it('rejects duplicate surface ids', () => {
    const broken: Feature = {
      ...storefrontFeature,
      surfaces: [
        ...storefrontFeature.surfaces,
        { ...storefrontFeature.surfaces[0]! }
      ]
    };
    const result = validateFeature(broken);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => /duplicate surface/i.test(e))).toBe(true);
    }
  });

  it('rejects transitions that point at unknown surfaces', () => {
    const broken: Feature = {
      ...storefrontFeature,
      surfaces: storefrontFeature.surfaces.map((s, i) =>
        i === 0
          ? {
              ...s,
              transitions: [
                ...s.transitions,
                {
                  id: 'broken-transition' as never,
                  target: 'does-not-exist' as never,
                  label: 'Broken'
                }
              ]
            }
          : s
      )
    };
    const result = validateFeature(broken);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some((e) => /unknown surface/i.test(e))
      ).toBe(true);
    }
  });

  it('rejects parent surface cycles (parent === self)', () => {
    const broken: Feature = {
      ...storefrontFeature,
      surfaces: storefrontFeature.surfaces.map((s, i) =>
        i === 0 ? { ...s, parentSurfaceId: s.id } : s
      )
    };
    const result = validateFeature(broken);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => /own parent/i.test(e))).toBe(true);
    }
  });

  it('rejects a number-typed state default that is actually a string ("365")', () => {
    const broken: Feature = {
      ...storefrontFeature,
      surfaces: storefrontFeature.surfaces.map((s, i) =>
        i === 0
          ? {
              ...s,
              stateDefinitions: s.stateDefinitions.map((d, j) =>
                j === 0
                  ? ({
                      ...d,
                      type: 'number',
                      defaultValue: '365' as never
                    } as typeof d)
                  : d
              )
            }
          : s
      )
    };
    const result = validateFeature(broken);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => /not assignable to declared type/i.test(e))).toBe(true);
    }
  });

  it('rejects an enum default that is not in enumValues', () => {
    const broken: Feature = {
      ...storefrontFeature,
      surfaces: storefrontFeature.surfaces.map((s, i) =>
        i === 0
          ? {
              ...s,
              stateDefinitions: [
                ...s.stateDefinitions,
                {
                  id: 'bad-enum' as never,
                  path: 'wedding.theme' as never,
                  type: 'enum' as const,
                  enumValues: ['classic', 'modern'],
                  defaultValue: 'rustic'
                }
              ]
            }
          : s
      )
    };
    const result = validateFeature(broken);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => /not one of enumValues/i.test(e))).toBe(true);
    }
  });

  // ─── Named value sets (shared enums) ────────────────────────────────────

  const withValueSetState = (
    valueSets: Feature['valueSets'],
    stateDef: Record<string, unknown>
  ): Feature => ({
    ...storefrontFeature,
    valueSets,
    surfaces: storefrontFeature.surfaces.map((s, i) =>
      i === 0
        ? { ...s, stateDefinitions: [...s.stateDefinitions, stateDef as never] }
        : s
    )
  });

  const themeSet = {
    id: asValueSetId('vs-theme'),
    name: 'Theme',
    description: 'Allowed wedding themes.',
    values: ['classic', 'modern']
  };

  it('accepts an enum state that references a value set with a valid default', () => {
    const feature = withValueSetState([themeSet], {
      id: 'theme-state',
      path: 'wedding.theme',
      type: 'enum',
      valueSetId: asValueSetId('vs-theme'),
      defaultValue: 'classic',
      description: 'The selected wedding theme.'
    });
    expect(validateFeature(feature).valid).toBe(true);
  });

  it('rejects a default that is not in the referenced value set', () => {
    const feature = withValueSetState([themeSet], {
      id: 'theme-state',
      path: 'wedding.theme',
      type: 'enum',
      valueSetId: asValueSetId('vs-theme'),
      defaultValue: 'rustic',
      description: 'The selected wedding theme.'
    });
    const result = validateFeature(feature);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => /value set "vs-theme"/.test(e))).toBe(true);
    }
  });

  it('rejects a dangling valueSetId reference', () => {
    const feature = withValueSetState([themeSet], {
      id: 'theme-state',
      path: 'wedding.theme',
      type: 'enum',
      valueSetId: asValueSetId('vs-missing'),
      defaultValue: 'classic',
      description: 'The selected wedding theme.'
    });
    const result = validateFeature(feature);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => /does not resolve to a value set/.test(e))).toBe(true);
    }
  });

  it('rejects setting both enumValues and valueSetId', () => {
    const feature = withValueSetState([themeSet], {
      id: 'theme-state',
      path: 'wedding.theme',
      type: 'enum',
      enumValues: ['classic', 'modern'],
      valueSetId: asValueSetId('vs-theme'),
      defaultValue: 'classic',
      description: 'The selected wedding theme.'
    });
    const result = validateFeature(feature);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => /either enumValues or valueSetId, not both/.test(e))).toBe(
        true
      );
    }
  });

  it('rejects a valueSetId on a non-enum state', () => {
    const feature = withValueSetState([themeSet], {
      id: 'theme-state',
      path: 'wedding.themeCount',
      type: 'number',
      valueSetId: asValueSetId('vs-theme'),
      defaultValue: 0,
      description: 'Not an enum.'
    });
    const result = validateFeature(feature);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => /valueSetId is only valid for type "enum"/.test(e))).toBe(
        true
      );
    }
  });

  it('rejects a value set with no values', () => {
    const feature = withValueSetState(
      [{ id: asValueSetId('vs-empty'), name: 'Empty', description: 'Has no values.', values: [] }],
      {
        id: 'x-state',
        path: 'wedding.x',
        type: 'string',
        defaultValue: '',
        description: 'unrelated.'
      }
    );
    const result = validateFeature(feature);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => /must declare at least one value/.test(e))).toBe(true);
    }
  });

  it('rejects a value set missing a description', () => {
    const feature = withValueSetState(
      [{ id: asValueSetId('vs-nodesc'), name: 'NoDesc', values: ['a', 'b'] } as never],
      {
        id: 'x-state',
        path: 'wedding.x',
        type: 'string',
        defaultValue: '',
        description: 'unrelated.'
      }
    );
    const result = validateFeature(feature);
    expect(result.valid).toBe(false);
  });

  it('rejects an empty feature id', () => {
    const broken: Feature = {
      ...storefrontFeature,
      id: asFeatureId('placeholder')
    };
    // Force an empty id past the brand check so we can test the validator's
    // own guard (asFeatureId would normally refuse '').
    (broken as { id: string }).id = '   ';
    expect(validateFeature(broken).valid).toBe(false);
  });
});

describe('validateReferenceIntegrity', () => {
  it('passes the healthy seed', () => {
    expect(validateReferenceIntegrity(storefrontFeature).valid).toBe(true);
  });

  it('flags requiredStates that reference an undeclared path', () => {
    const broken: Feature = {
      ...storefrontFeature,
      surfaces: storefrontFeature.surfaces.map((s, i) =>
        i === 0
          ? {
              ...s,
              actions: s.actions.map((c, j) =>
                j === 0
                  ? { ...c, requiredStates: [asStatePath('does.not.exist')] }
                  : c
              )
            }
          : s
      )
    };
    const result = validateReferenceIntegrity(broken);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some((e) => /requiredStates.*does\.not\.exist/.test(e))
      ).toBe(true);
    }
  });

  it('flags a set_state effect path that is not declared on the surface', () => {
    const broken: Feature = {
      ...storefrontFeature,
      surfaces: storefrontFeature.surfaces.map((s, i) =>
        i === 0
          ? {
              ...s,
              actions: s.actions.map((c, j) =>
                j === 0
                  ? {
                      ...c,
                      effects: [
                        {
                          id: asEffectId('test-bad-setstate'),
                          type: 'set_state',
                          path: asStatePath('ghost.path'),
                          value: 1
                        }
                      ]
                    }
                  : c
              )
            }
          : s
      )
    };
    const result = validateReferenceIntegrity(broken);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => /ghost\.path/.test(e))).toBe(true);
    }
  });

  it('flags a transition_surface effect targeting an unknown surface', () => {
    const broken: Feature = {
      ...storefrontFeature,
      surfaces: storefrontFeature.surfaces.map((s, i) =>
        i === 0
          ? {
              ...s,
              actions: s.actions.map((c, j) =>
                j === 0
                  ? {
                      ...c,
                      effects: [
                        {
                          id: asEffectId('test-bad-transition'),
                          type: 'transition_surface',
                          target: asSurfaceId('nope')
                        }
                      ]
                    }
                  : c
              )
            }
          : s
      )
    };
    const result = validateReferenceIntegrity(broken);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some((e) => /transition_surface target "nope"/.test(e))
      ).toBe(true);
    }
  });

  it('flags emit_event and emittedEvents against unknown events only when events are declared', () => {
    // No events declared → silent (backward compat).
    const noEvents: Feature = {
      ...storefrontFeature,
      events: []
    };
    expect(validateReferenceIntegrity(noEvents).valid).toBe(true);

    // Declare an event that does NOT match what actions emit.
    const withMismatchedEvents: Feature = {
      ...storefrontFeature,
      events: [
        {
          id: asEventDefinitionId('test-evt-1'),
          name: asEventName('only.known.event')
        }
      ]
    };
    const result = validateReferenceIntegrity(withMismatchedEvents);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some((e) => /not registered in feature\.events/.test(e))
      ).toBe(true);
    }
  });

  it('flags a rule condition.left that references an undeclared path', () => {
    const broken: Feature = {
      ...storefrontFeature,
      surfaces: storefrontFeature.surfaces.map((s, i) =>
        i === 0
          ? {
              ...s,
              rules: [
                ...s.rules,
                {
                  id: asRuleId('test-bad-rule'),
                  category: 'business',
                  condition: {
                    left: asStatePath('phantom.path'),
                    operator: 'equals',
                    right: 1
                  },
                  effect: {
                    id: asEffectId('test-bad-rule-effect'),
                    type: 'block_action',
                    reason: 'n/a'
                  }
                }
              ]
            }
          : s
      )
    };
    const result = validateReferenceIntegrity(broken);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => /phantom\.path/.test(e))).toBe(true);
    }
  });

  it('flags an Expression on the right side that references an undeclared path', () => {
    const broken: Feature = {
      ...storefrontFeature,
      surfaces: storefrontFeature.surfaces.map((s, i) =>
        i === 0
          ? {
              ...s,
              actions: s.actions.map((c, j) =>
                j === 0
                  ? {
                      ...c,
                      rules: [
                        ...c.rules,
                        {
                          id: asRuleId('test-bad-expr-rule'),
                          category: 'business',
                          condition: {
                            left: asStatePath('cart.itemCount'),
                            operator: 'greater_than',
                            right: { kind: 'state', path: asStatePath('not.declared') }
                          },
                          effect: {
                            id: asEffectId('test-bad-expr-effect'),
                            type: 'block_action',
                            reason: 'n/a'
                          }
                        }
                      ]
                    }
                  : c
              )
            }
          : s
      )
    };
    const result = validateReferenceIntegrity(broken);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => /not\.declared/.test(e))).toBe(true);
    }
  });

  it('detects a transitive parent-surface cycle (A→B→A)', () => {
    const ids = storefrontFeature.surfaces.slice(0, 2).map((s) => s.id);
    const [a, b] = ids;
    const broken: Feature = {
      ...storefrontFeature,
      surfaces: storefrontFeature.surfaces.map((s) => {
        if (s.id === a) return { ...s, parentSurfaceId: b };
        if (s.id === b) return { ...s, parentSurfaceId: a };
        return s;
      })
    };
    const result = validateReferenceIntegrity(broken);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => /parent-surface cycle/.test(e))).toBe(true);
    }
  });

  // Handler-integrity checks live in validateReferenceIntegrity because they
  // depend on the event registry. apply_batch (and MutateFeature) run BOTH
  // passes so these errors surface at write time.
  it('rejects a handler whose triggeredByEvent has a required parameter with no default', () => {
    const surface = storefrontFeature.surfaces[0]!;
    const action: NonNullable<typeof surface.actions[number]> = {
      ...surface.actions[0]!,
      id: asActionId('handler-bad'),
      name: 'Bad Handler',
      intent: 'Has required param with no default and a triggeredByEvent.',
      triggeredByEvent: asEventName('order.placed'),
      parameters: [
        {
          id: 'p-bad' as never,
          name: 'mustHaveValue',
          type: 'string',
          required: true
        }
      ]
    };
    // Register the event so the not-registered branch doesn't fire and
    // obscure the parameter-error message we want to test.
    const broken: Feature = {
      ...storefrontFeature,
      events: [
        ...(storefrontFeature.events ?? []),
        {
          id: asEventDefinitionId('e-orderplaced'),
          name: asEventName('order.placed')
        }
      ],
      surfaces: storefrontFeature.surfaces.map((s, i) =>
        i === 0 ? { ...s, actions: [...s.actions, action] } : s
      )
    };
    const result = validateReferenceIntegrity(broken);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      const msg = result.errors.find((e) =>
        /handler.*required parameter "mustHaveValue".*no default/.test(e)
      );
      expect(msg).toBeDefined();
    }
  });

  it('rejects a handler whose triggeredByEvent is unregistered', () => {
    const surface = storefrontFeature.surfaces[0]!;
    const action: NonNullable<typeof surface.actions[number]> = {
      ...surface.actions[0]!,
      id: asActionId('handler-stray'),
      name: 'Stray Handler',
      intent: 'Subscribes to an event that does not exist.',
      triggeredByEvent: asEventName('does.not.exist'),
      // Need at least one registered event somewhere to flip enforceEvents on.
      emittedEvents: []
    };
    const broken: Feature = {
      ...storefrontFeature,
      events: [
        ...(storefrontFeature.events ?? []),
        {
          id: asEventDefinitionId('e-some-event'),
          name: asEventName('some.event')
        }
      ],
      surfaces: storefrontFeature.surfaces.map((s, i) =>
        i === 0 ? { ...s, actions: [...s.actions, action] } : s
      )
    };
    const result = validateReferenceIntegrity(broken);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      const msg = result.errors.find((e) =>
        /triggeredByEvent "does\.not\.exist" is not registered/.test(e)
      );
      expect(msg).toBeDefined();
    }
  });

  it('rejects an effect that writes a derived (computed) state path', () => {
    const surface = storefrontFeature.surfaces[0]!;
    // A derived path (constant expression, so the expression itself is clean).
    const derivedDef = {
      id: asStateDefinitionId('d-derived-total'),
      path: asStatePath('derived.total'),
      type: 'number' as const,
      defaultValue: 0,
      derived: {
        kind: 'add' as const,
        left: { kind: 'literal' as const, value: 1 },
        right: { kind: 'literal' as const, value: 1 }
      },
      description: 'computed total'
    };
    // An action that tries to set_state the derived path — not allowed.
    const writer: NonNullable<typeof surface.actions[number]> = {
      ...surface.actions[0]!,
      id: asActionId('writes-derived'),
      name: 'Writes Derived',
      intent: 'Illegally writes a computed path.',
      emittedEvents: [],
      effects: [
        {
          id: asEffectId('e-write-derived'),
          type: 'set_state',
          path: asStatePath('derived.total'),
          value: 5,
          description: 'should be rejected'
        }
      ]
    };
    const broken: Feature = {
      ...storefrontFeature,
      surfaces: storefrontFeature.surfaces.map((s, i) =>
        i === 0
          ? {
              ...s,
              stateDefinitions: [...s.stateDefinitions, derivedDef],
              actions: [...s.actions, writer]
            }
          : s
      )
    };
    const result = validateReferenceIntegrity(broken);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      const msg = result.errors.find((e) =>
        /writes derived path "derived\.total"/.test(e)
      );
      expect(msg).toBeDefined();
    }
  });
});

describe('introducedValidationErrors (diff-aware gate)', () => {
  const withBlankSurfaceDescription = (f: Feature): Feature => ({
    ...f,
    surfaces: f.surfaces.map((s, i) => (i === 0 ? { ...s, description: '' } : s))
  });

  it('returns no errors when next only edits unrelated fields on an already-broken feature', () => {
    const broken = withBlankSurfaceDescription(storefrontFeature);
    const next = { ...broken, name: 'Renamed' };
    expect(introducedValidationErrors(broken, next)).toEqual([]);
  });

  it('reports an error the change introduces', () => {
    const next = withBlankSurfaceDescription(storefrontFeature);
    const introduced = introducedValidationErrors(storefrontFeature, next);
    expect(introduced.length).toBeGreaterThan(0);
    expect(introduced.some((e) => e.toLowerCase().includes('description'))).toBe(true);
  });

  it('does not report a pre-existing error that the change leaves untouched', () => {
    const broken = withBlankSurfaceDescription(storefrontFeature);
    // Same blank description still present + an unrelated rename.
    const next = { ...broken, name: 'Renamed' };
    const introduced = introducedValidationErrors(broken, next);
    expect(introduced.some((e) => e.toLowerCase().includes('description'))).toBe(false);
  });

  it('treats every error as introduced when there is no prior snapshot', () => {
    const broken = withBlankSurfaceDescription(storefrontFeature);
    expect(introducedValidationErrors(null, broken).length).toBeGreaterThan(0);
    expect(introducedValidationErrors(null, storefrontFeature)).toEqual([]);
  });
});
