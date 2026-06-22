import { describe, expect, it } from 'vitest';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Surface } from '$features/behavior-model/domain/entities/Surface';
import {
  asActionId,
  asEffectId,
  asFeatureId,
  asSurfaceId,
  asTransitionId
} from '$features/behavior-model/domain/value-objects/ids';
import { analyzeSurfaceReachability } from './SurfaceReachability';

type SurfaceSpec = {
  /** Targets reached via declared `transitions[]`. */
  readonly transitions?: readonly string[];
  /** Targets reached via an action's `transition_surface` effect. */
  readonly actionTargets?: readonly string[];
};

const surface = (id: string, spec: SurfaceSpec = {}): Surface => ({
  id: asSurfaceId(id),
  name: id.toUpperCase(),
  type: 'screen',
  stateDefinitions: [],
  actions: (spec.actionTargets ?? []).map((target, i) => ({
    id: asActionId(`${id}-a${i}`),
    name: `go-${target}`,
    intent: 'navigate',
    parameters: [],
    requiredStates: [],
    rules: [],
    invariants: [],
    effects: [
      { id: asEffectId(`${id}-e${i}`), type: 'transition_surface', target: asSurfaceId(target) }
    ],
    emittedEvents: [],
    transitions: []
  })),
  rules: [],
  invariants: [],
  transitions: (spec.transitions ?? []).map((target, i) => ({
    id: asTransitionId(`${id}-t${i}`),
    target: asSurfaceId(target)
  }))
});

const featureWith = (surfaces: readonly Surface[]): Feature => ({
  id: asFeatureId('f'),
  name: 'Reachability Demo',
  surfaces,
  personas: [],
  resources: [],
  entities: [],
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z'
});

describe('analyzeSurfaceReachability', () => {
  it('flags a surface with no incoming navigation as unreachable', () => {
    // a (entry) -> b (declared transition). c only points OUT to a, so nothing
    // ever points at c: it is unreachable. b has no outgoing edge: terminal.
    const report = analyzeSurfaceReachability(
      featureWith([
        surface('a', { transitions: ['b'] }),
        surface('b'),
        surface('c', { actionTargets: ['a'] })
      ])
    );

    expect(report.entrySurfaceId).toBe('a');
    expect([...report.reachableSurfaceIds].sort()).toEqual(['a', 'b']);
    expect(report.unreachableSurfaces.map((s) => s.surfaceId)).toEqual(['c']);
    expect(report.terminalSurfaces.map((s) => s.surfaceId)).toEqual(['b']);
  });

  it('counts a transition_surface effect as a navigation edge', () => {
    // a reaches b ONLY through an action effect (no declared transition).
    const report = analyzeSurfaceReachability(
      featureWith([surface('a', { actionTargets: ['b'] }), surface('b')])
    );

    expect([...report.reachableSurfaceIds].sort()).toEqual(['a', 'b']);
    expect(report.unreachableSurfaces).toEqual([]);
  });

  it('treats the whole graph as reachable when every surface is wired', () => {
    const report = analyzeSurfaceReachability(
      featureWith([
        surface('a', { transitions: ['b'] }),
        surface('b', { transitions: ['c'] }),
        surface('c', { transitions: ['a'] })
      ])
    );

    expect(report.unreachableSurfaces).toEqual([]);
    expect(report.terminalSurfaces).toEqual([]);
  });

  it('returns an empty report for a feature with no surfaces', () => {
    const report = analyzeSurfaceReachability(featureWith([]));
    expect(report.entrySurfaceId).toBeNull();
    expect(report.reachableSurfaceIds).toEqual([]);
    expect(report.unreachableSurfaces).toEqual([]);
    expect(report.terminalSurfaces).toEqual([]);
  });
});
