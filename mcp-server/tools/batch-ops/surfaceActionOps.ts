import * as T from '../../../src/features/behavior-model/domain/services/FeatureTransforms';
import type { Action } from '../../../src/features/behavior-model/domain/entities/Action';
import type { ActionOutcome } from '../../../src/features/behavior-model/domain/entities/ActionOutcome';
import type { Feature } from '../../../src/features/behavior-model/domain/entities/Feature';
import type { Surface } from '../../../src/features/behavior-model/domain/entities/Surface';
import {
  asActionId,
  asEffectId,
  asOutcomeId,
  asSurfaceId
} from '../../../src/features/behavior-model/domain/value-objects/ids';
import { normalizeEvolutionLoose } from '../_evolution';
import {
  directionDelta,
  optional,
  requireSomeChange,
  resolve,
  withPatch,
  type Op,
  type OpContext
} from './opHelpers';

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
        ...(typeof op.presentation === 'boolean' ? { presentation: op.presentation } : {}),
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
      const o = withPatch(op);
      const picked = {
        ...(typeof o.name === 'string' ? { name: o.name } : {}),
        ...(typeof o.type === 'string' ? { type: o.type as Surface['type'] } : {}),
        ...(typeof o.description === 'string' ? { description: o.description } : {}),
        ...(typeof o.presentation === 'boolean' ? { presentation: o.presentation } : {})
      };
      const wantsParent = 'parentSurfaceId' in o || 'parentRef' in o;
      if (!wantsParent) {
        requireSomeChange(op, picked, [
          'name',
          'type',
          'description',
          'presentation',
          'parentSurfaceId'
        ]);
      }
      if (Object.keys(picked).length > 0) exp = T.renameSurface(exp, sid, picked);
      if (wantsParent) {
        const parent = optional(o, 'parentRef', 'parentSurfaceId', refs);
        const parentId = parent ? asSurfaceId(parent) : null;
        // setSurfaceParent quietly refuses an invalid target (the dashboard
        // drag flow relies on that); through the MCP the refusal must be loud
        // or the op acks success while changing nothing.
        const blocked = T.surfaceParentBlockReason(exp, sid, parentId);
        if (blocked) throw new Error(`${op.kind}: ${blocked}`);
        exp = T.setSurfaceParent(exp, sid, parentId);
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
        // Scoped, preferred form: name only the invariants this action may
        // relax, with a rationale. See Action.invariantRelaxation.
        ...(op.invariantRelaxation && typeof op.invariantRelaxation === 'object'
          ? { invariantRelaxation: op.invariantRelaxation as unknown as Action['invariantRelaxation'] }
          : {}),
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
    case 'update_action': {
      const o = withPatch(op);
      const picked = {
        ...(typeof o.name === 'string' ? { name: o.name } : {}),
        ...(typeof o.intent === 'string' ? { intent: o.intent } : {}),
        ...(Array.isArray(o.requiredStates)
          ? {
              requiredStates: o.requiredStates as unknown as Action['requiredStates']
            }
          : {}),
        ...(Array.isArray(o.emittedEvents)
          ? {
              emittedEvents: o.emittedEvents as unknown as Action['emittedEvents']
            }
          : {}),
        ...(typeof o.bypassInvariants === 'boolean'
          ? { bypassInvariants: o.bypassInvariants }
          : {}),
        // null clears the relaxation; an object sets it; omit to leave it.
        ...(o.invariantRelaxation !== undefined
          ? {
              invariantRelaxation:
                o.invariantRelaxation === null
                  ? undefined
                  : (o.invariantRelaxation as unknown as Action['invariantRelaxation'])
            }
          : {}),
        // null/empty string clears the subscription; non-empty sets it.
        ...(o.triggeredByEvent === null || o.triggeredByEvent === ''
          ? { triggeredByEvent: undefined }
          : typeof o.triggeredByEvent === 'string'
            ? { triggeredByEvent: o.triggeredByEvent as Action['triggeredByEvent'] }
            : {}),
        // null accepts the proposal (clears the marker); an object sets
        // it; omit to leave the evolution state untouched.
        ...(o.evolution === null
          ? { evolution: undefined }
          : o.evolution !== undefined
            ? { evolution: normalizeEvolutionLoose(o.evolution) }
            : {})
      };
      requireSomeChange(op, picked, [
        'name',
        'intent',
        'requiredStates',
        'emittedEvents',
        'bypassInvariants',
        'invariantRelaxation',
        'triggeredByEvent',
        'evolution'
      ]);
      exp = T.updateAction(
        exp,
        asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
        asActionId(resolve(op, refs, 'actionRef', 'actionId')),
        picked
      );
      break;
    }
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

    // ── Action outcome ──────────────────────────────────────────────
    case 'add_action_outcome': {
      // `outcomeKind` (not `kind`, which is the op discriminator) carries the
      // ActionOutcome kind. Inline effects get fresh ids minted here.
      const rawEffects = Array.isArray(op.effects) ? op.effects : [];
      const effects = rawEffects.map(
        (e) => ({ ...(e as Record<string, unknown>), id: asEffectId(mintId()) })
      ) as unknown as ActionOutcome['effects'];
      const outcome: ActionOutcome = {
        id: asOutcomeId(mintId()),
        name: op.name as string,
        kind: op.outcomeKind as ActionOutcome['kind'],
        ...(op.condition && typeof op.condition === 'object'
          ? { condition: op.condition as ActionOutcome['condition'] }
          : {}),
        ...(effects && effects.length > 0 ? { effects } : {}),
        ...(typeof op.description === 'string' ? { description: op.description } : {})
      };
      exp = T.addOutcomeToCapability(
        exp,
        asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
        asActionId(resolve(op, refs, 'actionRef', 'actionId')),
        outcome
      );
      remember(op.ref, outcome.id);
      break;
    }
    case 'remove_action_outcome':
      exp = T.removeOutcomeFromCapability(
        exp,
        asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
        asActionId(resolve(op, refs, 'actionRef', 'actionId')),
        asOutcomeId(op.outcomeId as string)
      );
      break;

    default:
      return null;
  }
  return exp;
};
