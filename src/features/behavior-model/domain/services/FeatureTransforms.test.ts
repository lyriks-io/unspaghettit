import { describe, expect, it } from 'vitest';
import type { Action } from '../entities/Action';
import type { Feature } from '../entities/Feature';
import type { Parameter } from '../entities/Parameter';
import type { StateDefinition } from '../entities/StateDefinition';
import type { Surface } from '../entities/Surface';
import {
  asActionId,
  asFeatureId,
  asParameterId,
  asStateDefinitionId,
  asSurfaceId
} from '../value-objects/ids';
import { asStatePath } from '../value-objects/StatePath';
import {
  addAction,
  addSurface,
  clearActionEvolution,
  dismissActionEvolution,
  removeActionAnywhere,
  canMoveSurfaceDown,
  canMoveSurfaceUp,
  moveActionBy,
  moveParameterBy,
  moveStateDefinitionBy,
  moveSurfaceBy,
  moveSurfaceTo,
  removeSurface,
  renameSurface,
  setSurfaceParent,
  surfaceDepth,
  updateParameter,
  updateStateDefinition
} from './FeatureTransforms';

const baseCapability: Action = {
  id: asActionId('cap'),
  name: 'Cap',
  intent: '',
  parameters: [],
  requiredStates: [],
  rules: [],
  invariants: [],
  effects: [],
  emittedEvents: [],
  transitions: []
};

const baseSurface: Surface = {
  id: asSurfaceId('surf'),
  name: 'Surf',
  type: 'screen',
  stateDefinitions: [],
  actions: [],
  rules: [],
  invariants: [],
  transitions: []
};

const baseFeature: Feature = {
  id: asFeatureId('exp'),
  name: 'Exp',
  surfaces: [baseSurface],
  personas: [],
  resources: [],
  entities: [],
  createdAt: '2026-05-08T00:00:00.000Z',
  updatedAt: '2026-05-08T00:00:00.000Z'
};

const boundParam: Parameter = {
  id: asParameterId('p1'),
  name: 'choice',
  type: 'string',
  required: true,
  bindToStatePath: asStatePath('user.choice')
};

const boundStateDef: StateDefinition = {
  id: asStateDefinitionId('sd1'),
  path: asStatePath('user.choice'),
  type: 'string',
  defaultValue: ''
};

const surfaceWithBoundParam: Surface = {
  ...baseSurface,
  stateDefinitions: [boundStateDef],
  actions: [{ ...baseCapability, parameters: [boundParam] }]
};

const featureWithBoundParam: Feature = {
  ...baseFeature,
  surfaces: [surfaceWithBoundParam]
};

