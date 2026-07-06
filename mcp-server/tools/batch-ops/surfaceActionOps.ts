import * as T from '../../../src/features/behavior-model/domain/services/FeatureTransforms';
import type { Action } from '../../../src/features/behavior-model/domain/entities/Action';
import type { Feature } from '../../../src/features/behavior-model/domain/entities/Feature';
import type { Surface } from '../../../src/features/behavior-model/domain/entities/Surface';
import {
  asActionId,
  asSurfaceId
} from '../../../src/features/behavior-model/domain/value-objects/ids';
import { normalizeEvolutionLoose } from '../_evolution';
import { directionDelta, optional, resolve, type Op, type OpContext } from './opHelpers';

/**
 * Surface and Action op families. Returns the next Feature when it handled
 * op.kind and null when the op belongs to another family.
 */
export const applySurfaceActionOps = (op: Op, ctx: OpContext): Feature | null => {
  const { refs, mintId, remember } = ctx;
  let exp = ctx.feature;
  switch (op.kind) {
    // ── Surface ─────────────────────────────────────────────────────
    case 'add_surface': {
      const surface: Surface = {
        id: asSurfaceId(mintId()),
        name: op.name as string,
        type: op.type as Surface['type'],
        ...(typeof op.description === 'string' ? { description: op.description } : {}),
        stateDefinitions: [],
        actions: [],
        rules: [],
        invariants: [],
        transitions: [],
        ...(typeof op.parentRef === 'string' || typeof op.parentSurfaceId === 'string'
          ? { parentSurfaceId: asSurfaceId(resolve(op, refs, 'parentRef', 'parentSurfaceId')) }
          : {})
      };
      exp = T.addSurface(exp, surface);
      remember(op.ref, surface.id);
      break;
    }
    case 'update_surface': {
      const sid = asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId'));
      exp = T.renameSurface(exp, sid, {
        ...(typeof op.name === 'string' ? { name: op.name } : {}),
        ...(typeof op.type === 'string' ? { type: op.type as Surface['type'] } : {}),
        ...(typeof op.description === 'string' ? { description: op.description } : {})
      });
      if ('parentSurfaceId' in op || 'parentRef' in op) {
        const parent = optional(op, 'parentRef', 'parentSurfaceId', refs);
        exp = T.setSurfaceParent(exp, sid, parent ? asSurfaceId(parent) : null);
      }
      break;
    }
    case 'remove_surface':
      exp = T.removeSurface(exp, asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')));
      break;
    case 'move_surface':
      exp = T.moveSurfaceBy(
        exp,
        asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
        directionDelta(op)
      );
      break;

    // ── Action ──────────────────────────────────────────────────
    case 'add_action': {
      const cap: Action = {
        id: asActionId(mintId()),
        name: op.name as string,
        intent: op.intent as string,
        parameters: [],
        requiredStates: ((op.requiredStates as readonly string[] | undefined) ??
          []) as unknown as Action['requiredStates'],
        rules: [],
        invariants: [],
        effects: [],
        // Accepting `emittedEvents` here avoids the add_action +
        // update_action dance that was previously needed just to
        // declare the events a brand-new action emits.
        emittedEvents: ((op.emittedEvents as readonly string[] | undefined) ??
          []) as unknown as Action['emittedEvents'],
        transitions: [],
        // Repair / admin actions opt out of invariant checks. See
        // Action.bypassInvariants doc, only set this when the action's
        // whole purpose is to recover from a broken invariant.
        ...(op.bypassInvariants === true ? { bypassInvariants: true } : {}),
        // Subscribe this action to an event. When ANY action in the
        // feature emits the named event the simulator cascades into
        // this one. See Action.triggeredByEvent doc.
        ...(typeof op.triggeredByEvent === 'string' && op.triggeredByEvent.length > 0
          ? { triggeredByEvent: op.triggeredByEvent as Action['triggeredByEvent'] }
          : {}),
        // Mark a brand-new action as a proposed Evolution (dashed
        // placeholder). See Action.evolution doc / propose_evolution.
        ...(op.evolution !== undefined && op.evolution !== null
          ? { evolution: normalizeEvolutionLoose(op.evolution) }
          : {})
      };
      exp = T.addAction(
        exp,
        asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
        cap
      );
      remember(op.ref, cap.id);
      break;
    }
    case 'update_action':
      exp = T.updateAction(
        exp,
        asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
        asActionId(resolve(op, refs, 'actionRef', 'actionId')),
        {
          ...(typeof op.name === 'string' ? { name: op.name } : {}),
          ...(typeof op.intent === 'string' ? { intent: op.intent } : {}),
          ...(Array.isArray(op.requiredStates)
            ? {
                requiredStates: op.requiredStates as unknown as Action['requiredStates']
              }
            : {}),
          ...(Array.isArray(op.emittedEvents)
            ? {
                emittedEvents: op.emittedEvents as unknown as Action['emittedEvents']
              }
            : {}),
          ...(typeof op.bypassInvariants === 'boolean'
            ? { bypassInvariants: op.bypassInvariants }
            : {}),
          // null/empty string clears the subscription; non-empty sets it.
          ...(op.triggeredByEvent === null || op.triggeredByEvent === ''
            ? { triggeredByEvent: undefined }
            : typeof op.triggeredByEvent === 'string'
              ? { triggeredByEvent: op.triggeredByEvent as Action['triggeredByEvent'] }
              : {}),
          // null accepts the proposal (clears the marker); an object sets
          // it; omit to leave the evolution state untouched.
          ...(op.evolution === null
            ? { evolution: undefined }
            : op.evolution !== undefined
              ? { evolution: normalizeEvolutionLoose(op.evolution) }
              : {})
        }
      );
      break;
    case 'remove_action':
      exp = T.removeAction(
        exp,
        asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
        asActionId(resolve(op, refs, 'actionRef', 'actionId'))
      );
      break;
    case 'move_action':
      exp = T.moveActionBy(
        exp,
        asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
        asActionId(resolve(op, refs, 'actionRef', 'actionId')),
        directionDelta(op)
      );
      break;

    default:
      return null;
  }
  return exp;
};
