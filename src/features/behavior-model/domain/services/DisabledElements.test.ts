import { describe, expect, it } from 'vitest';
import { runScenariosUseCase } from '$features/simulator/application/use-cases/RunScenarios';
import { exploreStateSpace } from '$features/simulator/domain/StateExplorer';
import { scoreFeature } from '$features/maturity/domain/MaturityScorer';
import { nextElementVersions } from './FeatureElementVersions';
import {
  DISABLE_REFUSALS,
  disableElement,
  disableInMemory,
  disabledCounts,
  disabledElements,
  disabledIndexKeys,
  enableElement,
  operativeFeature,
  scenariosLeftOut
} from './DisabledElements';
import { ADRIEN, VALIDATION, validationFeature } from './DisabledElements.fixture';

const actionOf = (feature: ReturnType<typeof validationFeature>, id: string) =>
  feature.surfaces.flatMap((s) => s.actions).find((a) => String(a.id) === id);

const runScenarios = runScenariosUseCase();

describe('disabling an element of a feature', () => {
  it('marks the element with who, when and why, by its id [criterion:ac-leaf-e40ccfa1-2c1e-46ce-a6c3-175cea42b47c]', () => {
    const next = disableElement(validationFeature(), VALIDATION.viewerRule, ADRIEN);
    const rule = actionOf(next, VALIDATION.validate)!.rules.find((r) => String(r.id) === VALIDATION.viewerRule)!;
    expect(rule.disabled).toEqual(ADRIEN);
  });

  it('keeps the element, its id and everything it holds, and enabling brings it back as it was [criterion:ac-leaf-abbb6454-c761-42e0-909b-d341e45481dc]', () => {
    const before = validationFeature();
    const disabled = disableElement(before, VALIDATION.validate, ADRIEN);
    const action = actionOf(disabled, VALIDATION.validate)!;
    expect(String(action.id)).toBe(VALIDATION.validate);
    expect(action.rules.map((r) => String(r.id))).toEqual([VALIDATION.viewerRule]);
    expect(action.scenarios?.map((s) => String(s.id))).toEqual([VALIDATION.editorScenario, VALIDATION.viewerScenario]);
    expect(enableElement(disabled, VALIDATION.validate)).toEqual(before);
  });

  it('disables what an action or the feature holds [criterion:ac-leaf-5ecaa85c-e299-4cd7-80a1-915322d07355]', () => {
    const offAction = disableElement(validationFeature(), VALIDATION.validate, ADRIEN);
    const held = disabledElements(offAction).filter((e) => e.heldBy?.id === VALIDATION.validate);
    expect(held.map((e) => e.id).sort()).toEqual([VALIDATION.editorScenario, VALIDATION.viewerRule, VALIDATION.viewerScenario].sort());
    expect(held.every((e) => e.disabled.by === ADRIEN.by && e.disabled.reason === ADRIEN.reason)).toBe(true);
    // The scenario that replays the disabled action goes with it.
    expect(scenariosLeftOut(offAction).map((s) => s.scenarioId)).toContain(VALIDATION.reopenScenario);

    const offFeature = disableElement(validationFeature(), VALIDATION.feature, ADRIEN);
    const operative = operativeFeature(offFeature);
    expect(operative.surfaces.flatMap((s) => s.actions)).toEqual([]);
    expect(operative.featureInvariants).toEqual([]);
    expect(operative.reachabilityGoals).toEqual([]);
    expect(disabledCounts(offFeature)).toMatchObject({ feature: 1, action: 2, rule: 2, scenario: 3, invariant: 1, reachability_goal: 1 });
  });

  it('refuses an empty reason, a second disable and a second enable, changing nothing [criterion:ac-leaf-0cecabc1-8797-4128-b40c-84dcfaee0296]', () => {
    const feature = validationFeature();
    expect(() => disableElement(feature, VALIDATION.viewerRule, { ...ADRIEN, reason: '  ' })).toThrow(DISABLE_REFUSALS.noReason);
    const once = disableElement(feature, VALIDATION.viewerRule, ADRIEN);
    expect(() => disableElement(once, VALIDATION.viewerRule, { ...ADRIEN, by: 'Someone else' })).toThrow(DISABLE_REFUSALS.disabledAlready);
    expect(() => enableElement(feature, VALIDATION.viewerRule)).toThrow(DISABLE_REFUSALS.enabledAlready);
    // Pure: a refusal leaves the feature it was given as it was.
    expect(feature).toEqual(validationFeature());
  });

  it('refuses an id the feature does not hold, naming it [rule:9f71f783] [rule:62c5289c]', () => {
    expect(() => disableElement(validationFeature(), 'no-such-id', ADRIEN)).toThrow(DISABLE_REFUSALS.unknown('no-such-id'));
    expect(() => enableElement(validationFeature(), 'no-such-id')).toThrow('no-such-id');
    // A surface or a state is not an element that can be disabled.
    expect(() => disableElement(validationFeature(), VALIDATION.surface, ADRIEN)).toThrow(DISABLE_REFUSALS.unknown(VALIDATION.surface));
  });

  it('refuses a second disable that would overwrite who disabled it [rule:0c866698], and an enable of an element in force [rule:758064ea]', () => {
    const once = disableElement(validationFeature(), VALIDATION.invariant, ADRIEN);
    expect(() => disableElement(once, VALIDATION.invariant, ADRIEN)).toThrow(DISABLE_REFUSALS.disabledAlready);
    expect(() => enableElement(validationFeature(), VALIDATION.goal)).toThrow(DISABLE_REFUSALS.enabledAlready);
  });

  it('moves no element version, so its code reads no drift once enabled again [criterion:ac-leaf-828a267d-6a27-458d-9552-1490b064b750]', () => {
    const before = { ...validationFeature(), elementVersions: nextElementVersions(null, validationFeature(), '2026-11-01T00:00:00.000Z') };
    const disabled = disableElement(before, VALIDATION.validate, ADRIEN);
    const versions = nextElementVersions(before, disabled, '2026-11-18T10:00:00.000Z');
    expect(versions[`action:${VALIDATION.validate}`]).toBe('2026-11-01T00:00:00.000Z');
    expect(versions[`rule:${VALIDATION.viewerRule}`]).toBe('2026-11-01T00:00:00.000Z');
  });
});

