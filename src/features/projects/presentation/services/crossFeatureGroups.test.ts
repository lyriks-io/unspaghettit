import { describe, expect, it } from 'vitest';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { FeatureId, ResourceId } from '$features/behavior-model/domain/value-objects/ids';
import { groupResources } from './crossFeatureGroups';

const makeFeature = (
  id: string,
  name: string,
  resources: Array<{
    id: string;
    name: string;
    kind: string;
    provider: string;
    description?: string;
  }>
): Feature => ({
  id: id as unknown as FeatureId,
  name,
  description: '',
  surfaces: [],
  personas: [],
  resources: resources.map((r) => ({
    id: r.id as unknown as ResourceId,
    name: r.name,
    kind: r.kind as never,
    provider: r.provider,
    description: r.description,
    scope: 'cloud' as never,
    sensitivity: 'confidential' as never,
    containsPii: false,
    complianceTags: [],
    accessMode: 'read_write' as never
  })),
  entities: [],
  events: [],
  tags: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
});

describe('groupResources', () => {
  it('collapses identical resources from multiple features into one row', () => {
    const features = [
      makeFeature('feat-1', 'Onboarding & AI Chat', [
        { id: 'r-1', name: 'TwinStore', kind: 'document_db', provider: 'firestore', description: 'first description' }
      ]),
      makeFeature('feat-2', 'Daily Check-in', [
        { id: 'r-2', name: 'TwinStore', kind: 'document_db', provider: 'firestore', description: 'second description' }
      ]),
      makeFeature('feat-3', 'Weekly Reflection', [
        { id: 'r-3', name: 'TwinStore', kind: 'document_db', provider: 'firestore' }
      ])
    ];

    const grouped = groupResources(features);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]!.name).toBe('TwinStore');
    expect(grouped[0]!.sources.map((s) => s.featureName)).toEqual([
      'Onboarding & AI Chat',
      'Daily Check-in',
      'Weekly Reflection'
    ]);
  });

  it('keeps distinct rows when kind or provider differs', () => {
    const features = [
      makeFeature('feat-1', 'A', [
        { id: 'r-1', name: 'TwinStore', kind: 'document_db', provider: 'firestore' }
      ]),
      makeFeature('feat-2', 'B', [
        { id: 'r-2', name: 'TwinStore', kind: 'relational_db', provider: 'postgres' }
      ])
    ];
    expect(groupResources(features)).toHaveLength(2);
  });
});
