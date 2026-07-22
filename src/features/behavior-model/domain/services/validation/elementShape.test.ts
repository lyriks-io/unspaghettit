import { describe, expect, it } from 'vitest';
import { storefrontFeature } from '$features/behavior-model/infrastructure/seed/seedStorefront';
import type { Feature } from '../../entities/Feature';
import type { Surface } from '../../entities/Surface';
import {
  asActionId,
  asEffectId,
  asInvariantId,
  asRuleId,
  asScenarioId,
  asStateDefinitionId,
  asSurfaceId
} from '../../value-objects/ids';
import { asStatePath } from '../../value-objects/StatePath';
import { validateElementShapes } from './elementShape';
import { validateFeature } from './featureShape';
import { introducedValidationErrors } from './regression';
import { validateReferenceIntegrity } from './referenceIntegrity';

/**
 * Minimal but complete feature: one surface, one state path, one action. Each
 * test injects ONE malformed element so the assertion is about that element,
 * not about whatever else the fixture is missing.
 */
const buildFeature = (surfaceOver: Partial<Surface> = {}): Feature =>
  ({
    ...storefrontFeature,
    surfaces: [
      {
        id: asSurfaceId('s1'),
        name: 'Board',
        description: 'A board.',
        type: 'screen',
        stateDefinitions: [
          {
            id: asStateDefinitionId('d1'),
            path: asStatePath('board.count'),
            type: 'number',
            defaultValue: 0,
            description: 'How many.'
          }
        ],
        actions: [],
        rules: [],
        invariants: [],
        transitions: [],
        ...surfaceOver
      } as unknown as Surface
    ]
  }) as Feature;

const withRuleCondition = (condition: unknown): Feature =>
  buildFeature({
    rules: [
      {
        id: asRuleId('r1'),
        category: 'business',
        description: 'A rule.',
        condition,
        effect: { id: asEffectId('e1'), type: 'allow_action', description: 'Allow.' }
      }
    ]
  } as unknown as Partial<Surface>);

const errorsFor = (feature: Feature): readonly string[] => validateElementShapes(feature);

describe('validateElementShapes — operators', () => {
  it('passes the seed feature untouched', () => {
    expect(validateElementShapes(storefrontFeature)).toEqual([]);
  });

  it('rejects an operator outside the runtime vocabulary', () => {
    const errors = errorsFor(
      withRuleCondition({ left: asStatePath('board.count'), operator: 'gte', right: 1 })
    );
    expect(errors.some((e) => e.includes('unknown operator "gte"'))).toBe(true);
  });

  it('rejects a missing operator', () => {
    const errors = errorsFor(withRuleCondition({ left: asStatePath('board.count'), right: 1 }));
    expect(errors.some((e) => e.includes('missing "operator"'))).toBe(true);
  });

  it('rejects a binary operator with no right operand', () => {
    // This is the silent one: `equals` against undefined never holds, so the
    // guard the author wrote can never fire and nothing reported it.
    const errors = errorsFor(
      withRuleCondition({ left: asStatePath('board.count'), operator: 'equals' })
    );
    expect(errors.some((e) => e.includes('never holds'))).toBe(true);
  });

  it('accepts a unary operator with no right operand', () => {
    expect(
      errorsFor(withRuleCondition({ left: asStatePath('board.count'), operator: 'exists' }))
    ).toEqual([]);
  });
});

