import { describe, expect, it } from 'vitest';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import { asFeatureId } from '$features/behavior-model/domain/value-objects/ids';
import { runScenariosUseCase } from '$features/simulator/application/use-cases/RunScenarios';
import { applyBlueprints, expandWithSiblings } from '../domain/services/BlueprintApplier';
import { inMemoryBlueprintRepository } from './InMemoryBlueprintRepository';

let counter = 0;
const ids = () => `lib-${counter++}`;

const emptyFeature = (): Feature => ({
  id: asFeatureId('library-test'),
  name: 'Library',
  surfaces: [],
  personas: [],
  resources: [],
  entities: [],
  createdAt: '2026-05-09T00:00:00.000Z',
  updatedAt: '2026-05-09T00:00:00.000Z'
});

/** Every surface a transition or a transition_surface effect of the feature points to. */
const surfaceTargets = (feature: Feature): readonly string[] =>
  feature.surfaces.flatMap((surface) => [
    ...surface.transitions.map((t) => String(t.target)),
    ...surface.actions.flatMap((action) => [
      ...action.transitions.map((t) => String(t.target)),
      ...[...action.effects, ...(action.onBlockedEffects ?? []), ...action.rules.map((r) => r.effect)].flatMap((e) =>
        e.type === 'transition_surface' ? [String(e.target)] : []
      )
    ])
  ]);

const blueprints = inMemoryBlueprintRepository.list();

describe('the blueprint library', () => {
  it('finds every blueprint by its own id, each id used once', () => {
    const seen = blueprints.map((b) => String(b.id));
    expect(new Set(seen).size).toBe(seen.length);
    for (const blueprint of blueprints) {
      expect(inMemoryBlueprintRepository.findById(blueprint.id)).toBe(blueprint);
    }
  });

  it('names only siblings that exist in the library', () => {
    const missing = blueprints.flatMap((b) =>
      (b.siblings ?? []).filter((id) => !inMemoryBlueprintRepository.findById(id)).map((id) => `${b.id} -> ${id}`)
    );
    expect(missing).toEqual([]);
  });

  // The shipped scenarios carry no expected status: what they can prove is that
  // they still resolve against the surface they ship with and break nothing it keeps.
  describe('every scenario a blueprint ships runs on it alone and keeps its invariants', () => {
    for (const blueprint of blueprints) {
      it(`${blueprint.name} (${blueprint.id})`, () => {
        counter = 0;
        const { feature } = applyBlueprints(emptyFeature(), [blueprint], ids);
        const run = runScenariosUseCase()({ feature });
        const failed = run.results.filter((r) => !r.pass).map((r) => `${r.scenarioName}: ${r.summary}`);
        expect(failed).toEqual([]);
        const broken = run.results.flatMap((r) => r.invariantViolations.map((v) => `${r.scenarioName}: ${v.invariantName}`));
        expect(broken).toEqual([]);
      });
    }
  });

  it('points no transition at a surface the feature lacks, applied alone or with its siblings', () => {
    const dangling: string[] = [];
    for (const blueprint of blueprints) {
      for (const set of [[blueprint], expandWithSiblings([blueprint], inMemoryBlueprintRepository.findById)]) {
        counter = 0;
        const { feature } = applyBlueprints(emptyFeature(), set, ids);
        const surfaces = new Set(feature.surfaces.map((s) => String(s.id)));
        for (const target of surfaceTargets(feature)) {
          if (!surfaces.has(target)) dangling.push(`${blueprint.id} (${set.length} applied) -> ${target}`);
        }
      }
    }
    expect(dangling).toEqual([]);
  });

  it('adds one surface per blueprint and links siblings applied together', () => {
    const linked = blueprints.find((b) => (b.siblings ?? []).length > 0)!;
    const set = expandWithSiblings([linked], inMemoryBlueprintRepository.findById);
    counter = 0;
    const { feature, addedSurfaceIds } = applyBlueprints(emptyFeature(), set, ids);
    expect(addedSurfaceIds).toHaveLength(set.length);
    expect(feature.surfaces.map((s) => s.id)).toEqual(addedSurfaceIds);
    const own = new Set(addedSurfaceIds.map(String));
    const first = feature.surfaces[0]!;
    // The first blueprint reaches at least one of the surfaces its siblings added.
    expect(surfaceTargets({ ...feature, surfaces: [first] }).some((t) => t !== String(first.id) && own.has(t))).toBe(true);
  });
});
