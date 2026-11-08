import { describe, expect, it, vi } from 'vitest';
import type { Action } from '../../src/features/behavior-model/domain/entities/Action';
import type { Feature } from '../../src/features/behavior-model/domain/entities/Feature';
import type { Surface } from '../../src/features/behavior-model/domain/entities/Surface';
import {
  asActionId,
  asEffectId,
  asFeatureId,
  asRuleId,
  asStateDefinitionId,
  asSurfaceId
} from '../../src/features/behavior-model/domain/value-objects/ids';
import { asStatePath } from '../../src/features/behavior-model/domain/value-objects/StatePath';
import { unavailableProver } from '../../src/features/prover/unavailableProver';
import {
  detectSpecGaps,
  SPEC_GAP_CODES,
  stateCoherenceGaps,
  type SpecGap
} from './specGaps';

const action = (over: Partial<Action> & Pick<Action, 'id' | 'name'>): Action => ({
  intent: 'does a thing',
  parameters: [],
  requiredStates: [],
  rules: [],
  invariants: [],
  effects: [{ id: asEffectId('eff'), type: 'allow_action' }],
  emittedEvents: [],
  transitions: [],
  ...over
});

const feature = (actions: readonly Action[], over: Partial<Feature> = {}): Feature => {
  const surface: Surface = {
    id: asSurfaceId('surf'),
    name: 'Main',
    type: 'screen',
    description: 'main',
    stateDefinitions: [
      {
        id: asStateDefinitionId('sd'),
        path: asStatePath('a.b'),
        type: 'boolean',
        defaultValue: false,
        description: 'flag'
      }
    ],
    actions,
    rules: [],
    invariants: [],
    transitions: []
  };
  return {
    id: asFeatureId('feat'),
    name: 'Feat',
    description: 'a feature',
    surfaces: [surface],
    personas: [],
    resources: [],
    entities: [],
    events: [],
    ...over
  } as Feature;
};

describe('detectSpecGaps — Evolution proposals', () => {
  it('does not flag an Evolution proposal for missing effects or implementation', () => {
    const proposal = action({
      id: asActionId('evo'),
      name: 'Sign in with SSO',
      effects: [], // intentionally empty — would normally be a critical gap
      evolution: { rationale: 'Competitors offer it' }
    });
    const gaps = detectSpecGaps(feature([proposal]), new Set());
    expect(gaps.filter((g) => g.entityId === 'evo')).toEqual([]);
  });

  it('still flags committed actions normally', () => {
    const committed = action({ id: asActionId('real'), name: 'Save', effects: [] });
    const gaps = detectSpecGaps(feature([committed]), new Set());
    expect(gaps.some((g) => g.entityId === 'real' && g.reason.includes('no effects'))).toBe(true);
  });

  it('a proposal does not satisfy an expectedActions entry of the same name', () => {
    const proposal = action({
      id: asActionId('evo'),
      name: 'Export to CSV',
      evolution: { rationale: 'Users ask for it' }
    });
    const gaps = detectSpecGaps(
      feature([proposal], { expectedActions: ['Export to CSV'] }),
      new Set()
    );
    expect(
      gaps.some((g) => g.entityType === 'feature' && g.reason.includes('Export to CSV'))
    ).toBe(true);
  });
});

describe('detectSpecGaps — effect detection', () => {
  it('does not flag "no effects" when the effect lives inside a rule', () => {
    const tick = action({
      id: asActionId('tick'),
      name: 'Resolve Tick',
      effects: [], // the whole behavior is rule-carried
      rules: [
        {
          id: asRuleId('r1'),
          category: 'business',
          condition: { left: asStatePath('a.b'), operator: 'is_true' },
          effect: {
            id: asEffectId('e1'),
            type: 'set_state',
            path: asStatePath('a.b'),
            value: false
          }
        }
      ]
    });
    const gaps = detectSpecGaps(feature([tick]), new Set([String(tick.id)]));
    expect(gaps.some((g) => g.entityId === 'tick' && g.reason.includes('no effects'))).toBe(false);
  });

  it('still flags an action with no effects anywhere (no direct, no rule, no onBlocked)', () => {
    const empty = action({ id: asActionId('empty'), name: 'Does Nothing', effects: [], rules: [] });
    const gaps = detectSpecGaps(feature([empty]), new Set([String(empty.id)]));
    expect(gaps.some((g) => g.entityId === 'empty' && g.reason.includes('no effects'))).toBe(true);
  });
});