describe('validateElementShapes — condition trees', () => {
  it('rejects an unknown composite kind', () => {
    const errors = errorsFor(withRuleCondition({ kind: 'AND', conditions: [] }));
    expect(errors.some((e) => e.includes('unknown condition kind "AND"'))).toBe(true);
  });

  it('rejects an empty all/any composite as constant', () => {
    expect(errorsFor(withRuleCondition({ kind: 'all', conditions: [] })).join()).toContain(
      'always true'
    );
    expect(errorsFor(withRuleCondition({ kind: 'any', conditions: [] })).join()).toContain(
      'always false'
    );
  });

  it('recurses into composite children', () => {
    const errors = errorsFor(
      withRuleCondition({
        kind: 'all',
        conditions: [
          { left: asStatePath('board.count'), operator: 'exists' },
          { left: asStatePath('board.count'), operator: 'nope', right: 1 }
        ]
      })
    );
    expect(errors.some((e) => e.includes('all[1]') && e.includes('unknown operator'))).toBe(true);
  });

  it('rejects a `not` with nothing to negate', () => {
    expect(errorsFor(withRuleCondition({ kind: 'not' })).join()).toContain('needs a "condition"');
  });

  it('rejects a quantifier missing overPath / as / where', () => {
    const errors = errorsFor(withRuleCondition({ kind: 'all_match' }));
    expect(errors.some((e) => e.includes('"overPath"'))).toBe(true);
    expect(errors.some((e) => e.includes('"as"'))).toBe(true);
    expect(errors.some((e) => e.includes('"where"'))).toBe(true);
  });

  it('names the scenario-assertion shape when it is used as a condition', () => {
    const errors = errorsFor(
      withRuleCondition({ path: 'board.count', operator: 'equals', value: 1 })
    );
    expect(errors.some((e) => e.includes('SCENARIO assertion shape'))).toBe(true);
  });

  // The leaf SHAPE checks. apply_batch hands each op through as an untyped bag,
  // so a leaf can arrive with the operator under the wrong key; every consumer
  // then reads `operator: undefined` and the comparison silently never fires —
  // a dead rule that dry_run reports as valid. These are the shapes observed in
  // the wild.
  it('flags a leaf whose operator sits under the builder\'s "op" key', () => {
    const errors = errorsFor(
      withRuleCondition({ left: asStatePath('board.count'), op: 'neq', right: 0 })
    );
    expect(errors.some((e) => /unknown key\(s\) "op"/.test(e))).toBe(true);
    expect(errors.some((e) => /Did you mean "operator"\?/.test(e))).toBe(true);
  });

  it('hints at "right" when the leaf carries a "value" or "expected" key', () => {
    const errors = errorsFor(
      withRuleCondition({ left: asStatePath('board.count'), operator: 'equals', value: 0 })
    );
    expect(errors.some((e) => /Did you mean "right"\?/.test(e))).toBe(true);
  });

  it('checks leaf keys nested inside composite conditions', () => {
    const errors = errorsFor(
      withRuleCondition({
        kind: 'any',
        conditions: [
          { kind: 'not', condition: { left: asStatePath('board.count'), op: 'eq', right: 0 } },
          { left: asStatePath('board.count'), operator: 'equals', right: 1 }
        ]
      })
    );
    expect(errors.some((e) => /unknown key\(s\) "op"/.test(e))).toBe(true);
  });
});

describe('validateElementShapes — fabricated invariant consequents', () => {
  // A fabricated consequent field is the worst of these: the builders drop it,
  // so "downloaded implies premium" becomes "downloaded must ALWAYS be true" —
  // an inversion that then fires on perfectly legal data. The MCP builders now
  // reject it at write time; this covers snapshots where the key survived.
  const withFeatureInvariant = (extra: Record<string, unknown>): Feature =>
    ({
      ...buildFeature(),
      featureInvariants: [
        {
          id: asInvariantId('inv-1'),
          name: 'Implication written the wrong way',
          message: 'x',
          description: 'antecedent => consequent',
          condition: { left: asStatePath('board.count'), operator: 'greater_than', right: 0 },
          ...extra
        }
      ]
    }) as unknown as Feature;

  it.each(['mustHold', 'then', 'implies', 'ensure'])(
    'flags an invariant carrying a fabricated "%s" consequent',
    (key) => {
      const errors = errorsFor(
        withFeatureInvariant({
          [key]: { left: asStatePath('board.count'), operator: 'equals', right: 1 }
        })
      );
      expect(errors.some((e) => new RegExp(`no "${key}" field`).test(e))).toBe(true);
      expect(errors.some((e) => /kind: "any"/.test(e))).toBe(true);
    }
  );

  it('flags the consequent on surface and action invariants too', () => {
    const invariant = {
      id: asInvariantId('inv-2'),
      name: 'x',
      message: 'x',
      description: 'x',
      condition: { left: asStatePath('board.count'), operator: 'exists' },
      then: { left: asStatePath('board.count'), operator: 'equals', right: 1 }
    };
    const onSurface = buildFeature({ invariants: [invariant] } as unknown as Partial<Surface>);
    expect(errorsFor(onSurface).some((e) => /no "then" field/.test(e))).toBe(true);
    const onAction = buildFeature({
      actions: [
        {
          id: asActionId('a1'),
          name: 'Act',
          intent: 'do something',
          parameters: [],
          requiredStates: [],
          rules: [],
          invariants: [invariant],
          effects: [],
          emittedEvents: [],
          transitions: []
        }
      ]
    } as unknown as Partial<Surface>);
    expect(errorsFor(onAction).some((e) => /no "then" field/.test(e))).toBe(true);
  });

  it('accepts an implication written the supported way', () => {
    const good = withFeatureInvariant({});
    const withAnyNot = {
      ...good,
      featureInvariants: [
        {
          ...(good.featureInvariants ?? [])[0],
          condition: {
            kind: 'any',
            conditions: [
              {
                kind: 'not',
                condition: { left: asStatePath('board.count'), operator: 'greater_than', right: 0 }
              },
              { left: asStatePath('board.count'), operator: 'equals', right: 1 }
            ]
          }
        }
      ]
    } as unknown as Feature;
    expect(errorsFor(withAnyNot)).toEqual([]);
  });

  it('does not strand a feature that already stores a malformed leaf', () => {
    // The write gate is diff-aware: a pre-existing bad leaf must stay editable
    // (the error is in the baseline too), or shipping this check would make
    // every feature authored through the lax path unwritable.
    const stored = withRuleCondition({ left: asStatePath('board.count'), op: 'neq', right: 0 });
    const edited: Feature = { ...stored, name: `${stored.name} (edited)` };
    expect(introducedValidationErrors(stored, edited)).toEqual([]);
  });
});

