import { describe, expect, it } from 'vitest';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import { locateActionPart } from './ActionPartLocation';

const feature = {
  surfaces: [
    {
      id: 'srf-search',
      actions: [{ id: 'act-search', parameters: [{ id: 'prm-site' }], scenarios: [] }]
    },
    {
      id: 'srf-book',
      actions: [
        { id: 'act-book', parameters: [], scenarios: [{ id: 'scn-free' }] },
        { id: 'act-cancel', parameters: [{ id: 'prm-reason' }] }
      ]
    }
  ]
} as unknown as Feature;

describe('locateActionPart', () => {
  it('finds the action that holds a scenario', () => {
    expect(locateActionPart(feature, 'scenario', 'scn-free')).toEqual({
      surfaceId: 'srf-book',
      actionId: 'act-book'
    });
  });

  it('finds the action that holds a parameter, on any surface', () => {
    expect(locateActionPart(feature, 'parameter', 'prm-site')).toEqual({
      surfaceId: 'srf-search',
      actionId: 'act-search'
    });
    expect(locateActionPart(feature, 'parameter', 'prm-reason')).toEqual({
      surfaceId: 'srf-book',
      actionId: 'act-cancel'
    });
  });

  it('answers null for an id no action holds', () => {
    expect(locateActionPart(feature, 'scenario', 'scn-gone')).toBeNull();
    expect(locateActionPart(feature, 'parameter', 'scn-free')).toBeNull();
  });
});
