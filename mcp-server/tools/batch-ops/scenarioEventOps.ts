import * as T from '../../../src/features/behavior-model/domain/services/FeatureTransforms';
import type {
  EventDefinition,
  EventPayloadField
} from '../../../src/features/behavior-model/domain/entities/EventDefinition';
import type { Feature } from '../../../src/features/behavior-model/domain/entities/Feature';
import type { EventName } from '../../../src/features/behavior-model/domain/value-objects/EventName';
import {
  asActionId,
  asEventDefinitionId,
  asScenarioId,
  asSurfaceId
} from '../../../src/features/behavior-model/domain/value-objects/ids';
import { buildScenario, buildScenarioPatch } from '../_entity_builders';
import {
  notFoundInOp,
  requireSomeChange,
  resolve,
  resolveScenarioRefs,
  withPatch,
  type Op,
  type OpContext
} from './opHelpers';

/**
 * Scenario and Event op families. Returns the next Feature when it handled
 * op.kind and null when the op belongs to another family.
 */
export const applyScenarioEventOps = (op: Op, ctx: OpContext): Feature | null => {
  const { refs, mintId, remember } = ctx;
  let exp = ctx.feature;
  switch (op.kind) {
    // ── Scenarios ───────────────────────────────────────────────────
    case 'add_scenario': {
      // Shared builder = single source of truth for scenario wire shape.
      // See mcp-server/tools/_entity_builders.ts.
      const resolved = resolveScenarioRefs(op, refs);
      const scenario = buildScenario(resolved, mintId);
      exp = T.addScenarioToCapability(
        exp,
        asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
        asActionId(resolve(op, refs, 'actionRef', 'actionId')),
        scenario
      );
      remember(op.ref, scenario.id);
      break;
    }
    case 'update_scenario': {
      const sid = asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId'));
      const cid = asActionId(resolve(op, refs, 'actionRef', 'actionId'));
      const scid = asScenarioId(op.scenarioId as string);
      const resolved = resolveScenarioRefs(withPatch(op), refs);
      const patch = buildScenarioPatch(resolved);
      requireSomeChange(op, patch as Record<string, unknown>, [
        'name',
        'description',
        'personaId',
        'stateOverrides',
        'parameterOverrides',
        'expectedStatus',
        'expectedAssertions',
        'expectedTransition',
        'timeAdvance',
        'steps'
      ]);
      exp = T.updateScenarioOnCapability(exp, sid, cid, scid, patch);
      break;
    }
    case 'remove_scenario':
      exp = T.removeScenarioFromCapability(
        exp,
        asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
        asActionId(resolve(op, refs, 'actionRef', 'actionId')),
        asScenarioId(op.scenarioId as string)
      );
      break;

    // ── Events ──────────────────────────────────────────────────────
    case 'add_event': {
      const payloadRaw = op.payloadSchema as readonly Record<string, unknown>[] | undefined;
      const event: EventDefinition = {
        id: asEventDefinitionId(mintId()),
        name: op.name as EventName,
        ...(typeof op.description === 'string' ? { description: op.description } : {}),
        ...(payloadRaw && payloadRaw.length > 0
          ? {
              payloadSchema: payloadRaw.map(
                (f) =>
                  ({
                    name: f.name as string,
                    type: f.type as EventPayloadField['type'],
                    required: f.required as boolean,
                    ...(typeof f.description === 'string'
                      ? { description: f.description }
                      : {})
                  }) as EventPayloadField
              )
            }
          : {}),
        ...(typeof op.delivery === 'string'
          ? { delivery: op.delivery as EventDefinition['delivery'] }
          : {})
      };
      exp = T.addEvent(exp, event);
      remember(op.ref, event.id);
      break;
    }
    case 'update_event': {
      const eid = asEventDefinitionId(op.eventId as string);
      const existing = (exp.events ?? []).find((e) => e.id === eid);
      if (!existing) throw notFoundInOp(op, 'event', eid);
      const o = withPatch(op);
      const payloadRaw = o.payloadSchema as
        | readonly Record<string, unknown>[]
        | undefined;
      const picked = {
        ...(typeof o.name === 'string' ? { name: o.name as EventName } : {}),
        ...(typeof o.description === 'string' ? { description: o.description } : {}),
        ...(payloadRaw !== undefined
          ? payloadRaw.length === 0
            ? { payloadSchema: undefined }
            : {
                payloadSchema: payloadRaw.map(
                  (f) =>
                    ({
                      name: f.name as string,
                      type: f.type as EventPayloadField['type'],
                      required: f.required as boolean,
                      ...(typeof f.description === 'string'
                        ? { description: f.description }
                        : {})
                    }) as EventPayloadField
                )
              }
          : {}),
        ...(typeof o.delivery === 'string'
          ? { delivery: o.delivery as EventDefinition['delivery'] }
          : {})
      };
      requireSomeChange(op, picked, ['name', 'description', 'payloadSchema', 'delivery']);
      exp = T.updateEvent(exp, { ...existing, ...picked });
      break;
    }
    case 'remove_event':
      exp = T.removeEvent(exp, asEventDefinitionId(op.eventId as string));
      break;

    default:
      return null;
  }
  return exp;
};
