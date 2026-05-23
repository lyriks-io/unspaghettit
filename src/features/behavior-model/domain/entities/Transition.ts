import type { SurfaceId, TransitionId } from '../value-objects/ids';

export type Transition = {
  readonly id: TransitionId;
  readonly target: SurfaceId;
  readonly label?: string;
  readonly description?: string;
};