describe('FeatureTransforms', () => {
  it('adds a surface immutably', () => {
    const newSurface: Surface = { ...baseSurface, id: asSurfaceId('surf2'), name: 'Other' };
    const next = addSurface(baseFeature, newSurface);
    expect(next.surfaces).toHaveLength(2);
    expect(baseFeature.surfaces).toHaveLength(1);
  });

  it('removes a surface by id', () => {
    const next = removeSurface(baseFeature, baseSurface.id);
    expect(next.surfaces).toHaveLength(0);
  });

  it('renames a surface', () => {
    const next = renameSurface(baseFeature, baseSurface.id, { name: 'Renamed' });
    expect(next.surfaces[0]?.name).toBe('Renamed');
    expect(baseFeature.surfaces[0]?.name).toBe('Surf');
  });

  it('adds an action to a surface', () => {
    const next = addAction(baseFeature, baseSurface.id, baseCapability);
    expect(next.surfaces[0]?.actions).toHaveLength(1);
  });

  describe('moveSurfaceBy', () => {
    const a: Surface = { ...baseSurface, id: asSurfaceId('a'), name: 'A' };
    const b: Surface = { ...baseSurface, id: asSurfaceId('b'), name: 'B' };
    const c: Surface = { ...baseSurface, id: asSurfaceId('c'), name: 'C' };
    const exp: Feature = { ...baseFeature, surfaces: [a, b, c] };

    it('swaps a surface with its successor when moving down', () => {
      const next = moveSurfaceBy(exp, b.id, 1);
      expect(next.surfaces.map((s) => s.name)).toEqual(['A', 'C', 'B']);
    });

    it('swaps a surface with its predecessor when moving up', () => {
      const next = moveSurfaceBy(exp, b.id, -1);
      expect(next.surfaces.map((s) => s.name)).toEqual(['B', 'A', 'C']);
    });

    it('is a no-op at the edges', () => {
      expect(moveSurfaceBy(exp, a.id, -1).surfaces).toEqual(exp.surfaces);
      expect(moveSurfaceBy(exp, c.id, 1).surfaces).toEqual(exp.surfaces);
    });

    it('moves a parent together with its descendants', () => {
      // Tree:
      //   A (root)
      //   B (root)  ─ child  C  ─ grandchild  D
      //   E (root)
      const aR: Surface = { ...baseSurface, id: asSurfaceId('A'), name: 'A' };
      const bR: Surface = { ...baseSurface, id: asSurfaceId('B'), name: 'B' };
      const cR: Surface = { ...baseSurface, id: asSurfaceId('C'), name: 'C' };
      const dR: Surface = { ...baseSurface, id: asSurfaceId('D'), name: 'D' };
      const eR: Surface = { ...baseSurface, id: asSurfaceId('E'), name: 'E' };
      let exp2: Feature = { ...baseFeature, surfaces: [aR, bR, cR, dR, eR] };
      // C is child of B; D is child of C.
      exp2 = setSurfaceParent(exp2, cR.id, bR.id);
      exp2 = setSurfaceParent(exp2, dR.id, cR.id);

      // Moving B down should swap [B, C, D] with [E].
      const next = moveSurfaceBy(exp2, bR.id, 1);
      expect(next.surfaces.map((s) => s.name)).toEqual(['A', 'E', 'B', 'C', 'D']);
    });

    it('refuses to move past a parent boundary', () => {
      const root: Surface = { ...baseSurface, id: asSurfaceId('R'), name: 'R' };
      const child: Surface = { ...baseSurface, id: asSurfaceId('Ch'), name: 'Ch' };
      const sibling: Surface = { ...baseSurface, id: asSurfaceId('S'), name: 'S' };
      let exp2: Feature = {
        ...baseFeature,
        surfaces: [root, child, sibling]
      };
      exp2 = setSurfaceParent(exp2, child.id, root.id);

      // Child cannot move up past root (would change parents).
      const next = moveSurfaceBy(exp2, child.id, -1);
      expect(next.surfaces.map((s) => s.name)).toEqual(['R', 'Ch', 'S']);
      expect(canMoveSurfaceUp(exp2.surfaces, child.id)).toBe(false);

      // Child cannot move down past S (sibling of root, different parent).
      const next2 = moveSurfaceBy(exp2, child.id, 1);
      expect(next2.surfaces.map((s) => s.name)).toEqual(['R', 'Ch', 'S']);
      expect(canMoveSurfaceDown(exp2.surfaces, child.id)).toBe(false);
    });

    it('canMoveSurfaceUp / canMoveSurfaceDown reflect sibling availability', () => {
      const aR: Surface = { ...baseSurface, id: asSurfaceId('A'), name: 'A' };
      const bR: Surface = { ...baseSurface, id: asSurfaceId('B'), name: 'B' };
      const cR: Surface = { ...baseSurface, id: asSurfaceId('C'), name: 'C' };
      const exp2: Feature = { ...baseFeature, surfaces: [aR, bR, cR] };
      expect(canMoveSurfaceUp(exp2.surfaces, aR.id)).toBe(false);
      expect(canMoveSurfaceUp(exp2.surfaces, bR.id)).toBe(true);
      expect(canMoveSurfaceDown(exp2.surfaces, bR.id)).toBe(true);
      expect(canMoveSurfaceDown(exp2.surfaces, cR.id)).toBe(false);
    });
  });

  describe('moveSurfaceTo (drag-and-drop)', () => {
    const a: Surface = { ...baseSurface, id: asSurfaceId('A'), name: 'A' };
    const b: Surface = { ...baseSurface, id: asSurfaceId('B'), name: 'B' };
    const c: Surface = { ...baseSurface, id: asSurfaceId('C'), name: 'C' };
    const baseExp: Feature = { ...baseFeature, surfaces: [a, b, c] };

    it('drops a surface BEFORE another and shares the target parent', () => {
      let exp = setSurfaceParent(baseExp, b.id, a.id); // B is child of A
      exp = moveSurfaceTo(exp, c.id, { kind: 'before', targetId: b.id });
      expect(exp.surfaces.map((s) => s.name)).toEqual(['A', 'C', 'B']);
      // C inherits B's parent (A).
      expect(exp.surfaces.find((s) => s.id === c.id)?.parentSurfaceId).toBe(a.id);
    });

    it('drops a surface AFTER another, past the target subtree', () => {
      let exp = setSurfaceParent(baseExp, b.id, a.id); // B is child of A
      // Layout: [A, B(child A), C]
      // Drop C 'after' A → should land after A's whole subtree (including B).
      exp = moveSurfaceTo(exp, c.id, { kind: 'after', targetId: a.id });
      expect(exp.surfaces.map((s) => s.name)).toEqual(['A', 'B', 'C']);
      expect(exp.surfaces.find((s) => s.id === c.id)?.parentSurfaceId).toBeUndefined();
    });

    it('drops a surface INSIDE another (becomes last child)', () => {
      const exp = moveSurfaceTo(baseExp, c.id, { kind: 'inside', targetId: a.id });
      expect(exp.surfaces.map((s) => s.name)).toEqual(['A', 'C', 'B']);
      expect(exp.surfaces.find((s) => s.id === c.id)?.parentSurfaceId).toBe(a.id);
    });

    it('rejects dropping onto own descendant', () => {
      let exp = setSurfaceParent(baseExp, b.id, a.id);
      exp = setSurfaceParent(exp, c.id, b.id);
      // Try to drop A inside C (C is A's grandchild). Would be a cycle.
      const next = moveSurfaceTo(exp, a.id, { kind: 'inside', targetId: c.id });
      expect(next.surfaces.map((s) => s.name)).toEqual(exp.surfaces.map((s) => s.name));
    });

    it('rejects dropping onto self', () => {
      const next = moveSurfaceTo(baseExp, a.id, { kind: 'inside', targetId: a.id });
      expect(next).toBe(baseExp);
    });

    it('moves a parent + descendants together', () => {
      let exp = setSurfaceParent(baseExp, b.id, a.id); // B child of A
      // Layout: [A, B(child A), C]; drop A 'after' C. A's subtree should move.
      exp = moveSurfaceTo(exp, a.id, { kind: 'after', targetId: c.id });
      expect(exp.surfaces.map((s) => s.name)).toEqual(['C', 'A', 'B']);
      expect(exp.surfaces.find((s) => s.id === b.id)?.parentSurfaceId).toBe(a.id);
    });
  });

  describe('moveActionBy', () => {
    const cap1: Action = { ...baseCapability, id: asActionId('c1'), name: 'first' };
    const cap2: Action = { ...baseCapability, id: asActionId('c2'), name: 'second' };
    const cap3: Action = { ...baseCapability, id: asActionId('c3'), name: 'third' };
    const surfaceWithCaps: Surface = { ...baseSurface, actions: [cap1, cap2, cap3] };
    const exp: Feature = { ...baseFeature, surfaces: [surfaceWithCaps] };

    it('moves the action down within its surface', () => {
      const next = moveActionBy(exp, baseSurface.id, cap1.id, 1);
      expect(next.surfaces[0]?.actions.map((c) => c.name)).toEqual([
        'second',
        'first',
        'third'
      ]);
    });

    it('moves the action up within its surface', () => {
      const next = moveActionBy(exp, baseSurface.id, cap3.id, -1);
      expect(next.surfaces[0]?.actions.map((c) => c.name)).toEqual([
        'first',
        'third',
        'second'
      ]);
    });

    it('is a no-op at the edges', () => {
      expect(moveActionBy(exp, baseSurface.id, cap1.id, -1).surfaces[0]?.actions).toEqual(
        surfaceWithCaps.actions
      );
      expect(moveActionBy(exp, baseSurface.id, cap3.id, 1).surfaces[0]?.actions).toEqual(
        surfaceWithCaps.actions
      );
    });
  });

  describe('updateParameter', () => {
    it('syncs the bound state definition type when the parameter type changes', () => {
      const next = updateParameter(
        featureWithBoundParam,
        baseSurface.id,
        baseCapability.id,
        boundParam.id,
        { type: 'number' }
      );
      const surface = next.surfaces[0]!;
      expect(surface.actions[0]?.parameters[0]?.type).toBe('number');
      expect(surface.stateDefinitions[0]?.type).toBe('number');
    });

    it('syncs enumValues when the parameter becomes an enum', () => {
      const next = updateParameter(
        featureWithBoundParam,
        baseSurface.id,
        baseCapability.id,
        boundParam.id,
        { type: 'enum', enumValues: ['red', 'green', 'blue'] }
      );
      const def = next.surfaces[0]?.stateDefinitions[0];
      expect(def?.type).toBe('enum');
      expect(def?.enumValues).toEqual(['red', 'green', 'blue']);
    });

    it('clears state-def enumValues when the parameter is no longer an enum', () => {
      const enumFeature: Feature = {
        ...featureWithBoundParam,
        surfaces: [
          {
            ...surfaceWithBoundParam,
            stateDefinitions: [
              { ...boundStateDef, type: 'enum', enumValues: ['a', 'b'] }
            ],
            actions: [
              {
                ...baseCapability,
                parameters: [{ ...boundParam, type: 'enum', enumValues: ['a', 'b'] }]
              }
            ]
          }
        ]
      };
      const next = updateParameter(
        enumFeature,
        baseSurface.id,
        baseCapability.id,
        boundParam.id,
        { type: 'string', enumValues: undefined }
      );
      const def = next.surfaces[0]?.stateDefinitions[0];
      expect(def?.type).toBe('string');
      expect(def?.enumValues).toBeUndefined();
    });

    it('leaves state definitions alone when the parameter has no binding', () => {
      const unbound: Parameter = { ...boundParam, bindToStatePath: undefined };
      const exp: Feature = {
        ...featureWithBoundParam,
        surfaces: [
          {
            ...surfaceWithBoundParam,
            actions: [{ ...baseCapability, parameters: [unbound] }]
          }
        ]
      };
      const next = updateParameter(
        exp,
        baseSurface.id,
        baseCapability.id,
        boundParam.id,
        { type: 'number' }
      );
      expect(next.surfaces[0]?.stateDefinitions[0]?.type).toBe('string');
    });

    it('syncs the new bound path when the binding itself changes', () => {
      const expWithTwoDefs: Feature = {
        ...featureWithBoundParam,
        surfaces: [
          {
            ...surfaceWithBoundParam,
            stateDefinitions: [
              boundStateDef,
              {
                id: asStateDefinitionId('sd2'),
                path: asStatePath('cart.coupon'),
                type: 'boolean',
                defaultValue: false
              }
            ]
          }
        ]
      };
      const next = updateParameter(
        expWithTwoDefs,
        baseSurface.id,
        baseCapability.id,
        boundParam.id,
        { bindToStatePath: asStatePath('cart.coupon') }
      );
      const defs = next.surfaces[0]?.stateDefinitions ?? [];
      expect(defs.find((d) => d.path === asStatePath('cart.coupon'))?.type).toBe('string');
      expect(defs.find((d) => d.path === asStatePath('user.choice'))?.type).toBe('string');
    });
  });

  describe('updateStateDefinition', () => {
    const enumStateDef: StateDefinition = {
      id: asStateDefinitionId('sd-enum'),
      path: asStatePath('user.choice'),
      type: 'enum',
      defaultValue: 'a',
      enumValues: ['a', 'b']
    };
    const enumParam: Parameter = {
      ...boundParam,
      type: 'enum',
      enumValues: ['a', 'b']
    };
    const enumFeature: Feature = {
      ...featureWithBoundParam,
      surfaces: [
        {
          ...surfaceWithBoundParam,
          stateDefinitions: [enumStateDef],
          actions: [{ ...baseCapability, parameters: [enumParam] }]
        }
      ]
    };

    it('propagates new enumValues to every bound enum parameter', () => {
      const next = updateStateDefinition(enumFeature, baseSurface.id, enumStateDef.id, {
        enumValues: ['a', 'b', 'c']
      });
      const params = next.surfaces[0]?.actions[0]?.parameters ?? [];
      expect(params[0]?.enumValues).toEqual(['a', 'b', 'c']);
    });

    it('clears enumValues on bound enum parameters when the state stops being enum', () => {
      const next = updateStateDefinition(enumFeature, baseSurface.id, enumStateDef.id, {
        type: 'string',
        enumValues: undefined
      });
      const param = next.surfaces[0]?.actions[0]?.parameters[0];
      expect(param?.enumValues).toBeUndefined();
    });

    it('leaves parameters bound to other paths alone', () => {
      const otherParam: Parameter = {
        ...boundParam,
        id: asParameterId('p2'),
        name: 'other',
        bindToStatePath: asStatePath('other.path')
      };
      const exp: Feature = {
        ...enumFeature,
        surfaces: [
          {
            ...enumFeature.surfaces[0]!,
            actions: [
              {
                ...baseCapability,
                parameters: [enumParam, otherParam]
              }
            ]
          }
        ]
      };
      const next = updateStateDefinition(exp, baseSurface.id, enumStateDef.id, {
        enumValues: ['x', 'y']
      });
      const params = next.surfaces[0]?.actions[0]?.parameters ?? [];
      expect(params[0]?.enumValues).toEqual(['x', 'y']);
      expect(params[1]?.bindToStatePath).toBe(asStatePath('other.path'));
    });

    it('is a no-op when neither enumValues nor type changes', () => {
      const before = enumFeature.surfaces[0]?.actions[0]?.parameters[0];
      const next = updateStateDefinition(enumFeature, baseSurface.id, enumStateDef.id, {
        defaultValue: 'b'
      });
      const after = next.surfaces[0]?.actions[0]?.parameters[0];
      expect(after).toBe(before);
    });
  });

  describe('moveParameterBy', () => {
    const p1: Parameter = { ...boundParam, id: asParameterId('p1'), name: 'a' };
    const p2: Parameter = {
      ...boundParam,
      id: asParameterId('p2'),
      name: 'b',
      bindToStatePath: undefined
    };
    const p3: Parameter = {
      ...boundParam,
      id: asParameterId('p3'),
      name: 'c',
      bindToStatePath: undefined
    };
    const cap: Action = { ...baseCapability, parameters: [p1, p2, p3] };
    const surf: Surface = { ...baseSurface, actions: [cap] };
    const exp: Feature = { ...baseFeature, surfaces: [surf] };

    it('moves a parameter down within its action', () => {
      const next = moveParameterBy(exp, baseSurface.id, baseCapability.id, p1.id, 1);
      expect(next.surfaces[0]?.actions[0]?.parameters.map((p) => p.name)).toEqual([
        'b',
        'a',
        'c'
      ]);
    });

    it('is a no-op at the edges', () => {
      const next = moveParameterBy(exp, baseSurface.id, baseCapability.id, p1.id, -1);
      expect(next.surfaces[0]?.actions[0]?.parameters.map((p) => p.name)).toEqual([
        'a',
        'b',
        'c'
      ]);
    });
  });

  describe('setSurfaceParent', () => {
    const a: Surface = { ...baseSurface, id: asSurfaceId('a'), name: 'A' };
    const b: Surface = { ...baseSurface, id: asSurfaceId('b'), name: 'B' };
    const c: Surface = { ...baseSurface, id: asSurfaceId('c'), name: 'C' };
    const exp: Feature = { ...baseFeature, surfaces: [a, b, c] };

    it('assigns a parent and depth follows the chain', () => {
      let next = setSurfaceParent(exp, b.id, a.id);
      next = setSurfaceParent(next, c.id, b.id);
      expect(surfaceDepth(next.surfaces, a.id)).toBe(0);
      expect(surfaceDepth(next.surfaces, b.id)).toBe(1);
      expect(surfaceDepth(next.surfaces, c.id)).toBe(2);
    });

    it('refuses self-parenting', () => {
      const next = setSurfaceParent(exp, a.id, a.id);
      expect(next.surfaces[0]?.parentSurfaceId).toBeUndefined();
    });

    it('refuses cycles (descendant cannot become an ancestor)', () => {
      let next = setSurfaceParent(exp, b.id, a.id);
      // Try to make A a child of B (would create A→B→A cycle).
      next = setSurfaceParent(next, a.id, b.id);
      expect(next.surfaces.find((s) => s.id === a.id)?.parentSurfaceId).toBeUndefined();
    });

    it('clears the parent when called with null', () => {
      let next = setSurfaceParent(exp, b.id, a.id);
      next = setSurfaceParent(next, b.id, null);
      expect(next.surfaces.find((s) => s.id === b.id)?.parentSurfaceId).toBeUndefined();
    });
  });

  describe('moveStateDefinitionBy', () => {
    const surfWithDefs: Surface = {
      ...baseSurface,
      stateDefinitions: [
        { ...boundStateDef, id: asStateDefinitionId('d1'), path: asStatePath('a') },
        { ...boundStateDef, id: asStateDefinitionId('d2'), path: asStatePath('b') },
        { ...boundStateDef, id: asStateDefinitionId('d3'), path: asStatePath('c') }
      ]
    };
    const exp: Feature = { ...baseFeature, surfaces: [surfWithDefs] };

    it('moves a state definition up', () => {
      const next = moveStateDefinitionBy(exp, baseSurface.id, asStateDefinitionId('d2'), -1);
      expect(next.surfaces[0]?.stateDefinitions.map((d) => d.path)).toEqual([
        asStatePath('b'),
        asStatePath('a'),
        asStatePath('c')
      ]);
    });

    it('is a no-op at the edges', () => {
      const next = moveStateDefinitionBy(exp, baseSurface.id, asStateDefinitionId('d3'), 1);
      expect(next.surfaces[0]?.stateDefinitions.map((d) => d.path)).toEqual([
        asStatePath('a'),
        asStatePath('b'),
        asStatePath('c')
      ]);
    });
  });

  describe('removeActionAnywhere', () => {
    const evolutionAction: Action = {
      ...baseCapability,
      id: asActionId('evo'),
      name: 'Sign in with SSO',
      evolution: { rationale: 'Competitors offer it', category: 'competitor' }
    };
    const committed: Action = { ...baseCapability, id: asActionId('committed'), name: 'Sign in' };
    const feature: Feature = {
      ...baseFeature,
      surfaces: [{ ...baseSurface, actions: [committed, evolutionAction] }]
    };

    it('removes an action by id without needing its surface', () => {
      const next = removeActionAnywhere(feature, asActionId('evo'));
      expect(next.surfaces[0]?.actions.map((a) => String(a.id))).toEqual(['committed']);
      // immutable
      expect(feature.surfaces[0]?.actions).toHaveLength(2);
    });

    it('is a no-op for an unknown id', () => {
      const next = removeActionAnywhere(feature, asActionId('nope'));
      expect(next.surfaces[0]?.actions).toHaveLength(2);
    });
  });

  describe('clearActionEvolution', () => {
    const evolutionAction: Action = {
      ...baseCapability,
      id: asActionId('evo'),
      evolution: { rationale: 'Competitors offer it' }
    };
    const feature: Feature = {
      ...baseFeature,
      surfaces: [{ ...baseSurface, actions: [evolutionAction] }]
    };

    it('strips the evolution marker (accept), leaving a committed action', () => {
      const next = clearActionEvolution(feature, asActionId('evo'));
      expect(next.surfaces[0]?.actions[0]?.evolution).toBeUndefined();
      expect(next.surfaces[0]?.actions[0]?.name).toBe(evolutionAction.name);
      // original untouched
      expect(feature.surfaces[0]?.actions[0]?.evolution).toBeDefined();
    });

    it('leaves committed actions and unknown ids unchanged', () => {
      const next = clearActionEvolution(feature, asActionId('nope'));
      expect(next.surfaces[0]?.actions[0]?.evolution).toBeDefined();
    });
  });

  describe('dismissActionEvolution', () => {
    const evolutionAction: Action = {
      ...baseCapability,
      id: asActionId('evo'),
      evolution: { rationale: 'Competitors offer it', category: 'competitor' }
    };
    const committed: Action = { ...baseCapability, id: asActionId('committed') };
    const feature: Feature = {
      ...baseFeature,
      surfaces: [{ ...baseSurface, actions: [committed, evolutionAction] }]
    };

    it('marks the evolution dismissed without deleting the action (tombstone)', () => {
      const next = dismissActionEvolution(feature, asActionId('evo'));
      const action = next.surfaces[0]?.actions.find((a) => String(a.id) === 'evo');
      expect(action).toBeDefined();
      expect(action?.evolution?.dismissed).toBe(true);
      // the rest of the proposal is preserved so the assistant retains context
      expect(action?.evolution?.rationale).toBe('Competitors offer it');
      expect(action?.evolution?.category).toBe('competitor');
      // original untouched
      expect(feature.surfaces[0]?.actions[1]?.evolution?.dismissed).toBeUndefined();
    });

    it('leaves committed actions and unknown ids unchanged', () => {
      const next = dismissActionEvolution(feature, asActionId('committed'));
      expect(next.surfaces[0]?.actions[0]?.evolution).toBeUndefined();
      const unknown = dismissActionEvolution(feature, asActionId('nope'));
      expect(unknown).toEqual(feature);
    });
  });
});
