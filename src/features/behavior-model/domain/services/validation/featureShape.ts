import type { Feature } from '../../entities/Feature';
import { effectiveEnumValues } from '../EnumValues';
import { isEventName } from '../../value-objects/EventName';
import { parameterTypeToStateType } from '../../value-objects/ParameterType';
import { isStateValueAssignableTo } from '../../value-objects/StateValue';
import {
  categoryHint,
  defaultValueHint,
  requireDescription,
  VALID_RULE_CATEGORIES,
  type ValidationResult
} from './shared';

/**
 * Validate an Feature for structural integrity before persistence:
 *  - required string fields are present
 *  - IDs are unique within their parent scope
 *  - cross-references resolve (transitions, parent surfaces)
 *
 * Format-level validation of individual IDs is already enforced by the
 * `asXxxId(...)` value-object constructors when the data is built
 * programmatically. This service catches the higher-level issues that
 * those branded types cannot see.
 */
export const validateFeature = (feature: Feature): ValidationResult => {
  const errors: string[] = [];
  const personaIds = new Set<string>();
  for (const p of feature.personas) {
    if (personaIds.has(p.id)) errors.push(`Duplicate persona id "${p.id}"`);
    personaIds.add(p.id);
    requireDescription(errors, `Persona ${p.id}`, p);
  }

  // Named value sets (shared enums). Built up-front so state definitions and
  // parameters can validate their `valueSetId` references below.
  const valueSetIds = new Set<string>();
  for (const vs of feature.valueSets ?? []) {
    if (valueSetIds.has(String(vs.id))) {
      errors.push(`Duplicate value set id "${vs.id}"`);
    }
    valueSetIds.add(String(vs.id));
    if (!vs.name || vs.name.trim().length === 0) {
      errors.push(`Value set ${vs.id} is missing a name.`);
    }
    requireDescription(errors, `Value set ${vs.id}`, vs);
    if (!Array.isArray(vs.values) || vs.values.length === 0) {
      errors.push(`Value set ${vs.id} ("${vs.name}") must declare at least one value.`);
    } else if (new Set(vs.values).size !== vs.values.length) {
      errors.push(`Value set ${vs.id} ("${vs.name}") has duplicate values.`);
    }
  }

  // Named constants (feature-level reusable values referenced from expressions
  // via `{kind:'const', name}`). The name is the reference key, so it must be
  // unique within the feature; the value must be present (false / 0 / "" are
  // legitimate, so only `undefined` is rejected).
  const constantIds = new Set<string>();
  const constantNames = new Set<string>();
  for (const c of feature.constants ?? []) {
    if (constantIds.has(String(c.id))) {
      errors.push(`Duplicate constant id "${c.id}"`);
    }
    constantIds.add(String(c.id));
    if (!c.name || c.name.trim().length === 0) {
      errors.push(`Constant ${c.id} is missing a name.`);
    } else if (constantNames.has(c.name)) {
      errors.push(
        `Duplicate constant name "${c.name}": names are the reference key for {kind:"const"} and must be unique within the feature.`
      );
    } else {
      constantNames.add(c.name);
    }
    requireDescription(errors, `Constant ${c.id}`, c);
    if (c.value === undefined) {
      errors.push(`Constant ${c.id} ("${c.name}") must declare a value.`);
    }
  }

  if (!feature.id || feature.id.trim().length === 0) {
    errors.push('Feature id is required.');
  }
  if (!feature.name || feature.name.trim().length === 0) {
    errors.push('Feature name is required.');
  }
  requireDescription(errors, `Feature ${feature.id || '(new)'}`, feature);

  const surfaceIds = new Set<string>();
  for (const surface of feature.surfaces) {
    if (surfaceIds.has(surface.id)) {
      errors.push(`Duplicate surface id: ${surface.id}`);
    }
    surfaceIds.add(surface.id);
    if (!surface.name || surface.name.trim().length === 0) {
      errors.push(`Surface ${surface.id} is missing a name.`);
    }
    requireDescription(errors, `Surface ${surface.id}`, surface);
  }

  for (const surface of feature.surfaces) {
    if (surface.parentSurfaceId) {
      if (!surfaceIds.has(surface.parentSurfaceId)) {
        errors.push(
          `Surface ${surface.id} parentSurfaceId "${surface.parentSurfaceId}" does not exist.`
        );
      }
      if (surface.parentSurfaceId === surface.id) {
        errors.push(`Surface ${surface.id} cannot be its own parent.`);
      }
    }

    const stateDefIds = new Set<string>();
    const stateDefPaths = new Set<string>();
    for (const def of surface.stateDefinitions) {
      if (stateDefIds.has(def.id)) {
        errors.push(`Duplicate stateDefinition id "${def.id}" in surface ${surface.id}`);
      }
      stateDefIds.add(def.id);
      if (stateDefPaths.has(def.path)) {
        errors.push(
          `Duplicate state path "${def.path}" in surface ${surface.id}. Only one stateDefinition per path is allowed.`
        );
      }
      stateDefPaths.add(def.path);
      requireDescription(errors, `State definition "${def.path}" in surface ${surface.id}`, def);
      // Type/value contract: rules and invariants compare values by JS type
      // (e.g. greater_than requires both sides to be `typeof number`). A
      // defaultValue stored as `"365"` instead of `365` silently falsifies
      // every condition that touches it. Reject at write time so the bug
      // can't reach disk.
      if (!isStateValueAssignableTo(def.defaultValue, def.type)) {
        errors.push(
          `State "${def.path}" in surface ${surface.id}: defaultValue is not assignable to declared type "${def.type}". ${defaultValueHint(def.defaultValue, def.type)}`
        );
      } else if (def.type === 'enum') {
        if (def.enumValues && def.valueSetId !== undefined) {
          errors.push(
            `State "${def.path}" in surface ${surface.id}: set either enumValues or valueSetId, not both.`
          );
        }
        if (def.valueSetId !== undefined && !valueSetIds.has(String(def.valueSetId))) {
          errors.push(
            `State "${def.path}" in surface ${surface.id}: valueSetId "${def.valueSetId}" does not resolve to a value set on the feature.`
          );
        }
        const allowed = effectiveEnumValues(def, feature.valueSets);
        if (
          allowed &&
          typeof def.defaultValue === 'string' &&
          !allowed.includes(def.defaultValue)
        ) {
          errors.push(
            `State "${def.path}" in surface ${surface.id}: defaultValue "${def.defaultValue}" is not one of ${
              def.valueSetId !== undefined ? `value set "${def.valueSetId}"` : 'enumValues'
            }.`
          );
        }
      }
      if (def.valueSetId !== undefined && def.type !== 'enum') {
        errors.push(
          `State "${def.path}" in surface ${surface.id}: valueSetId is only valid for type "enum" (got "${def.type}").`
        );
      }
      if (def.sharedWith) {
        for (const otherSurfaceId of def.sharedWith) {
          if (otherSurfaceId === surface.id) {
            errors.push(
              `State "${def.path}" sharedWith references its own surface ${surface.id}. Drop it.`
            );
          } else if (!surfaceIds.has(otherSurfaceId)) {
            errors.push(
              `State "${def.path}" in surface ${surface.id}: sharedWith references unknown surface "${otherSurfaceId}".`
            );
          }
        }
      }
    }

    const ruleIds = new Set<string>();
    for (const rule of surface.rules) {
      if (ruleIds.has(rule.id)) {
        errors.push(`Duplicate surface rule id "${rule.id}" in surface ${surface.id}`);
      }
      ruleIds.add(rule.id);
      requireDescription(errors, `Surface rule ${rule.id} in surface ${surface.id}`, rule);
      if (!VALID_RULE_CATEGORIES.has(String(rule.category))) {
        errors.push(
          `Surface rule ${rule.id} in surface ${surface.id} has unknown category "${rule.category}". ${categoryHint(String(rule.category))}`
        );
      }
    }

    const invariantIds = new Set<string>();
    for (const inv of surface.invariants) {
      if (invariantIds.has(inv.id)) {
        errors.push(`Duplicate surface invariant id "${inv.id}" in surface ${surface.id}`);
      }
      invariantIds.add(inv.id);
      requireDescription(errors, `Surface invariant ${inv.id} in surface ${surface.id}`, inv);
    }

    const transitionIds = new Set<string>();
    for (const trans of surface.transitions) {
      if (transitionIds.has(trans.id)) {
        errors.push(`Duplicate transition id "${trans.id}" in surface ${surface.id}`);
      }
      transitionIds.add(trans.id);
      requireDescription(errors, `Transition ${trans.id} in surface ${surface.id}`, trans);
      if (!surfaceIds.has(trans.target)) {
        errors.push(
          `Transition ${trans.id} in surface ${surface.id} targets unknown surface "${trans.target}"`
        );
      }
    }

    const actionIds = new Set<string>();
    for (const cap of surface.actions) {
      if (actionIds.has(cap.id)) {
        errors.push(`Duplicate action id "${cap.id}" in surface ${surface.id}`);
      }
      actionIds.add(cap.id);
      if (!cap.name || cap.name.trim().length === 0) {
        errors.push(`Action ${cap.id} is missing a name.`);
      }
      if (!cap.intent || cap.intent.trim().length === 0) {
        errors.push(`Action ${cap.id} is missing an intent.`);
      }

      const paramIds = new Set<string>();
      for (const p of cap.parameters) {
        if (paramIds.has(p.id)) {
          errors.push(`Duplicate parameter id "${p.id}" in action ${cap.id}`);
        }
        paramIds.add(p.id);
        requireDescription(errors, `Parameter "${p.name}" in action ${cap.id}`, p);
        if (
          p.defaultValue !== undefined &&
          !isStateValueAssignableTo(p.defaultValue, parameterTypeToStateType(p.type))
        ) {
          const expectedType = parameterTypeToStateType(p.type);
          errors.push(
            `Parameter "${p.name}" in action ${cap.id}: defaultValue is not assignable to declared type "${p.type}". ${defaultValueHint(p.defaultValue, expectedType)}`
          );
        } else if (p.type === 'enum') {
          if (p.enumValues && p.valueSetId !== undefined) {
            errors.push(
              `Parameter "${p.name}" in action ${cap.id}: set either enumValues or valueSetId, not both.`
            );
          }
          if (p.valueSetId !== undefined && !valueSetIds.has(String(p.valueSetId))) {
            errors.push(
              `Parameter "${p.name}" in action ${cap.id}: valueSetId "${p.valueSetId}" does not resolve to a value set on the feature.`
            );
          }
          const allowed = effectiveEnumValues(p, feature.valueSets);
          if (
            allowed &&
            typeof p.defaultValue === 'string' &&
            !allowed.includes(p.defaultValue)
          ) {
            errors.push(
              `Parameter "${p.name}" in action ${cap.id}: defaultValue "${p.defaultValue}" is not one of ${
                p.valueSetId !== undefined ? `value set "${p.valueSetId}"` : 'enumValues'
              }.`
            );
          }
        }
        if (p.valueSetId !== undefined && p.type !== 'enum') {
          errors.push(
            `Parameter "${p.name}" in action ${cap.id}: valueSetId is only valid for type "enum" (got "${p.type}").`
          );
        }
      }

      const capRuleIds = new Set<string>();
      for (const rule of cap.rules) {
        if (capRuleIds.has(rule.id)) {
          errors.push(`Duplicate rule id "${rule.id}" in action ${cap.id}`);
        }
        capRuleIds.add(rule.id);
        requireDescription(errors, `Rule ${rule.id} in action ${cap.id}`, rule);
        if (!VALID_RULE_CATEGORIES.has(String(rule.category))) {
          errors.push(
            `Rule ${rule.id} in action ${cap.id} has unknown category "${rule.category}". ${categoryHint(String(rule.category))}`
          );
        }
      }

      const effectIds = new Set<string>();
      for (const effect of cap.effects) {
        if (effectIds.has(effect.id)) {
          errors.push(`Duplicate effect id "${effect.id}" in action ${cap.id}`);
        }
        effectIds.add(effect.id);
        requireDescription(errors, `Effect ${effect.id} in action ${cap.id}`, effect);
      }

      const onBlockedEffectIds = new Set<string>();
      for (const effect of cap.onBlockedEffects ?? []) {
        if (onBlockedEffectIds.has(effect.id)) {
          errors.push(`Duplicate onBlockedEffect id "${effect.id}" in action ${cap.id}`);
        }
        onBlockedEffectIds.add(effect.id);
        requireDescription(errors, `onBlockedEffect ${effect.id} in action ${cap.id}`, effect);
      }

      const capInvariantIds = new Set<string>();
      for (const inv of cap.invariants) {
        if (capInvariantIds.has(inv.id)) {
          errors.push(`Duplicate invariant id "${inv.id}" in action ${cap.id}`);
        }
        capInvariantIds.add(inv.id);
        requireDescription(errors, `Invariant ${inv.id} in action ${cap.id}`, inv);
      }

      const scenarioIds = new Set<string>();
      const actionParameterNames = new Set(cap.parameters.map((p) => p.name));
      for (const scenario of cap.scenarios ?? []) {
        if (scenarioIds.has(scenario.id)) {
          errors.push(`Duplicate scenario id "${scenario.id}" in action ${cap.id}`);
        }
        scenarioIds.add(scenario.id);
        requireDescription(errors, `Scenario ${scenario.id} in action ${cap.id}`, scenario);
        if (scenario.personaId && !personaIds.has(String(scenario.personaId))) {
          errors.push(
            `Scenario ${scenario.id} in action ${cap.id} references unknown personaId "${scenario.personaId}".`
          );
        }
        // Catch the silent-noop pattern where parameterOverrides reference a
        // name that doesn't exist on the action - the simulator blocks for
        // missing-required-param and the scenario "passes" by skipping every
        // assertion. We'd rather fail loudly at validation time.
        for (const override of scenario.parameterOverrides ?? []) {
          if (
            typeof override.parameterName !== 'string' ||
            !actionParameterNames.has(override.parameterName)
          ) {
            errors.push(
              `Scenario ${scenario.id} in action ${cap.id}: parameterOverrides entry references unknown parameter "${String(override.parameterName)}". Declared parameters: ${
                cap.parameters.length === 0
                  ? '<none>'
                  : cap.parameters.map((p) => p.name).join(', ')
              }.`
            );
          }
        }
        for (const assertion of scenario.expectedAssertions ?? []) {
          requireDescription(
            errors,
            `Scenario assertion for "${assertion.path}" in scenario ${scenario.id}`,
            assertion
          );
        }
        // Multi-step scenarios: each step replays a real action before the
        // subject action, so its actionId/surfaceId must resolve and its
        // parameterOverrides must name real parameters on THAT action.
        // Caught here so a typo'd step fails at save time, not silently at
        // run time.
        for (const [stepIdx, step] of (scenario.steps ?? []).entries()) {
          const stepSurfaceId =
            step.surfaceId === undefined ? surface.id : step.surfaceId;
          const stepSurface = feature.surfaces.find((s) => s.id === stepSurfaceId);
          if (!stepSurface) {
            errors.push(
              `Scenario ${scenario.id} in action ${cap.id}: step ${stepIdx} references unknown surfaceId "${String(step.surfaceId)}".`
            );
            continue;
          }
          const stepAction = stepSurface.actions.find((a) => a.id === step.actionId);
          if (!stepAction) {
            errors.push(
              `Scenario ${scenario.id} in action ${cap.id}: step ${stepIdx} references unknown actionId "${String(step.actionId)}" on surface ${String(stepSurfaceId)}.`
            );
            continue;
          }
          const stepParamNames = new Set(stepAction.parameters.map((p) => p.name));
          for (const override of step.parameterOverrides ?? []) {
            if (
              typeof override.parameterName !== 'string' ||
              !stepParamNames.has(override.parameterName)
            ) {
              errors.push(
                `Scenario ${scenario.id} in action ${cap.id}: step ${stepIdx} parameterOverrides references unknown parameter "${String(override.parameterName)}" on action ${String(step.actionId)}. Declared parameters: ${
                  stepAction.parameters.length === 0
                    ? '<none>'
                    : stepAction.parameters.map((p) => p.name).join(', ')
                }.`
              );
            }
          }
          for (const assertion of step.expectedAssertions ?? []) {
            requireDescription(
              errors,
              `Scenario ${scenario.id} step ${stepIdx} assertion for "${assertion.path}"`,
              assertion
            );
          }
        }
      }
    }
  }

  const resourceIds = new Set<string>();
  for (const r of feature.resources) {
    if (resourceIds.has(r.id)) errors.push(`Duplicate resource id "${r.id}"`);
    resourceIds.add(r.id);
    requireDescription(errors, `Resource ${r.id}`, r);
  }

  const dataIds = new Set<string>();
  for (const d of feature.entities) {
    if (dataIds.has(d.id)) errors.push(`Duplicate data id "${d.id}"`);
    dataIds.add(d.id);
    requireDescription(errors, `Entity "${d.namespace}"`, d);
    const checkEntityField = (field: { readonly name: string; readonly description?: string; readonly fields?: readonly unknown[]; readonly items?: unknown }): void => {
      requireDescription(errors, `Entity field "${field.name}" in entity ${d.namespace}`, field);
      for (const child of field.fields ?? []) {
        checkEntityField(child as {
          readonly name: string;
          readonly description?: string;
          readonly fields?: readonly unknown[];
          readonly items?: unknown;
        });
      }
      if (field.items) {
        checkEntityField(field.items as {
          readonly name: string;
          readonly description?: string;
          readonly fields?: readonly unknown[];
          readonly items?: unknown;
        });
      }
    };
    for (const field of d.fields) checkEntityField(field);
  }

  const eventIds = new Set<string>();
  const eventNames = new Set<string>();
  for (const event of feature.events ?? []) {
    if (eventIds.has(event.id)) errors.push(`Duplicate event id "${event.id}"`);
    eventIds.add(event.id);
    requireDescription(errors, `Event ${event.id}`, event);
    for (const field of event.payloadSchema ?? []) {
      requireDescription(errors, `Event payload field "${field.name}" in event ${event.id}`, field);
    }
    const name = String(event.name);
    if (eventNames.has(name)) {
      errors.push(`Duplicate event name "${name}". Event names must be unique within an feature.`);
    }
    eventNames.add(name);
    if (!isEventName(name)) {
      errors.push(eventNameError(name, `Event ${event.id}`));
    }
  }

  // Walk every event-name slot on actions: emittedEvents[] and any
  // emit_event effect's `event` field (action.effects, action.onBlockedEffects,
  // and rule effects). Names that fail isEventName silently saved before but
  // crashed `importFeatureFromJson` on the next read, the feature would then
  // vanish from list_features with no error. Catching it on write surfaces
  // the typo immediately.
  for (const surface of feature.surfaces) {
    for (const cap of surface.actions) {
      for (const eventName of cap.emittedEvents) {
        const name = String(eventName);
        if (!isEventName(name)) {
          errors.push(eventNameError(name, `Action ${cap.id} emittedEvents`));
        }
      }
      // triggeredByEvent is an event NAME too, but the catalog-gated
      // reference check skips it when no events are declared — so validate its
      // format here, regardless of the catalog, the same way emittedEvents are.
      if (cap.triggeredByEvent !== undefined) {
        const name = String(cap.triggeredByEvent);
        if (!isEventName(name)) {
          errors.push(eventNameError(name, `Action ${cap.id} triggeredByEvent`));
        }
      }
      const checkEffect = (effect: { type: string; event?: unknown }, where: string) => {
        if (effect.type === 'emit_event' && effect.event !== undefined) {
          const name = String(effect.event);
          if (!isEventName(name)) errors.push(eventNameError(name, where));
        }
      };
      for (const eff of cap.effects) checkEffect(eff, `Effect in action ${cap.id}`);
      for (const eff of cap.onBlockedEffects ?? []) {
        checkEffect(eff, `onBlockedEffect in action ${cap.id}`);
      }
      for (const r of cap.rules) checkEffect(r.effect, `Rule ${r.id} effect in action ${cap.id}`);
    }
    for (const r of surface.rules) {
      if (r.effect.type === 'emit_event' && r.effect.event !== undefined) {
        const name = String(r.effect.event);
        if (!isEventName(name)) {
          errors.push(eventNameError(name, `Surface rule ${r.id} effect`));
        }
      }
    }
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
};

const eventNameError = (name: string, where: string): string =>
  `${where}: invalid event name "${name}". Use lowercase dot-separated form like "selection.deleted". Example fixes: "${suggestEventName(name)}".`;

const suggestEventName = (name: string): string =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9._]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
