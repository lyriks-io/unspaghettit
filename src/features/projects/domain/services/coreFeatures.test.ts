import { describe, expect, it } from 'vitest';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import { asFeatureId } from '$features/behavior-model/domain/value-objects/ids';
import type { Project } from '$features/projects/domain/entities/Project';
import { asProjectId } from '$features/projects/domain/value-objects/ids';
import type { Tag } from '$shared/domain/Tags';
import { coreValueOf, coreValuesOf, setCoreTag } from '$shared/domain/coreFeatureTag';
import {
  coreFeatureReport,
  declareCoreFeature,
  isDeclaredCoreFeature,
  removeCoreFeature,
  updateCoreFeature
} from './coreFeatures';

// The report + transforms only read a handful of fields; minimal casts keep the
// tests focused on core-feature behavior rather than full entity construction.
const feature = (id: string, name: string, tags?: readonly Tag[]): Feature =>
  ({ id: asFeatureId(id), name, tags }) as unknown as Feature;

const project = (over: Partial<Project> = {}): Project =>
  ({
    id: asProjectId('p'),
    name: 'P',
    description: 'proj',
    featureIds: [],
    createdAt: 'x',
    updatedAt: 'x',
    ...over
  }) as Project;

describe('core-feature tag helpers', () => {
  it('reads the core value(s) from a tag set, ignoring other types', () => {
    const tags: Tag[] = [
      { type: 'core', value: 'auth' },
      { type: 'domain', value: 'tech' }
    ];
    expect(coreValueOf(tags)).toBe('auth');
    expect(coreValuesOf(tags)).toEqual(['auth']);
    expect(coreValueOf(undefined)).toBeUndefined();
  });

  it('setCoreTag enforces at most one core tag and preserves other tags', () => {
    const start: Tag[] = [
      { type: 'core', value: 'auth' },
      { type: 'domain', value: 'tech' }
    ];
    const next = setCoreTag(start, 'billing');
    expect(coreValuesOf(next)).toEqual(['billing']);
    expect(next?.some((t) => t.type === 'domain' && t.value === 'tech')).toBe(true);
  });

  it('setCoreTag clears membership with null and normalizes the value otherwise', () => {
    const start: Tag[] = [
      { type: 'core', value: 'auth' },
      { type: 'domain', value: 'tech' }
    ];
    expect(coreValuesOf(setCoreTag(start, null))).toEqual([]);
    expect(coreValueOf(setCoreTag(undefined, 'Auth'))).toBe('auth');
  });
});

describe('core-feature registry transforms', () => {
  it('declares and upserts a core feature, normalizing the value', () => {
    const p = declareCoreFeature(project(), { value: 'Auth', description: 'sign-in' });
    expect(p.coreFeatures).toEqual([{ value: 'auth', description: 'sign-in' }]);
    const p2 = declareCoreFeature(p, { value: 'auth', description: 'sign-in and sessions' });
    expect(p2.coreFeatures).toEqual([{ value: 'auth', description: 'sign-in and sessions' }]);
  });

  it('updates a description and no-ops on an unknown value', () => {
    const p = declareCoreFeature(project(), { value: 'auth', description: 'a' });
    expect(updateCoreFeature(p, 'auth', { description: 'b' }).coreFeatures).toEqual([
      { value: 'auth', description: 'b' }
    ]);
    expect(updateCoreFeature(p, 'ghost', { description: 'b' }).coreFeatures).toEqual([
      { value: 'auth', description: 'a' }
    ]);
  });

  it('removes a core feature (declared lookup is case-insensitive)', () => {
    const p = declareCoreFeature(project(), { value: 'auth', description: 'a' });
    expect(isDeclaredCoreFeature(p, 'AUTH')).toBe(true);
    const removed = removeCoreFeature(p, 'auth');
    expect(removed.coreFeatures).toEqual([]);
    expect(isDeclaredCoreFeature(removed, 'auth')).toBe(false);
  });
});

describe('coreFeatureReport', () => {
  const base = declareCoreFeature(
    declareCoreFeature(project(), { value: 'auth', description: 'sign-in' }),
    { value: 'billing', description: 'payments' }
  );

  it('groups members, lists uncategorized, and keeps empty declared groups', () => {
    const report = coreFeatureReport(base, [
      feature('f1', 'Login', [{ type: 'core', value: 'auth' }]),
      feature('f2', 'Sessions', [{ type: 'core', value: 'auth' }]),
      feature('f3', 'Notes', undefined)
    ]);
    expect(report.groups.find((g) => g.value === 'auth')?.features.map((f) => f.name)).toEqual([
      'Login',
      'Sessions'
    ]);
    expect(report.groups.find((g) => g.value === 'billing')?.features).toEqual([]);
    expect(report.uncategorized.map((f) => f.name)).toEqual(['Notes']);
    expect(report.warnings).toEqual([]);
  });

  it('soft-warns on an undeclared core value and groups it nowhere', () => {
    const report = coreFeatureReport(base, [
      feature('f1', 'Reports', [{ type: 'core', value: 'reporting' }])
    ]);
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]?.kind).toBe('undeclared');
    expect(report.groups.every((g) => g.features.length === 0)).toBe(true);
  });

  it('soft-warns when a feature belongs to more than one core feature', () => {
    const report = coreFeatureReport(base, [
      feature('f1', 'Spanning', [
        { type: 'core', value: 'auth' },
        { type: 'core', value: 'billing' }
      ])
    ]);
    expect(report.warnings.find((w) => w.kind === 'multiple')).toBeDefined();
    expect(report.groups.find((g) => g.value === 'auth')?.features).toHaveLength(1);
    expect(report.groups.find((g) => g.value === 'billing')?.features).toHaveLength(1);
  });
});
