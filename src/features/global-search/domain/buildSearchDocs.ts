import type { Action } from '$features/behavior-model/domain/entities/Action';
import type { EntityField } from '$features/behavior-model/domain/entities/Entity';
import type { Rule } from '$features/behavior-model/domain/entities/Rule';
import type { Surface } from '$features/behavior-model/domain/entities/Surface';
import { surfaceTypeLabel } from '$features/behavior-model/domain/entities/Surface';
import type { Effect } from '$features/behavior-model/domain/value-objects/Effect';
import { effectTypeLabel } from '$features/behavior-model/domain/value-objects/Effect';
import { ruleCategoryLabel } from '$features/behavior-model/domain/value-objects/RuleCategory';
import { humanizeStatePath } from '$features/behavior-model/domain/value-objects/humanize';
import { tagLabel, type Tag } from '$shared/domain/Tags';
import type { SearchDoc, SearchModelInput } from './SearchDoc';
import {
  actionFocus,
  domainHref,
  featureHref,
  projectHref,
  surfaceTabFocus
} from './searchNav';

/** Join defined, non-empty parts into one lowercased corpus string. */
const corpus = (...parts: ReadonlyArray<string | undefined>): string =>
  parts
    .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    .join(' ')
    .toLowerCase();

const tagsCorpus = (tags: readonly Tag[] | undefined): string =>
  (tags ?? []).map(tagLabel).join(' ');

/** A short, human label for a state/parameter value or expression. */
const valueText = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  return String(value);
};

/** One-line summary of an effect, for both display and matching. */
const effectSummary = (effect: Effect): string => {
  switch (effect.type) {
    case 'set_state':
      return `Set ${effect.path} = ${valueText(effect.value)}`.trim();
    case 'show_message':
      return `“${effect.message}”`;
    case 'emit_event':
      return `Emit ${effect.event}`;
    case 'block_action':
      return `Block: ${effect.reason}`;
    case 'allow_action':
      return 'Allow action';
    case 'transition_surface':
      return 'Transition surface';
    case 'append_to_list':
      return `Append to ${effect.path}`;
    case 'remove_from_list':
      return `Remove from ${effect.path}`;
    case 'update_list_item':
      return `Update ${effect.field} in ${effect.path}`;
    case 'advance_time':
      return 'Advance time';
    case 'invoke_operation':
      return `Invoke ${effect.operation}`;
  }
};

const ruleTitle = (rule: Rule): string =>
  rule.description?.trim() || `${ruleCategoryLabel(rule.category)} rule`;

type FeatureContext = {
  readonly featureId: string;
  readonly featureName: string;
  readonly projectId?: string;
  readonly projectName?: string;
};

/**
 * Walk the entire behavior model and emit one {@link SearchDoc} per element.
 * Pure and total: the single source of truth for "what is searchable". Order
 * is stable (domains, projects, then each feature's full sub-tree) so the
 * scorer's index tiebreak is deterministic.
 */