describe('validateElementShapes — effects', () => {
  const withEffect = (effect: unknown): Feature =>
    buildFeature({
      actions: [
        {
          id: asActionId('a1'),
          name: 'Act',
          intent: 'do something',
          parameters: [],
          requiredStates: [],
          rules: [],
          invariants: [],
          effects: [effect],
          emittedEvents: [],
          transitions: []
        }
      ]
    } as unknown as Partial<Surface>);

  it('rejects an unknown effect type', () => {
    expect(errorsFor(withEffect({ id: asEffectId('e1'), type: 'set_stat' })).join()).toContain(
      'unknown effect.type "set_stat"'
    );
  });

  it('rejects a known effect type missing a required field', () => {
    const errors = errorsFor(
      withEffect({ id: asEffectId('e1'), type: 'set_state', path: asStatePath('board.count') })
    );
    expect(errors.some((e) => e.includes('requires "value"'))).toBe(true);
    expect(
      errorsFor(withEffect({ id: asEffectId('e1'), type: 'emit_event' })).join()
    ).toContain('requires "event"');
    expect(
      errorsFor(withEffect({ id: asEffectId('e1'), type: 'transition_surface' })).join()
    ).toContain('requires "target"');
  });

  it('accepts allow_action, which requires nothing', () => {
    expect(errorsFor(withEffect({ id: asEffectId('e1'), type: 'allow_action' }))).toEqual([]);
  });

  it('accepts invoke_operation, which shipped in the write path and the simulator', () => {
    expect(
      errorsFor(
        withEffect({
          id: asEffectId('e1'),
          type: 'invoke_operation',
          dependencyId: 'dep1',
          operation: 'charge'
        })
      )
    ).toEqual([]);
  });
});

describe('validateElementShapes — invariants and scenarios', () => {
  it('checks invariant conditions with the same rigor as rules', () => {
    const feature = buildFeature({
      invariants: [
        {
          id: asInvariantId('i1'),
          name: 'never negative',
          description: 'Count stays positive.',
          condition: { left: asStatePath('board.count'), operator: 'not_below', right: 0 }
        }
      ]
    } as unknown as Partial<Surface>);
    expect(errorsFor(feature).join()).toContain('unknown operator "not_below"');
  });

  it('checks scenario assertion operators and expectedStatus', () => {
    const feature = buildFeature({
      actions: [
        {
          id: asActionId('a1'),
          name: 'Act',
          intent: 'do something',
          parameters: [],
          requiredStates: [],
          rules: [],
          invariants: [],
          effects: [],
          emittedEvents: [],
          transitions: [],
          scenarios: [
            {
              id: asScenarioId('sc1'),
              name: 'happy',
              description: 'Works.',
              stateOverrides: [],
              parameterOverrides: [],
              expectedStatus: 'ok',
              expectedAssertions: [
                { path: asStatePath('board.count'), operator: '>=', value: 1, description: 'x' },
                { path: asStatePath('board.count'), operator: 'equals', description: 'y' }
              ]
            }
          ]
        }
      ]
    } as unknown as Partial<Surface>);
    const errors = errorsFor(feature);
    expect(errors.some((e) => e.includes('expectedStatus must be'))).toBe(true);
    expect(errors.some((e) => e.includes('unknown operator ">="'))).toBe(true);
    expect(errors.some((e) => e.includes('can never hold'))).toBe(true);
  });
});

