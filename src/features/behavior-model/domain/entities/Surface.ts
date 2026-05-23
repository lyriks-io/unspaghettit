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
   * Optional parent surface id, used to group related surfaces in the
   * navigator. Purely organizational. The simulator and rule engine never
   * read it. A cycle (parent === self, or parent inside own subtree) is
   * always rejected by the transform that sets it.
   */
  readonly parentSurfaceId?: SurfaceId;
};