export const buildSearchDocs = (input: SearchModelInput): SearchDoc[] => {
  const docs: SearchDoc[] = [];

  // featureId → owning project (first project that lists it).
  const featureToProject = new Map<string, { id: string; name: string }>();
  for (const project of input.projects) {
    for (const fid of project.featureIds) {
      if (!featureToProject.has(fid)) {
        featureToProject.set(fid, { id: project.id, name: project.name });
      }
    }
  }

  const push = (doc: SearchDoc): void => {
    docs.push(doc);
  };

  // ── Domains ────────────────────────────────────────────────────────────
  for (const domain of input.domains) {
    push({
      id: `domain:${domain.id}`,
      kind: 'domain',
      title: domain.name,
      subtitle: domain.description,
      haystack: corpus(domain.name, domain.description),
      nav: { href: domainHref(domain.id) }
    });
  }

  // ── Projects ───────────────────────────────────────────────────────────
  for (const project of input.projects) {
    push({
      id: `project:${project.id}`,
      kind: 'project',
      title: project.name,
      subtitle: project.description,
      projectId: project.id,
      projectName: project.name,
      haystack: corpus(project.name, project.description, tagsCorpus(project.tags)),
      nav: { href: projectHref(project.id) }
    });
  }

  // ── Features and their full sub-tree ─────────────────────────────────────
  for (const feature of input.features) {
    const owner = featureToProject.get(String(feature.id));
    const ctx: FeatureContext = {
      featureId: String(feature.id),
      featureName: feature.name,
      projectId: owner?.id,
      projectName: owner?.name
    };

    push({
      id: `feature:${ctx.featureId}`,
      kind: 'feature',
      title: feature.name,
      subtitle: feature.description,
      projectId: ctx.projectId,
      projectName: ctx.projectName,
      featureId: ctx.featureId,
      featureName: feature.name,
      haystack: corpus(feature.name, feature.description, tagsCorpus(feature.tags)),
      nav: { href: featureHref(ctx.featureId) }
    });

    for (const surface of feature.surfaces) {
      collectSurface(push, surface, ctx);
    }

    for (const persona of feature.personas) {
      const firstSurfaceId = feature.surfaces[0]?.id;
      push({
        id: `persona:${ctx.featureId}:${persona.id}`,
        kind: 'persona',
        title: persona.name,
        subtitle: persona.description,
        ...featureCrumb(ctx),
        haystack: corpus(persona.name, persona.description),
        nav: {
          href: firstSurfaceId
            ? featureHref(ctx.featureId, {
                surface: String(firstSurfaceId),
                panel: 'personas'
              })
            : featureHref(ctx.featureId)
        }
      });
    }

    for (const resource of feature.resources) {
      push({
        id: `resource:${ctx.featureId}:${resource.id}`,
        kind: 'resource',
        title: resource.name,
        subtitle: [resource.kind, resource.provider].filter(Boolean).join(' · '),
        ...featureCrumb(ctx),
        haystack: corpus(
          resource.name,
          resource.description,
          resource.provider,
          resource.location,
          resource.complianceTags?.join(' ')
        ),
        nav: { href: featureHref(ctx.featureId, { tab: 'resources' }) }
      });
    }

    for (const entity of feature.entities) {
      const entityTitle = humanizeStatePath(entity.namespace);
      push({
        id: `entity:${ctx.featureId}:${entity.id}`,
        kind: 'entity',
        title: entityTitle,
        subtitle: entity.description,
        ...featureCrumb(ctx),
        haystack: corpus(entityTitle, entity.namespace, entity.description),
        nav: { href: featureHref(ctx.featureId, { tab: 'data' }) }
      });
      for (const field of entity.fields) {
        collectEntityField(push, field, entity.id, entityTitle, ctx);
      }
    }

    for (const event of feature.events ?? []) {
      push({
        id: `event:${ctx.featureId}:${event.id}`,
        kind: 'event',
        title: String(event.name),
        subtitle: event.description,
        ...featureCrumb(ctx),
        haystack: corpus(
          String(event.name),
          event.description,
          (event.payloadSchema ?? []).map((f) => f.name).join(' ')
        ),
        nav: { href: featureHref(ctx.featureId, { tab: 'events' }) }
      });
    }

    for (const valueSet of feature.valueSets ?? []) {
      push({
        id: `value-set:${ctx.featureId}:${valueSet.id}`,
        kind: 'value-set',
        title: valueSet.name,
        subtitle: valueSet.values.join(', '),
        ...featureCrumb(ctx),
        haystack: corpus(valueSet.name, valueSet.description, valueSet.values.join(' ')),
        nav: { href: featureHref(ctx.featureId, { tab: 'data' }) }
      });
    }

    for (const invariant of feature.featureInvariants ?? []) {
      push({
        id: `invariant:${ctx.featureId}:feature:${invariant.id}`,
        kind: 'invariant',
        title: invariant.name,
        subtitle: invariant.message || invariant.description,
        ...featureCrumb(ctx),
        haystack: corpus(invariant.name, invariant.message, invariant.description),
        nav: { href: featureHref(ctx.featureId, { tab: 'invariants' }) }
      });
    }

    // Prose acceptance criteria — the report's "searchable" facet. Their
    // Given/When/Then text has no tag fallback, so index it explicitly.
    for (const criterion of feature.acceptanceCriteria ?? []) {
      push({
        id: `acceptance-criterion:${ctx.featureId}:${criterion.id}`,
        kind: 'acceptance-criterion',
        title: criterion.title,
        subtitle: criterion.then || criterion.description,
        ...featureCrumb(ctx),
        haystack: corpus(
          criterion.title,
          criterion.given,
          criterion.when,
          criterion.then,
          criterion.description
        ),
        nav: { href: featureHref(ctx.featureId, { tab: 'acceptance' }) }
      });
    }
  }

  return docs;
};