describe('the operative model every reading takes', () => {
  it('leaves the disabled elements out of the scenarios, the walk and the model check [criterion:ac-leaf-fdd4a79e-cc1f-44bd-a1a7-4cc6f31a5a26]', () => {
    const whole = validationFeature();
    // In force, the viewer is refused and the invariant holds.
    expect(runScenarios({ feature: operativeFeature(whole) }).failed).toBe(0);
    expect(exploreStateSpace(operativeFeature(whole)).invariantViolations).toEqual([]);

    // The rule alone disabled: the always-true statement still holds the viewer back.
    const noRule = disableElement(whole, VALIDATION.viewerRule, ADRIEN);
    expect(runScenarios({ feature: operativeFeature(noRule) }).failed).toBe(0);
    // Both disabled: the viewer validates, so the scenario that expects a refusal
    // fails. The scenarios read the model without them.
    const neither = disableElement(noRule, VALIDATION.invariant, ADRIEN);
    const run = runScenarios({ feature: operativeFeature(neither) });
    expect(run.results.find((r) => r.scenarioId === VALIDATION.viewerScenario)?.pass).toBe(false);

    // The model check judges no disabled goal, and explores no disabled action.
    const goals = (f: ReturnType<typeof validationFeature>) => exploreStateSpace(operativeFeature(f)).goalResults.map((g) => String(g.goalId));
    expect(goals(whole)).toEqual([VALIDATION.goal]);
    expect(goals(disableElement(whole, VALIDATION.goal, ADRIEN))).toEqual([]);
    const offReopen = exploreStateSpace(operativeFeature(disableElement(whole, VALIDATION.reopen, ADRIEN)));
    expect(JSON.stringify(offReopen)).not.toContain(VALIDATION.reopen);
  });

  it('does not run a scenario of a disabled element and counts it apart [criterion:ac-leaf-7c70d116-f395-4fd1-9e12-d41790f6e070]', () => {
    const off = disableElement(validationFeature(), VALIDATION.viewerScenario, ADRIEN);
    const run = runScenarios({ feature: operativeFeature(off) });
    expect(run.results.map((r) => r.scenarioId)).not.toContain(VALIDATION.viewerScenario);
    expect(run.total).toBe(2);
    expect(scenariosLeftOut(off)).toEqual([
      {
        scenarioId: VALIDATION.viewerScenario,
        name: 'Without sign-in a viewer validates nothing',
        actionId: VALIDATION.validate,
        actionName: 'Validate an element',
        disabled: ADRIEN
      }
    ]);
  });

  it('disables in memory for one trial and refuses an id the feature does not hold [criterion:ac-leaf-4d11b243-1cc7-4377-bff1-028e75887b02]', () => {
    const whole = validationFeature();
    const trial = disableInMemory(whole, [VALIDATION.viewerRule, VALIDATION.invariant], ADRIEN);
    expect(runScenarios({ feature: operativeFeature(trial) }).failed).toBe(1);
    expect(whole).toEqual(validationFeature());
    expect(() => disableInMemory(whole, [VALIDATION.viewerRule, 'rule-ghost'], ADRIEN)).toThrow('rule-ghost');
  });

  it('leaves the disabled elements out of the maturity', () => {
    const off = disableElement(validationFeature(), VALIDATION.reopen, ADRIEN);
    const score = scoreFeature(operativeFeature(off));
    expect(JSON.stringify(score)).not.toContain(VALIDATION.reopen);
  });

  it('comes back unchanged when nothing is disabled', () => {
    const whole = validationFeature();
    expect(operativeFeature(whole)).toBe(whole);
  });

  it('names the index keys of what is disabled, so the gaps and the drift read it disabled [criterion:ac-leaf-b881376b-8eba-4677-a79c-7c6cff34891c]', () => {
    const off = disableElement(validationFeature(), VALIDATION.validate, ADRIEN);
    expect([...disabledIndexKeys(off)].sort()).toEqual([`action:${VALIDATION.validate}`, `rule:${VALIDATION.viewerRule}`]);
    const whole = disableElement(validationFeature(), VALIDATION.feature, ADRIEN);
    expect(disabledIndexKeys(whole)).toContain(`surface:${VALIDATION.surface}`);
    expect(disabledIndexKeys(whole)).toContain('state:element.validated');
    expect(disabledIndexKeys(whole)).toContain(`invariant:${VALIDATION.invariant}`);
  });
});
