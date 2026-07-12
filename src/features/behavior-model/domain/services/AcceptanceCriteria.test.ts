import { describe, expect, it } from 'vitest';
import type { AcceptanceCriterion } from '$features/behavior-model/domain/entities/AcceptanceCriterion';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import {
  asAcceptanceCriterionId,
  asFeatureId,
  asSurfaceId
} from '$features/behavior-model/domain/value-objects/ids';
import {
  exportFeatureToJson,
  importFeatureFromJson
} from '$features/behavior-model/infrastructure/io/FeatureJson';
import { storefrontFeature } from '$features/behavior-model/infrastructure/seed/seedStorefront';
import { scoreFeature } from '$features/maturity/domain/MaturityScorer';
import {
  addAcceptanceCriterion,
  removeAcceptanceCriterion,
  updateAcceptanceCriterion
} from './FeatureTransforms';
import { validateFeature } from './FeatureValidator';

const criterion = (over: Partial<AcceptanceCriterion> = {}): AcceptanceCriterion => ({
  id: asAcceptanceCriterionId('ac1'),
  title: 'Refund within the return window',
  given: 'an order delivered 20 days ago',
  when: 'the customer requests a refund',
  then: 'the refund is approved',
  expectedOutcome: 'success',
  ...over
});

// Minimal, description-light feature (same shape the FeatureJson round-trip
// test uses) for persistence + transform tests that don't run the validator.
const base: Feature = {
  id: asFeatureId('f'),
  name: 'Sample',
  description: 'Hello',
  surfaces: [
    {
      id: asSurfaceId('s'),
      name: 'Surface',
      type: 'screen',
      stateDefinitions: [],
      actions: [],
      rules: [],
      invariants: [],
      transitions: []
    }
  ],
  personas: [],
  resources: [],
  entities: [],
  createdAt: '2026-07-12T00:00:00.000Z',
  updatedAt: '2026-07-12T00:00:00.000Z'
};

describe('acceptance criteria — persistence round-trip', () => {
  it('preserves two criteria byte-for-byte through export → import', () => {
    const withCriteria: Feature = {
      ...base,
      acceptanceCriteria: [
        criterion(),
        criterion({
          id: asAcceptanceCriterionId('ac2'),
          title: 'Blocked once the window has elapsed',
          expectedOutcome: 'blocked',
          // A platform writer may point this at a surface on a sibling feature;
          // it must survive persistence even though it resolves nowhere here.
          relatedSurfaceId: 'srf-journey-1',
          description: 'the elapsed-window edge case'
        })
      ]
    };
    const back = importFeatureFromJson(exportFeatureToJson(withCriteria));
    expect(back.acceptanceCriteria).toEqual(withCriteria.acceptanceCriteria);
    expect(back).toEqual(withCriteria);
  });

  it('loads a feature with no acceptanceCriteria key unchanged (treated as absent)', () => {
    const back = importFeatureFromJson(exportFeatureToJson(base));
    expect(back.acceptanceCriteria).toBeUndefined();
    expect(back).toEqual(base);
  });
});

describe('acceptance criteria — transforms', () => {
  it('adds a criterion without mutating the source feature', () => {
    const c = criterion();
    const added = addAcceptanceCriterion(base, c);
    expect(added.acceptanceCriteria).toEqual([c]);
    expect(base.acceptanceCriteria).toBeUndefined();
  });

  it('updates immutably, preserving id and leaving the prior value untouched', () => {
    const c = criterion();
    const added = addAcceptanceCriterion(base, c);
    const updated = updateAcceptanceCriterion(added, c.id, {
      then: 'the refund is declined',
      expectedOutcome: 'failure'
    });
    expect(updated.acceptanceCriteria?.[0]).toEqual({
      ...c,
      then: 'the refund is declined',
      expectedOutcome: 'failure'
    });
    expect(updated.acceptanceCriteria?.[0]?.id).toBe(c.id);
    expect(added.acceptanceCriteria?.[0]?.then).toBe('the refund is approved');
  });

  it('removes a criterion by id', () => {
    const c = criterion();
    const added = addAcceptanceCriterion(base, c);
    expect(removeAcceptanceCriterion(added, c.id).acceptanceCriteria).toEqual([]);
  });
});

describe('acceptance criteria — validation is lenient (prose, not assertions)', () => {
  // Build on a known-valid seed so only the criteria under test can flip validity.
  const withAC = (acs: readonly AcceptanceCriterion[]): Feature => ({
    ...storefrontFeature,
    acceptanceCriteria: acs
  });

  it('passes the seed feature untouched', () => {
    expect(validateFeature(storefrontFeature).valid).toBe(true);
  });

  it('accepts empty given/when/then (they are optional prose)', () => {
    expect(validateFeature(withAC([criterion({ given: '', when: '', then: '' })])).valid).toBe(true);
  });

  it('accepts a dangling relatedSurfaceId without a hard error', () => {
    expect(
      validateFeature(withAC([criterion({ relatedSurfaceId: 'srf-does-not-exist' })])).valid
    ).toBe(true);
  });

  it('rejects a duplicate criterion id', () => {
    const res = validateFeature(withAC([criterion(), criterion({ title: 'Another one' })]));
    expect(res.valid).toBe(false);
    expect(res.valid ? [] : res.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('Duplicate acceptance criterion id')])
    );
  });

  it('rejects an empty (whitespace-only) title', () => {
    const res = validateFeature(withAC([criterion({ title: '   ' })]));
    expect(res.valid).toBe(false);
    expect(res.valid ? [] : res.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('is missing a title')])
    );
  });

  it('never throws on a missing / malformed array', () => {
    expect(() => validateFeature(storefrontFeature)).not.toThrow();
    expect(() =>
      validateFeature({ ...storefrontFeature, acceptanceCriteria: undefined as never })
    ).not.toThrow();
  });
});

describe('acceptance criteria — score isolation (documentation must not move maturity)', () => {
  it('leaves the maturity verdict identical with vs. without criteria', () => {
    const before = scoreFeature(storefrontFeature);
    const after = scoreFeature({
      ...storefrontFeature,
      acceptanceCriteria: [
        criterion(),
        criterion({ id: asAcceptanceCriterionId('ac2'), title: 'A second criterion' })
      ]
    });
    expect(after.score).toBe(before.score);
    expect(after.maxScore).toBe(before.maxScore);
    expect(after.percentage).toBe(before.percentage);
  });
});
