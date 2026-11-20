import { describe, expect, it } from 'vitest';
import type { Feature } from '../../entities/Feature';
import type { ActionOutcome } from '../../entities/ActionOutcome';
import { asEffectId, asOutcomeId } from '../../value-objects/ids';
import { asStatePath } from '../../value-objects/StatePath';
import { VALIDATION, validationFeature } from '../DisabledElements.fixture';
import { introducedValidationErrors, validateReferenceIntegrity } from '../../services/FeatureValidator';
import { updateStateDefinition } from '../FeatureTransforms';
import { asStateDefinitionId, asSurfaceId } from '../../value-objects/ids';

/**
 * The outcomes of an action read and write state like its rules do: the
 * condition that selects one and the effects it applies. Their paths are
 * checked against the declared state the same way, so a typo or a path
 * renamed away no longer leaves an outcome that silently never matches or
 * writes where nothing reads.
 */

const withOutcome = (outcome: ActionOutcome, feature: Feature = validationFeature()): Feature => ({
  ...feature,
  surfaces: feature.surfaces.map((s) => ({
    ...s,
    actions: s.actions.map((a) =>
      String(a.id) === VALIDATION.validate ? { ...a, outcomes: [...(a.outcomes ?? []), outcome] } : a
    )
  }))
});

const outcome = (conditionPath: string, effectPath: string, constName?: string): ActionOutcome => ({
  id: asOutcomeId('out-validated'),
  name: 'Validated',
  kind: 'success',
  condition: {
    left: asStatePath(conditionPath),
    operator: 'equals',
    right: constName ? { kind: 'const', name: constName } : 'editor'
  },
  effects: [
    {
      id: asEffectId('eff-out'),
      type: 'set_state',
      path: asStatePath(effectPath),
      value: true,
      description: 'Marks it.'
    }
  ],
  description: 'The element was validated.'
});

const errorsOf = (feature: Feature): readonly string[] => {
  const result = validateReferenceIntegrity(feature);
  return result.valid ? [] : result.errors;
};

describe('the state an outcome reads and writes', () => {
  it('accepts an outcome over declared state', () => {
    expect(errorsOf(withOutcome(outcome('session.role', 'element.validated')))).toEqual([]);
  });

  it('refuses a condition over a path no surface declares', () => {
    const errors = errorsOf(withOutcome(outcome('session.rol', 'element.validated')));
    expect(errors.join('\n')).toContain('"session.rol"');
    expect(errors.join('\n')).toContain('out-validated');
  });

  it('refuses an effect writing a path no surface declares', () => {
    const errors = errorsOf(withOutcome(outcome('session.role', 'element.validatd')));
    expect(errors.join('\n')).toContain('"element.validatd"');
  });

  it('refuses a constant the feature does not declare', () => {
    const errors = errorsOf(withOutcome(outcome('session.role', 'element.validated', 'EDITOR_ROLE')));
    expect(errors.join('\n')).toContain('"EDITOR_ROLE"');
  });

  it('refuses a rename that leaves an outcome reading the old path', () => {
    // A state only the outcome reads, so nothing else would catch the rename.
    const base = validationFeature();
    const withMode: Feature = {
      ...base,
      surfaces: base.surfaces.map((s) => ({
        ...s,
        stateDefinitions: [
          ...s.stateDefinitions,
          {
            id: asStateDefinitionId('sd-mode'),
            path: asStatePath('session.mode'),
            type: 'string',
            defaultValue: 'editor',
            description: 'How the person works.'
          }
        ]
      }))
    };
    const before = withOutcome(outcome('session.mode', 'element.validated'), withMode);
    const after = updateStateDefinition(before, asSurfaceId(VALIDATION.surface), asStateDefinitionId('sd-mode'), {
      path: asStatePath('session.style')
    });
    expect(introducedValidationErrors(before, after).join('\n')).toContain('"session.mode"');
  });
});