const featureCrumb = (ctx: FeatureContext) => ({
  projectId: ctx.projectId,
  projectName: ctx.projectName,
  featureId: ctx.featureId,
  featureName: ctx.featureName
});

const surfaceCrumb = (ctx: FeatureContext, surface: Surface) => ({
  ...featureCrumb(ctx),
  surfaceId: String(surface.id),
  surfaceName: surface.name
});

const collectSurface = (
  push: (doc: SearchDoc) => void,
  surface: Surface,
  ctx: FeatureContext
): void => {
  const surfaceId = String(surface.id);

  push({
    id: `surface:${ctx.featureId}:${surfaceId}`,
    kind: 'surface',
    title: surface.name,
    subtitle: [surfaceTypeLabel(surface.type), surface.description]
      .filter(Boolean)
      .join(' · '),
    ...surfaceCrumb(ctx, surface),
    haystack: corpus(surface.name, surfaceTypeLabel(surface.type), surface.description),
    nav: { href: featureHref(ctx.featureId, { surface: surfaceId }) }
  });

  for (const def of surface.stateDefinitions) {
    const title = humanizeStatePath(def.path);
    push({
      id: `state:${ctx.featureId}:${surfaceId}:${def.id}`,
      kind: 'state',
      title,
      subtitle: [def.type, def.description].filter(Boolean).join(' · '),
      ...surfaceCrumb(ctx, surface),
      haystack: corpus(title, String(def.path), def.type, def.description),
      nav: {
        href: featureHref(ctx.featureId, {
          surface: surfaceId,
          panel: 'state',
          focus: surfaceTabFocus(surfaceId, 'state')
        })
      }
    });
  }

  for (const rule of surface.rules) {
    push({
      id: `rule:${ctx.featureId}:${surfaceId}:${rule.id}`,
      kind: 'rule',
      title: ruleTitle(rule),
      subtitle: `${ruleCategoryLabel(rule.category)} · ${effectSummary(rule.effect)}`,
      ...surfaceCrumb(ctx, surface),
      haystack: corpus(
        rule.description,
        ruleCategoryLabel(rule.category),
        effectSummary(rule.effect)
      ),
      nav: {
        href: featureHref(ctx.featureId, {
          surface: surfaceId,
          panel: 'rules',
          focus: surfaceTabFocus(surfaceId, 'rules')
        })
      }
    });
  }

  for (const invariant of surface.invariants) {
    push({
      id: `invariant:${ctx.featureId}:${surfaceId}:${invariant.id}`,
      kind: 'invariant',
      title: invariant.name,
      subtitle: invariant.message || invariant.description,
      ...surfaceCrumb(ctx, surface),
      haystack: corpus(invariant.name, invariant.message, invariant.description),
      nav: {
        href: featureHref(ctx.featureId, {
          surface: surfaceId,
          panel: 'invariants',
          focus: surfaceTabFocus(surfaceId, 'invariants')
        })
      }
    });
  }

  for (const transition of surface.transitions) {
    const title = transition.label?.trim() || 'Transition';
    push({
      id: `transition:${ctx.featureId}:${surfaceId}:${transition.id}`,
      kind: 'transition',
      title,
      subtitle: transition.description,
      ...surfaceCrumb(ctx, surface),
      haystack: corpus(transition.label, transition.description),
      nav: { href: featureHref(ctx.featureId, { tab: 'transitions' }) }
    });
  }

  for (const action of surface.actions) {
    collectAction(push, action, surface, ctx);
  }
};

