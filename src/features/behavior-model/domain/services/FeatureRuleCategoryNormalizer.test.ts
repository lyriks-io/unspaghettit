import { describe, expect, it } from 'vitest';
import type { Feature } from '../entities/Feature';
import type { Surface } from '../entities/Surface';
import {
  asActionId,
  asEffectId,
  asFeatureId,
  asRuleId,
  asSurfaceId
} from '../value-objects/ids';
import { asStatePath } from '../value-objects/StatePath';
import { normalizeFeatureRuleCategories } from './FeatureRuleCategoryNormalizer';

const surfaceWithRule = (category: string): Surface => ({
  id: asSurfaceId('s'),
  name: 'Surf',
  type: 'screen',
  stateDefinitions: [],
  actions: [
    {
      id: asActionId('a'),
      name: 'A',
      intent: '',
      parameters: [],
      requiredStates: [],
      rules: [
        {
          id: asRuleId('r'),
          // legacy/typo category preserved on purpose:
          category: category as never,
          condition: { left: asStatePath('x'), operator: 'is_true' },
          effect: { id: asEffectId('e'), type: 'allow_action' }
        }
      ],
      invariants: [],
      effects: [],
      emittedEvents: [],
      transitions: []
    }
  ],
  rules: [
    {
      id: asRuleId('sr'),
      category: category as never,
      condition: { left: asStatePath('y'), operator: 'is_true' },
      effect: { id: asEffectId('se'), type: 'allow_action' }
    }
  ],
  invariants: [],
  transitions: []
});

const wrapFeature = (surface: Surface): Feature => ({
  id: asFeatureId('f'),
  name: 'F',
  surfaces: [surface],
  personas: [],
  resources: [],
  entities: [],
  createdAt: '2026-05-16T00:00:00.000Z',
  updatedAt: '2026-05-16T00:00:00.000Z'
});

describe('normalizeFeatureRuleCategories', () => {
  it('maps the singular "permission" typo to "permissions"', () => {
    const out = normalizeFeatureRuleCategories(wrapFeature(surfaceWithRule('permission')));
    expect(out.surfaces[0]!.actions[0]!.rules[0]!.category).toBe('permissions');
    expect(out.surfaces[0]!.rules[0]!.category).toBe('permissions');
  });

  it('maps legacy "ui" to canonical "ux_feedback"', () => {
    const out = normalizeFeatureRuleCategories(wrapFeature(surfaceWithRule('ui')));
    expect(out.surfaces[0]!.actions[0]!.rules[0]!.category).toBe('ux_feedback');
  });

  it('passes valid canonical categories through unchanged', () => {
    const f = wrapFeature(surfaceWithRule('business'));
    const out = normalizeFeatureRuleCategories(f);
    expect(out.surfaces[0]).toBe(f.surfaces[0]); // unchanged reference
  });

  it('leaves unknown unmapped categories untouched (validator will reject)', () => {
    const out = normalizeFeatureRuleCategories(wrapFeature(surfaceWithRule('made_up_thing')));
    expect(out.surfaces[0]!.actions[0]!.rules[0]!.category).toBe('made_up_thing');
  });

  it('is idempotent', () => {
    const first = normalizeFeatureRuleCategories(wrapFeature(surfaceWithRule('permission')));
    const second = normalizeFeatureRuleCategories(first);
    expect(second.surfaces[0]!.actions[0]!.rules[0]!.category).toBe('permissions');
  });
});