describe('detectSpecGaps — emittedEvents consistency', () => {
  it('flags an emittedEvents declaration that no emit_event effect fires', () => {
    const declarer = action({
      id: asActionId('emit'),
      name: 'Step Epoch',
      emittedEvents: ['epoch.stepped'] as unknown as Action['emittedEvents'],
      effects: [{ id: asEffectId('e1'), type: 'allow_action' }] // no emit_event for it
    });
    const gaps = detectSpecGaps(feature([declarer]), new Set([String(declarer.id)]));
    expect(
      gaps.some((g) => g.entityId === 'emit' && g.reason.includes('epoch.stepped') && g.reason.includes('inert'))
    ).toBe(true);
  });

  it('does not flag a declared event that an emit_event effect actually fires', () => {
    const emitter = action({
      id: asActionId('emit'),
      name: 'Step Epoch',
      emittedEvents: ['epoch.stepped'] as unknown as Action['emittedEvents'],
      effects: [
        { id: asEffectId('e1'), type: 'emit_event', event: 'epoch.stepped' }
      ] as unknown as Action['effects']
    });
    const gaps = detectSpecGaps(feature([emitter]), new Set([String(emitter.id)]));
    expect(gaps.some((g) => g.entityId === 'emit' && g.reason.includes('inert'))).toBe(false);
  });
});

describe('detectSpecGaps — external dependencies', () => {
  it('flags an external operation with no timeout and no failure modes', () => {
    const withDep = feature([action({ id: asActionId('a'), name: 'A' })], {
      dependencies: [
        {
          id: 'dep' as never,
          name: 'Payments',
          kind: 'service',
          operations: [{ id: 'op' as never, name: 'charge' }]
        }
      ]
    });
    const gaps = detectSpecGaps(withDep, new Set(['a']));
    expect(
      gaps.some((g) => g.reason.includes('Payments.charge') && g.reason.includes('timeout'))
    ).toBe(true);
    expect(gaps.some((g) => g.reason.includes('failure modes'))).toBe(true);
  });
});

describe('detectSpecGaps — decision-table analysis', () => {
  it('surfaces two rules that disagree on the same condition as a critical gap', () => {
    const contradictory = action({
      id: asActionId('dec'),
      name: 'Approve',
      rules: [
        {
          id: asRuleId('r1'),
          category: 'permissions',
          condition: { left: asStatePath('a.b'), operator: 'is_true' },
          effect: { id: asEffectId('e1'), type: 'allow_action' }
        },
        {
          id: asRuleId('r2'),
          category: 'permissions',
          condition: { left: asStatePath('a.b'), operator: 'is_true' },
          effect: { id: asEffectId('e2'), type: 'block_action', reason: 'nope' }
        }
      ]
    });
    const gaps = detectSpecGaps(feature([contradictory]), new Set([String(contradictory.id)]));
    const gap = gaps.find((g) => g.entityId === 'dec' && g.reason.includes('disagree'));
    expect(gap?.severity).toBe('critical');
  });

  it('does not flag a clean, mutually-exclusive rule set', () => {
    const clean = action({
      id: asActionId('clean'),
      name: 'Route',
      rules: [
        {
          id: asRuleId('r1'),
          category: 'business',
          condition: { left: asStatePath('a.b'), operator: 'is_true' },
          effect: { id: asEffectId('e1'), type: 'allow_action' }
        },
        {
          id: asRuleId('r2'),
          category: 'business',
          condition: { left: asStatePath('a.b'), operator: 'is_false' },
          effect: { id: asEffectId('e2'), type: 'block_action', reason: 'closed' }
        }
      ]
    });
    const gaps = detectSpecGaps(feature([clean]), new Set([String(clean.id)]));
    expect(gaps.some((g) => g.entityId === 'clean' && g.reason.includes('disagree'))).toBe(false);
  });
});