describe('validateFeature integration', () => {
  it('surfaces shape errors through the write gate, not just the shape pass', () => {
    const result = validateFeature(
      withRuleCondition({ left: asStatePath('board.count'), operator: 'gte', right: 1 })
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.includes('unknown operator "gte"'))).toBe(true);
    }
  });
});

describe('backward compatibility with stores written by an older engine', () => {
  // The shape pass is new strictness, and the package has real users. What
  // protects them is that EVERY write path gates on `introducedValidationErrors`
  // (diff-aware), never on `validateFeature` directly. These tests pin that:
  // legacy malformed data stays editable, only NEW breakage is refused.
  const legacyBad = withRuleCondition({
    left: asStatePath('board.count'),
    operator: 'gte', // never a valid operator; silently evaluated false pre-0.14
    right: 1
  });

  it('does not block an unrelated edit to a feature that already had a bad operator', () => {
    const edited: Feature = { ...legacyBad, description: 'Edited description.' };
    expect(introducedValidationErrors(legacyBad, edited)).toEqual([]);
  });

  it('does not block an edit that touches the malformed rule itself', () => {
    // Fixing the description of the very rule that carries the bad operator
    // must still be possible — otherwise the spec becomes unrepairable.
    const surface = legacyBad.surfaces[0]!;
    const rule = surface.rules[0]!;
    const edited: Feature = {
      ...legacyBad,
      surfaces: [{ ...surface, rules: [{ ...rule, description: 'Clearer wording.' }] }]
    };
    expect(introducedValidationErrors(legacyBad, edited)).toEqual([]);
  });

  it('still refuses to INTRODUCE a new bad operator', () => {
    const clean = buildFeature();
    const introduced = introducedValidationErrors(clean, legacyBad);
    expect(introduced.some((e) => e.includes('unknown operator "gte"'))).toBe(true);
  });

  it('requires a brand-new feature to be clean (no prior snapshot)', () => {
    expect(introducedValidationErrors(null, legacyBad).length).toBeGreaterThan(0);
    expect(introducedValidationErrors(null, buildFeature())).toEqual([]);
  });

  it('lets a previously-rejected invoke_operation effect through once it is well-formed', () => {
    // Before 0.14 this effect type failed validation outright, so a legitimate
    // boundary call could never be authored. Nothing that used to work breaks;
    // something that never worked starts working.
    const feature = {
      ...buildFeature({
        actions: [
          {
            id: asActionId('a1'),
            name: 'Charge',
            intent: 'take payment',
            parameters: [],
            requiredStates: [],
            rules: [],
            invariants: [],
            effects: [
              {
                id: asEffectId('e1'),
                type: 'invoke_operation',
                dependencyId: 'dep-1',
                operation: 'charge',
                resultPath: asStatePath('board.count'),
                resultValue: 1,
                description: 'Charge the card.'
              }
            ],
            emittedEvents: [],
            transitions: []
          }
        ]
      } as unknown as Partial<Surface>),
      dependencies: [
        {
          id: 'dep-1',
          name: 'Stripe',
          kind: 'service',
          description: 'Card payments.',
          operations: [{ id: 'op-1', name: 'charge', description: 'Charge a card.' }]
        }
      ]
    } as unknown as Feature;
    expect(validateFeature(feature).valid).toBe(true);
    expect(validateReferenceIntegrity(feature).valid).toBe(true);
  });

  it('now catches the references invoke_operation was never checked for', () => {
    const feature = {
      ...buildFeature({
        actions: [
          {
            id: asActionId('a1'),
            name: 'Charge',
            intent: 'take payment',
            parameters: [],
            requiredStates: [],
            rules: [],
            invariants: [],
            effects: [
              {
                id: asEffectId('e1'),
                type: 'invoke_operation',
                dependencyId: 'dep-missing',
                operation: 'charge',
                resultPath: asStatePath('nowhere.declared'),
                description: 'Charge the card.'
              }
            ],
            emittedEvents: [],
            transitions: []
          }
        ]
      } as unknown as Partial<Surface>),
      dependencies: []
    } as unknown as Feature;
    const result = validateReferenceIntegrity(feature);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.includes('dependencyId "dep-missing"'))).toBe(true);
      expect(result.errors.some((e) => e.includes('resultPath "nowhere.declared"'))).toBe(true);
    }
  });
});