const collectAction = (
  push: (doc: SearchDoc) => void,
  action: Action,
  surface: Surface,
  ctx: FeatureContext
): void => {
  const surfaceId = String(surface.id);
  const actionId = String(action.id);
  // Every part of an action deep-links to the action's own card (which renders
  // its parameters, rules, effects, scenarios inline) and pulses it.
  const actionHref = featureHref(ctx.featureId, {
    surface: surfaceId,
    panel: 'actions',
    focus: actionFocus(actionId)
  });

  push({
    id: `action:${ctx.featureId}:${actionId}`,
    kind: 'action',
    title: action.name,
    subtitle: action.intent,
    ...surfaceCrumb(ctx, surface),
    haystack: corpus(action.name, action.intent, (action.roles ?? []).join(' ')),
    nav: { href: actionHref }
  });

  for (const parameter of action.parameters) {
    push({
      id: `parameter:${ctx.featureId}:${actionId}:${parameter.id}`,
      kind: 'parameter',
      title: parameter.name,
      subtitle: [parameter.type, parameter.description].filter(Boolean).join(' · '),
      ...surfaceCrumb(ctx, surface),
      haystack: corpus(parameter.name, parameter.type, parameter.description),
      nav: { href: actionHref }
    });
  }

  for (const rule of action.rules) {
    push({
      id: `rule:${ctx.featureId}:${actionId}:${rule.id}`,
      kind: 'rule',
      title: ruleTitle(rule),
      subtitle: `${ruleCategoryLabel(rule.category)} · ${effectSummary(rule.effect)}`,
      ...surfaceCrumb(ctx, surface),
      haystack: corpus(
        rule.description,
        ruleCategoryLabel(rule.category),
        effectSummary(rule.effect)
      ),
      nav: { href: actionHref }
    });
  }

  const effects: readonly Effect[] = [
    ...action.effects,
    ...(action.onBlockedEffects ?? [])
  ];
  for (const effect of effects) {
    push({
      id: `effect:${ctx.featureId}:${actionId}:${effect.id}`,
      kind: 'effect',
      title: effectSummary(effect),
      subtitle: `${effectTypeLabel(effect.type)} · ${action.name}`,
      ...surfaceCrumb(ctx, surface),
      haystack: corpus(effectSummary(effect), effectTypeLabel(effect.type), effect.description),
      nav: { href: actionHref }
    });
  }

  for (const invariant of action.invariants) {
    push({
      id: `invariant:${ctx.featureId}:${actionId}:${invariant.id}`,
      kind: 'invariant',
      title: invariant.name,
      subtitle: invariant.message || invariant.description,
      ...surfaceCrumb(ctx, surface),
      haystack: corpus(invariant.name, invariant.message, invariant.description),
      nav: { href: actionHref }
    });
  }

  for (const scenario of action.scenarios ?? []) {
    push({
      id: `scenario:${ctx.featureId}:${actionId}:${scenario.id}`,
      kind: 'scenario',
      title: scenario.name,
      subtitle: [scenario.description, `${action.name} scenario`]
        .filter(Boolean)
        .join(' · '),
      ...surfaceCrumb(ctx, surface),
      haystack: corpus(scenario.name, scenario.description, action.name),
      nav: { href: actionHref }
    });
  }
};

const collectEntityField = (
  push: (doc: SearchDoc) => void,
  field: EntityField,
  entityId: string,
  entityTitle: string,
  ctx: FeatureContext,
  prefix = ''
): void => {
  const path = prefix ? `${prefix}.${field.name}` : field.name;
  push({
    id: `entity-field:${ctx.featureId}:${entityId}:${path}`,
    kind: 'entity-field',
    title: field.name,
    subtitle: [field.type, entityTitle, field.description].filter(Boolean).join(' · '),
    ...featureCrumb(ctx),
    haystack: corpus(field.name, field.type, entityTitle, field.description, field.path),
    nav: { href: featureHref(ctx.featureId, { tab: 'data' }) }
  });
  for (const child of field.fields ?? []) {
    collectEntityField(push, child, entityId, entityTitle, ctx, path);
  }
  if (field.items) {
    collectEntityField(push, field.items, entityId, entityTitle, ctx, `${path}[]`);
  }
};
