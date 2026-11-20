import { describe, expect, it } from 'vitest';
import type { Feature } from '../entities/Feature';
import { asEntityFieldId, asEntityId, asStateDefinitionId, asSurfaceId } from '../value-objects/ids';
import { asStatePath } from '../value-objects/StatePath';
import { VALIDATION, validationFeature } from './DisabledElements.fixture';
import { removeStateDefinition, updateStateDefinition } from './FeatureTransforms';
import { entityFieldPathWarnings } from './EntityFieldPaths';

/**
 * An entity field documents the state path it maps to. A rename or a removal
 * of that state leaves the field naming a path the feature no longer declares:
 * nothing refuses it (the data model may be the one about to change), so the
 * batch says it.
 */

const withProfile = (): Feature => {
  const base = validationFeature();
  return {
    ...base,
    surfaces: base.surfaces.map((s) => ({
      ...s,
      stateDefinitions: [
        ...s.stateDefinitions,
        {
          id: asStateDefinitionId('sd-age'),
          path: asStatePath('profile.age'),
          type: 'number',
          defaultValue: 20,
          description: 'The age of the person signed in.'
        }
      ]
    })),
    entities: [
      {
        id: asEntityId('ent-profile'),
        namespace: 'profile',
        description: 'The person signed in.',
        fields: [{ id: asEntityFieldId('fld-age'), name: 'age', type: 'number', path: asStatePath('profile.age') }]
      }
    ]
  };
};

describe('an entity field left on a state path the feature no longer declares', () => {
  it('is named after a rename', () => {
    const before = withProfile();
    const after = updateStateDefinition(before, asSurfaceId(VALIDATION.surface), asStateDefinitionId('sd-age'), {
      path: asStatePath('profile.years')
    });
    const warnings = entityFieldPathWarnings(before, after);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"profile.age"');
    expect(warnings[0]).toContain('"age"');
  });

  it('is named after a removal', () => {
    const before = withProfile();
    const after = removeStateDefinition(before, asSurfaceId(VALIDATION.surface), asStateDefinitionId('sd-age'));
    expect(entityFieldPathWarnings(before, after)).toHaveLength(1);
  });

  it('says nothing when the path is still declared, or was never', () => {
    const before = withProfile();
    expect(entityFieldPathWarnings(before, before)).toEqual([]);
    const undeclared: Feature = { ...before, surfaces: validationFeature().surfaces };
    expect(entityFieldPathWarnings(undeclared, undeclared)).toEqual([]);
  });
});
