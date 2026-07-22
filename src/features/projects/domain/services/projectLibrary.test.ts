import { describe, expect, it } from 'vitest';
import type { Entity } from '$features/behavior-model/domain/entities/Entity';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Persona } from '$features/behavior-model/domain/entities/Persona';
import {
  asEntityId,
  asFeatureId,
  asPersonaId
} from '$features/behavior-model/domain/value-objects/ids';
import type { Project } from '../entities/Project';
import { asProjectId } from '../value-objects/ids';
import {
  danglingLibraryRefs,
  linkLibraryRef,
  putLibraryEntity,
  removeFromLibrary,
  resolveLibraryRefs,
  stripLibraryRefs,
  unlinkLibraryRef
} from './projectLibrary';

const order: Entity = {
  id: asEntityId('ent-order'),
  namespace: 'order',
  description: 'A customer order.',
  fields: []
};

const buyer: Persona = {
  id: asPersonaId('per-buyer'),
  name: 'Buyer',
  description: 'A signed-in shopper.',
  stateOverrides: [],
  parameterOverrides: []
};

const emptyFeature = (over: Partial<Feature> = {}): Feature =>
  ({
    id: asFeatureId('feat-1'),
    name: 'Checkout',
    description: 'Pay for a cart.',
    surfaces: [],
    personas: [],
    resources: [],
    entities: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over
  }) as Feature;

const emptyProject = (over: Partial<Project> = {}): Project =>
  ({
    id: asProjectId('proj-1'),
    name: 'Shop',
    featureIds: [asFeatureId('feat-1')],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over
  }) as Project;

describe('resolveLibraryRefs', () => {
  it('materializes referenced definitions as if authored inline', () => {
    const resolved = resolveLibraryRefs(
      emptyFeature({ entityRefs: [asEntityId('ent-order')], personaRefs: [asPersonaId('per-buyer')] }),
      emptyProject({ entities: [order], personas: [buyer] })
    );
    expect(resolved.entities).toEqual([order]);
    expect(resolved.personas).toEqual([buyer]);
  });

  it('leaves a feature with no refs untouched (same object)', () => {
    const feature = emptyFeature();
    expect(resolveLibraryRefs(feature, emptyProject())).toBe(feature);
  });

  it('is the identity when there is no owning project', () => {
    const feature = emptyFeature({ entityRefs: [asEntityId('ent-order')] });
    expect(resolveLibraryRefs(feature, null)).toBe(feature);
  });

  it('keeps a local definition that shares an id, so migration can be gradual', () => {
    const localCopy: Entity = { ...order, description: 'The local, older copy.' };
    const resolved = resolveLibraryRefs(
      emptyFeature({ entities: [localCopy], entityRefs: [asEntityId('ent-order')] }),
      emptyProject({ entities: [order] })
    );
    expect(resolved.entities).toEqual([localCopy]);
  });

  it('does not invent anything for a dangling ref', () => {
    const resolved = resolveLibraryRefs(
      emptyFeature({ entityRefs: [asEntityId('ent-missing')] }),
      emptyProject({ entities: [order] })
    );
    expect(resolved.entities).toEqual([]);
  });
});

describe('stripLibraryRefs', () => {
  it('removes the resolved copies so the definition is stored once', () => {
    const project = emptyProject({ entities: [order] });
    const resolved = resolveLibraryRefs(
      emptyFeature({ entityRefs: [asEntityId('ent-order')] }),
      project
    );
    const { feature, project: updated } = stripLibraryRefs(resolved, project);
    expect(feature.entities).toEqual([]);
    expect(feature.entityRefs).toEqual([asEntityId('ent-order')]);
    expect(updated).toBeNull(); // library untouched, so no project write
  });

  it('round-trips: resolve → strip → resolve is stable', () => {
    const project = emptyProject({ entities: [order] });
    const stored = emptyFeature({ entityRefs: [asEntityId('ent-order')] });
    const once = resolveLibraryRefs(stored, project);
    const { feature: stripped } = stripLibraryRefs(once, project);
    expect(resolveLibraryRefs(stripped, project)).toEqual(once);
  });

  it('writes an edit made through a member feature back to the library', () => {
    const project = emptyProject({ entities: [order] });
    const resolved = resolveLibraryRefs(
      emptyFeature({ entityRefs: [asEntityId('ent-order')] }),
      project
    );
    // Simulate `update_entity` running against the resolved copy.
    const edited: Feature = {
      ...resolved,
      entities: [{ ...order, description: 'A customer order, with lines.' }]
    };
    const { feature, project: updated } = stripLibraryRefs(edited, project);
    expect(feature.entities).toEqual([]);
    expect(updated?.entities?.[0]?.description).toBe('A customer order, with lines.');
  });

  it('keeps locally-authored definitions that are not referenced', () => {
    const local: Entity = { ...order, id: asEntityId('ent-local') };
    const project = emptyProject({ entities: [order] });
    const { feature } = stripLibraryRefs(
      emptyFeature({ entities: [order, local], entityRefs: [asEntityId('ent-order')] }),
      project
    );
    expect(feature.entities).toEqual([local]);
  });
});

describe('danglingLibraryRefs', () => {
  it('reports a ref the library cannot satisfy', () => {
    expect(
      danglingLibraryRefs(
        emptyFeature({ entityRefs: [asEntityId('ent-missing')] }),
        emptyProject({ entities: [order] })
      )
    ).toEqual([{ kind: 'entity', id: 'ent-missing' }]);
  });

  it('reports every ref when the feature belongs to no project', () => {
    expect(
      danglingLibraryRefs(emptyFeature({ entityRefs: [asEntityId('ent-order')] }), null)
    ).toEqual([{ kind: 'entity', id: 'ent-order' }]);
  });

  it('is silent for a feature with no refs', () => {
    expect(danglingLibraryRefs(emptyFeature(), emptyProject())).toEqual([]);
  });
});

describe('library transforms', () => {
  it('upserts by id instead of appending duplicates', () => {
    const once = putLibraryEntity(emptyProject(), order);
    const twice = putLibraryEntity(once, { ...order, description: 'Changed.' });
    expect(twice.entities).toHaveLength(1);
    expect(twice.entities?.[0]?.description).toBe('Changed.');
  });

  it('leaves member refs alone when a definition is removed, so the break is loud', () => {
    const project = removeFromLibrary(emptyProject({ entities: [order] }), 'entity', 'ent-order');
    expect(project.entities).toEqual([]);
    const feature = emptyFeature({ entityRefs: [asEntityId('ent-order')] });
    expect(danglingLibraryRefs(feature, project)).toEqual([{ kind: 'entity', id: 'ent-order' }]);
  });

  it('links idempotently', () => {
    const once = linkLibraryRef(emptyFeature(), 'entity', 'ent-order');
    expect(linkLibraryRef(once, 'entity', 'ent-order').entityRefs).toEqual(['ent-order']);
  });

  it('unlinks the ref AND the resolved copy, so it does not become an inline copy', () => {
    const project = emptyProject({ entities: [order] });
    const resolved = resolveLibraryRefs(
      emptyFeature({ entityRefs: [asEntityId('ent-order')] }),
      project
    );
    const unlinked = unlinkLibraryRef(resolved, 'entity', 'ent-order');
    expect(unlinked.entityRefs).toEqual([]);
    expect(unlinked.entities).toEqual([]);
  });
});
