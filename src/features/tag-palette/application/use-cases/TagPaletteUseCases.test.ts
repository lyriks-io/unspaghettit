import { describe, expect, it } from 'vitest';
import { fixedClock } from '$shared/domain/Clock';
import type { Tag } from '$shared/domain/Tags';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import { asFeatureId } from '$features/behavior-model/domain/value-objects/ids';
import { InMemoryFeatureRepository } from '$features/behavior-model/infrastructure/persistence/InMemoryFeatureRepository';
import type { Project } from '$features/projects/domain/entities/Project';
import { asProjectId } from '$features/projects/domain/value-objects/ids';
import { InMemoryProjectRepository } from '$features/projects/infrastructure/persistence/InMemoryProjectRepository';
import type { TagPalette } from '$shared/domain/TagPalette';
import { InMemoryTagPaletteRepository } from '../../infrastructure/persistence/InMemoryTagPaletteRepository';
import type { TagPaletteRepository } from '../ports/TagPaletteRepository';
import { renameTagUseCase } from './RenameTag';
import { setTagTypeColorUseCase } from './SetTagTypeColor';

const BEFORE = '2026-01-01T00:00:00.000Z';
const NOW = '2026-06-01T00:00:00.000Z';
const tag = (type: string, value: string): Tag => ({ type, value });

const project = (id: string, tags?: readonly Tag[]): Project => ({
  id: asProjectId(id),
  name: id,
  description: id,
  featureIds: [],
  ...(tags ? { tags } : {}),
  createdAt: BEFORE,
  updatedAt: BEFORE
});
const feature = (id: string, tags?: readonly Tag[]): Feature => ({
  id: asFeatureId(id),
  name: id,
  surfaces: [],
  personas: [],
  resources: [],
  entities: [],
  ...(tags ? { tags } : {}),
  createdAt: BEFORE,
  updatedAt: BEFORE
});

const world = async () => {
  const projects = new InMemoryProjectRepository();
  const features = new InMemoryFeatureRepository();
  const palette = new InMemoryTagPaletteRepository({ assignments: { team: '#3b82f6' } });
  await projects.save(project('p-growth', [tag('team', 'Growth'), tag('phase', 'beta')]));
  await projects.save(project('p-other', [tag('team', 'Core')]));
  await projects.save(project('p-bare'));
  await features.save(feature('f-growth', [tag('Team', 'growth')]));
  await features.save(feature('f-other', [tag('phase', 'growth')]));
  const rename = renameTagUseCase({ projects, features, palette, clock: fixedClock(NOW) });
  return { projects, features, palette, rename };
};

describe('renameTagUseCase', () => {
  it('rewrites the tag on every project and feature that carries it, whatever its case, and only those', async () => {
    const { projects, features, rename } = await world();
    const result = await rename({ from: tag('team', 'growth'), to: tag('squad', 'Acquisition') });
    expect(result).toMatchObject({ projectsUpdated: 1, featuresUpdated: 1 });

    const growth = await projects.get(asProjectId('p-growth'));
    expect(growth?.tags).toEqual([tag('squad', 'Acquisition'), tag('phase', 'beta')]);
    expect(growth?.updatedAt).toBe(NOW);
    expect((await features.get(asFeatureId('f-growth')))?.tags).toEqual([tag('squad', 'Acquisition')]);
    // Untouched elements are not written again.
    expect((await projects.get(asProjectId('p-other')))?.updatedAt).toBe(BEFORE);
    expect((await features.get(asFeatureId('f-other')))?.tags).toEqual([tag('phase', 'growth')]);
    expect((await features.get(asFeatureId('f-other')))?.updatedAt).toBe(BEFORE);
  });

  it('carries the old type\'s color to the new type', async () => {
    const { palette, rename } = await world();
    const result = await rename({ from: tag('team', 'growth'), to: tag('squad', 'growth') });
    expect(result.colorReassigned).toBe(true);
    expect((await palette.get()).assignments).toEqual({ squad: '#3b82f6' });
  });

  it('leaves the palette alone when the type keeps its name or had no color', async () => {
    const { palette, rename } = await world();
    expect((await rename({ from: tag('team', 'growth'), to: tag('team', 'acquisition') })).colorReassigned).toBe(false);
    expect((await rename({ from: tag('phase', 'beta'), to: tag('stage', 'beta') })).colorReassigned).toBe(false);
    expect((await palette.get()).assignments).toEqual({ team: '#3b82f6' });
  });

  it('does nothing when the two tags are the same tag', async () => {
    const { projects, rename } = await world();
    expect(await rename({ from: tag('team', 'growth'), to: tag(' Team', 'GROWTH ') })).toEqual({
      projectsUpdated: 0,
      featuresUpdated: 0,
      colorReassigned: false
    });
    expect((await projects.get(asProjectId('p-growth')))?.updatedAt).toBe(BEFORE);
  });
});

describe('setTagTypeColorUseCase', () => {
  it('sets a type\'s color, lowercased, under the type\'s normalized name', async () => {
    const repository = new InMemoryTagPaletteRepository();
    const next = await setTagTypeColorUseCase({ repository })({ type: ' Team ', color: '#3B82F6' });
    expect(next.assignments).toEqual({ team: '#3b82f6' });
    expect(await repository.get()).toEqual(next);
  });

  it('clears a type to "no color", which is kept apart from never having had one', async () => {
    const repository = new InMemoryTagPaletteRepository({ assignments: { team: '#3b82f6' } });
    await setTagTypeColorUseCase({ repository })({ type: 'team', color: null });
    expect((await repository.get()).assignments).toEqual({ team: null });
  });

  it('refuses a color that is not a 6-digit hex and saves nothing', async () => {
    const before = { assignments: { team: '#3b82f6' } };
    const repository = new InMemoryTagPaletteRepository(before);
    for (const color of ['blue', '#fff', '#3b82f6ff', '3b82f6']) {
      await expect(setTagTypeColorUseCase({ repository })({ type: 'team', color })).rejects.toThrow(
        'Expected a 6-digit hex'
      );
    }
    expect(await repository.get()).toBe(before);
  });

  it('does not save a palette that would not change', async () => {
    const before: TagPalette = { assignments: { team: '#3b82f6' } };
    const saves: TagPalette[] = [];
    const counting = {
      get: async () => before,
      save: async (palette: TagPalette) => void saves.push(palette)
    } satisfies TagPaletteRepository;
    expect(await setTagTypeColorUseCase({ repository: counting })({ type: 'TEAM', color: '#3B82F6' })).toBe(before);
    expect(saves).toEqual([]);
  });
});
