import type { SurfaceId } from '../value-objects/ids';
import type { Action } from './Action';
import type { Invariant } from './Invariant';
import type { Rule } from './Rule';
import type { StateDefinition } from './StateDefinition';
import type { Transition } from './Transition';

export type SurfaceType =
  | 'screen'
  | 'canvas'
  | 'terminal'
  | 'board'
  | 'workflow'
  | 'command_palette'
  | 'api_playground'
  | 'map'
  | 'dialog_area'
  | 'custom';

export const ALL_SURFACE_TYPES: readonly SurfaceType[] = [
  'screen',
  'canvas',
  'terminal',
  'board',
  'workflow',
  'command_palette',
  'api_playground',
  'map',
  'dialog_area',
  'custom'
];

export const surfaceTypeLabel = (t: SurfaceType): string => {
  switch (t) {
    case 'screen':
      return 'Screen';
    case 'canvas':
      return 'Canvas';
    case 'terminal':
      return 'Terminal';
    case 'board':
      return 'Board';
    case 'workflow':
      return 'Workflow';
    case 'command_palette':
      return 'Command palette';
    case 'api_playground':
      return 'API playground';
    case 'map':
      return 'Map';
    case 'dialog_area':
      return 'Dialog area';
    case 'custom':
      return 'Custom';
  }
};

export type Surface = {
  readonly id: SurfaceId;
  readonly name: string;
  readonly type: SurfaceType;
  readonly description?: string;
  readonly stateDefinitions: readonly StateDefinition[];
  readonly actions: readonly Action[];
  readonly rules: readonly Rule[];
  readonly invariants: readonly Invariant[];
  readonly transitions: readonly Transition[];
  /**
   * Marks this as a pure UI/presentation surface: rendered and navigable but
   * EXCLUDED from behavior-maturity scoring. Deeply modeling a nav/click screen
   * with no rules/events/scenarios has no behavioral payoff, and scoring it only
   * caps a feature's maturity for no reason. Do NOT infer this from
   * `type: 'screen'` — a hand-authored screen can hold real behavior. Optional;
   * downstream reads `surface.presentation ?? false`. Presentation surfaces stay
   * in the model (and in path-sharing scope) and can still be scored on their own
   * via `scoreSurface`; only the feature-level rollup skips them.
   */
  readonly presentation?: boolean;
  /**
   * Optional parent surface id, used to group related surfaces in the
   * navigator. Purely organizational. The simulator and rule engine never
   * read it. A cycle (parent === self, or parent inside own subtree) is
   * always rejected by the transform that sets it.
   */
  readonly parentSurfaceId?: SurfaceId;
};