describe('detectSpecGaps: an invalid state path', () => {
  it('is a critical gap on the surface that declares it', () => {
    const base = feature([]);
    const withBadPath = {
      ...base,
      surfaces: base.surfaces.map((surface) => ({
        ...surface,
        stateDefinitions: [
          ...surface.stateDefinitions,
          { id: asStateDefinitionId('bad'), path: 'driver.0.name' as never, type: 'string', defaultValue: '' }
        ]
      }))
    } as Feature;
    const gaps = detectSpecGaps(withBadPath, new Set());
    expect(gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: 'critical', entityType: 'surface', reason: expect.stringContaining('"driver.0.name"') })
      ])
    );
  });
});

// Criterion a4ccc5a5: the gap that points at a generated scenario reads in the project's language.
describe('gap codes', () => {
  const NB = '\u00a0';
  const busy = (): Feature => {
    const approve = action({
      id: asActionId('dec'),
      name: 'Approve',
      roles: ['destructive', 'async', 'validation'],
      emittedEvents: ['order.approved' as never],
      bypassInvariants: true,
      invariantRelaxation: { invariantIds: ['ghost' as never], rationale: 'r' },
      rules: [
        {
          id: asRuleId('r1'),
          category: 'permissions',
          condition: { left: asStatePath('a.b'), operator: 'is_true' },
          effect: { id: asEffectId('e1'), type: 'allow_action' }
        },
        {
          id: asRuleId('r2'),
          category: 'permissions',
          condition: { left: asStatePath('a.b'), operator: 'is_true' },
          effect: { id: asEffectId('e2'), type: 'block_action', reason: 'nope' }
        }
      ]
    } as Partial<Action> & Pick<Action, 'id' | 'name'>);
    const empty = action({ id: asActionId('empty'), name: 'Idle', effects: [] });
    return feature([approve, empty], {
      expectedActions: ['Refund'],
      dependencies: [
        {
          id: 'dep' as never,
          name: 'Stripe',
          kind: 'service' as never,
          operations: [{ id: 'op' as never, name: 'charge' }]
        },
        { id: 'dep2' as never, name: 'Mailer', kind: 'service' as never, operations: [] }
      ]
    } as Partial<Feature>);
  };

  const allGaps = (lang: 'en' | 'fr'): readonly SpecGap[] => detectSpecGaps(busy(), new Set(), lang);

  it('gives every gap a code from the published list', () => {
    const gaps = allGaps('en');
    expect(gaps.length).toBeGreaterThan(10);
    for (const gap of gaps) expect(Object.keys(SPEC_GAP_CODES)).toContain(gap.code);
    expect(new Set(gaps.map((g) => g.code))).toEqual(
      new Set([
        'missing-expected-action',
        'no-effects',
        'inert-emitted-event',
        'untested-destructive',
        'async-without-loading-error',
        'validation-without-blocking-rule',
        'not-implemented',
        'bypass-invariants',
        'dangling-invariant-relaxation',
        'decision:conflicting-rules',
        'dependency-without-operations',
        'operation-without-timeout',
        'operation-without-failure-modes'
      ])
    );
  });

  it('names the element a gap is about when it is not the entity itself', () => {
    const gaps = allGaps('en');
    expect(gaps.find((g) => g.code === 'decision:conflicting-rules')?.subjectId).toBe('r1');
    expect(gaps.find((g) => g.code === 'dangling-invariant-relaxation')?.subjectId).toBe('ghost');
    expect(gaps.find((g) => g.code === 'operation-without-timeout')?.subjectId).toBe('op');
    expect(gaps.find((g) => g.code === 'dependency-without-operations')?.subjectId).toBe('dep2');
    expect(gaps.find((g) => g.code === 'no-effects')?.subjectId).toBeUndefined();
  });

  it('keeps codes, entities and subjects identical across languages', () => {
    const strip = (g: SpecGap) => ({ ...g, reason: '', suggestedFix: '' });
    expect(allGaps('fr').map(strip)).toEqual(allGaps('en').map(strip));
  });

  it('writes every reason and fix in French, with French typography and model names untouched', () => {
    const en = allGaps('en');
    const fr = allGaps('fr');
    fr.forEach((gap, i) => {
      expect(gap.reason).not.toBe(en[i]!.reason);
      expect(gap.suggestedFix).not.toBe(en[i]!.suggestedFix);
      expect(gap.reason).not.toMatch(/ [:;?!]/);
      expect(gap.reason).not.toMatch(/« | »/);
    });
    const byCode = (code: string) => fr.find((g) => g.code === code)!;
    expect(byCode('no-effects').reason).toBe(
      `L'action «${NB}Idle${NB}» n'a aucun effet (ni sur l'action, ni dans ses règles, ni dans onBlocked).`
    );
    expect(byCode('missing-expected-action').reason).toBe(
      `L'entrée «${NB}Refund${NB}» de expectedActions n'a aucune action correspondante.`
    );
    expect(byCode('inert-emitted-event').reason).toContain(`«${NB}order.approved${NB}»`);
    expect(byCode('decision:conflicting-rules').reason).toBe(
      `L'action «${NB}Approve${NB}»${NB}: les règles n°${NB}1 et n°${NB}2 se déclenchent sur la même condition mais leurs effets divergent, donc le résultat dépend de l'ordre des règles et non de l'intention.`
    );
    expect(byCode('operation-without-timeout').reason).toBe(
      `L'opération externe «${NB}Stripe.charge${NB}» n'a aucun délai d'expiration documenté.`
    );
  });

  // Criterion f0c19aec: a proof module asked for and not loaded says so, never reads clean.
  it('says the solver did not start, in one gap, where the proof module did not load', async () => {
    const prover = unavailableProver('@lyriks/unspa-prover', 'it was built for engine contract 2');
    const run = (language: 'en' | 'fr') =>
      prover.specGaps(busy(), { projectFeatures: [busy()], complete: false, language, scenarioRuns: [] });
    const en = await run('en');
    expect(en.gaps.map((g) => g.code)).toEqual(['solver-unavailable']);
    expect(Object.keys(SPEC_GAP_CODES)).toContain('solver-unavailable');
    expect(en.gaps[0]!.reason).toBe(
      'The solver did not start: it was built for engine contract 2, so nothing was proven: the gaps below come from the structural checks alone.'
    );
    expect(en.proof).toEqual({ solver: 'unavailable', reason: 'The solver did not start: it was built for engine contract 2' });
    expect((await run('fr')).gaps[0]!.reason).toBe(
      `Le solveur n'a pas démarré (it was built for engine contract 2), donc rien n'a été prouvé${NB}: les points ci-dessous ne viennent que des vérifications structurelles.`
    );
  });

  it('keeps the English wording when no language is given', () => {
    expect(detectSpecGaps(busy(), new Set())).toEqual(detectSpecGaps(busy(), new Set(), 'en'));
    expect(detectSpecGaps(busy(), new Set()).find((g) => g.code === 'no-effects')?.reason).toBe(
      'Action "Idle" has no effects (none on the action, its rules, or onBlocked).'
    );
  });

  it('codes a canonical state issue with the state it is about, in French too', () => {
    const f = feature([]);
    const states = [
      {
        id: 'st1',
        path: 'order.status',
        type: 'string',
        owner: { featureId: f.id },
        links: { dataField: { featureId: 'gone', entityId: 'e', fieldId: 'x' } }
      }
    ] as never;
    const [gap] = stateCoherenceGaps(f, states, [f], 'fr');
    expect(gap).toMatchObject({ code: 'state:missing-data-field', subjectId: 'st1', severity: 'critical' });
    expect(gap!.reason).toBe(
      `État canonique «${NB}order.status${NB}»${NB}: le champ de données lié gone/e/x n'existe pas.`
    );
  });
});

