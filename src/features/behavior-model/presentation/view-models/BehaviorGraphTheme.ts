import type {
  BehaviorGraphEdgeKind,
  BehaviorGraphNodeType
} from '$features/behavior-model/domain/services/BehaviorGraphModel';

export type BehaviorGraphNodeTheme = {
  readonly label: string;
  readonly fill: string;
  readonly stroke: string;
};

export type BehaviorGraphEdgeTheme = {
  readonly label: string;
  readonly color: string;
};

export const behaviorGraphNodeTheme: Record<BehaviorGraphNodeType, BehaviorGraphNodeTheme> = {
  feature: { label: 'Feature', fill: '#0f172a', stroke: '#020617' },
  surface: { label: 'Surface', fill: '#0e7490', stroke: '#155e75' },
  action: { label: 'Action', fill: '#2563eb', stroke: '#1d4ed8' },
  state: { label: 'State', fill: '#7c3aed', stroke: '#6d28d9' },
  event: { label: 'Event', fill: '#db2777', stroke: '#be185d' },
  parameter: { label: 'Parameter', fill: '#0891b2', stroke: '#0e7490' },
  rule: { label: 'Rule', fill: '#ea580c', stroke: '#c2410c' },
  effect: { label: 'Effect', fill: '#16a34a', stroke: '#15803d' },
  invariant: { label: 'Invariant', fill: '#ca8a04', stroke: '#a16207' },
  scenario: { label: 'Scenario', fill: '#475569', stroke: '#334155' },
  persona: { label: 'Persona', fill: '#0f766e', stroke: '#115e59' },
  resource: { label: 'Resource', fill: '#4f46e5', stroke: '#4338ca' },
  entity: { label: 'Entity', fill: '#9333ea', stroke: '#7e22ce' },
  valueSet: { label: 'Value set', fill: '#64748b', stroke: '#475569' }
};

export const behaviorGraphEdgeTheme: Record<BehaviorGraphEdgeKind, BehaviorGraphEdgeTheme> = {
  contains: { label: 'Contains', color: '#94a3b8' },
  reads: { label: 'Reads', color: '#7c3aed' },
  writes: { label: 'Writes', color: '#16a34a' },
  emits: { label: 'Emits', color: '#db2777' },
  transitions: { label: 'Transitions', color: '#0891b2' },
  asserts: { label: 'Asserts', color: '#ca8a04' },
  uses: { label: 'Uses', color: '#475569' },
  handles: { label: 'Handles', color: '#2563eb' }
};
