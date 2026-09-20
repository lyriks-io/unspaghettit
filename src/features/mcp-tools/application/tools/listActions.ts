import {
  effectiveActor,
  type ActionActor,
  type Evolution
} from '$features/behavior-model/domain/entities/Action';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type {
  ActionId,
  SurfaceId
} from '$features/behavior-model/domain/value-objects/ids';

export type ActionListing = {
  readonly actionId: ActionId;
  readonly actionName: string;
  readonly intent: string;
  readonly surfaceId: SurfaceId;
  readonly surfaceName: string;
  readonly parameterCount: number;
  readonly ruleCount: number;
  /**
   * Who fires the action, defaults applied (see `effectiveActor`): always
   * present, so a row never leaves the reader guessing between "a person" and
   * "not said".
   */
  readonly actor: ActionActor;
  /**
   * Present only when this action is a proposed Evolution (dashed placeholder).
   * Lets the LLM tell suggestions apart from committed behavior in the cheap
   * listing without a get_action round-trip.
   */
  readonly evolution?: Evolution;
};

export type ListActionsOutput = readonly ActionListing[];

export const listActionsTool = (
  feature: Feature,
  surfaceId?: SurfaceId
): ListActionsOutput => {
  const surfaces = surfaceId
    ? feature.surfaces.filter((s) => s.id === surfaceId)
    : feature.surfaces;
  const out: ActionListing[] = [];
  for (const surface of surfaces) {
    for (const cap of surface.actions) {
      out.push({
        actionId: cap.id,
        actionName: cap.name,
        intent: cap.intent,
        surfaceId: surface.id,
        surfaceName: surface.name,
        parameterCount: cap.parameters.length,
        ruleCount: cap.rules.length,
        actor: effectiveActor(cap),
        ...(cap.evolution ? { evolution: cap.evolution } : {})
      });
    }
  }
  return out;
};
