import type { Action } from '$features/behavior-model/domain/entities/Action';
import { committedActions } from '$features/behavior-model/domain/entities/Action';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Invariant } from '$features/behavior-model/domain/entities/Invariant';
import type { Surface } from '$features/behavior-model/domain/entities/Surface';
import type { Project } from '$features/projects/domain/entities/Project';
import type { Effect } from '$features/behavior-model/domain/value-objects/Effect';
import { humanizeStatePath } from '$features/behavior-model/domain/value-objects/humanize';
import type {
  DigestDetailLevel,
  DigestLine,
  DigestScope,
  DigestSection,
  DigestSpec
} from '../DigestSpec';
import type { DigestProjector, DigestScopeRef, DigestSource } from '../ports/DigestProjector';

/**
 * Projects one scope of the behavior model into a plain-language `DigestSpec`.
 *
 * The prose is derived deterministically from the model, never generated: a
 * capability line reuses each action's own intent, its block rules' human
 * `reason` text as guards, and its effects/events; a guardrail line reuses an
 * invariant's `message`; a navigation line reuses a transition's label. So the
 * summary can never describe behavior that is not in the spec.
 *
 * Every line carries the feature + surface it came from, so the reader can jump
 * from a sentence straight to that element in the editor.
 *
 * Pure and total: reads the model, returns a spec, mutates nothing, and yields
 * an empty digest (rather than throwing) when the scope cannot be resolved.
 */

const SECTION_HEADINGS: Record<DigestSection['kind'], string> = {
  features: 'Features',
  capabilities: 'What you can do here',
  guardrails: 'What always holds',
  navigation: 'Where you can go'
};

const capitalizeFirst = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** The first sentence of a description, for a one-line-per-feature project glance. */
const firstSentence = (text: string): string => {
  const trimmed = text.trim();
  const match = /^(.*?[.!?])(\s|$)/.exec(trimmed);
  return match?.[1] ?? trimmed;
};

const isExpression = (value: unknown): boolean =>
  typeof value === 'object' && value !== null && typeof (value as { kind?: unknown }).kind === 'string';

const formatValue = (value: unknown): string => {
  if (value === null || value === undefined) return 'nothing';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (typeof value === 'string') return `"${value}"`;
  return 'a new value';
};

/** A verb phrase for what an effect does, or null for effects with no reader-facing verb. */
const describeEffect = (effect: Effect, surfaceNameById: ReadonlyMap<string, string>): string | null => {
  switch (effect.type) {
    case 'set_state':
      return isExpression(effect.value)
        ? `updates ${humanizeStatePath(String(effect.path))}`
        : `sets ${humanizeStatePath(String(effect.path))} to ${formatValue(effect.value)}`;
    case 'show_message':
      return `shows ${effect.tone ? `a ${effect.tone}` : 'a'} message`;
    case 'transition_surface':
      return `opens ${surfaceNameById.get(String(effect.target)) ?? 'another surface'}`;
    case 'append_to_list':
      return `adds to ${humanizeStatePath(String(effect.path))}`;
    case 'remove_from_list':
      return `removes from ${humanizeStatePath(String(effect.path))}`;
    case 'update_list_item':
      return `updates an item in ${humanizeStatePath(String(effect.path))}`;
    case 'advance_time':
      return 'advances time';
    case 'invoke_operation':
      return `calls ${effect.operation}`;
    case 'emit_event': // emitted events are reported on their own clause
    case 'block_action': // block reasons are reported as guards
    case 'allow_action':
      return null;
  }
};

/** The human guard phrases for an action: block-rule reasons plus required states. */
const guardsOf = (action: Action): string[] => {
  const guards = action.rules
    .filter((rule) => rule.effect.type === 'block_action')
    .map((rule) => (rule.effect as { reason: string }).reason);
  if (action.requiredStates.length > 0) {
    guards.push(`needs ${action.requiredStates.map((path) => humanizeStatePath(String(path))).join(', ')}`);
  }
  return guards;
};

/** An action paired with the surface it lives on, so lines can deep-link. */
type ActionOnSurface = { readonly action: Action; readonly surfaceId: string };
/** An invariant paired with its surface (absent for a feature-wide invariant). */
type GuardrailItem = { readonly invariant: Invariant; readonly surfaceId?: string };

/**
 * The sub-facts of a capability, each a short phrase for its own bullet: at full
 * detail every effect and the emitted events, then the guards at standard/full.
 * Kept as separate list items so they never run together into one sentence.
 */
const capabilityDetails = (
  action: Action,
  level: DigestDetailLevel,
  surfaceNameById: ReadonlyMap<string, string>
): string[] => {
  const details: string[] = [];
  if (level === 'full') {
    for (const effect of action.effects) {
      const phrase = describeEffect(effect, surfaceNameById);
      if (phrase) details.push(capitalizeFirst(phrase));
    }
    if (action.emittedEvents.length > 0) {
      details.push(`Emits ${action.emittedEvents.map(String).join(', ')}`);
    }
  }
  for (const guard of guardsOf(action)) details.push(`Guard: ${guard}`);
  return details;
};

const capabilityLine = (
  action: Action,
  level: DigestDetailLevel,
  surfaceNameById: ReadonlyMap<string, string>,
  featureId: string,
  surfaceId: string
): DigestLine => {
  const details = level === 'glance' ? [] : capabilityDetails(action, level, surfaceNameById);
  return {
    label: action.name,
    // The lead is just the action's intent; effects, events, and guards live in
    // `details` as their own bullets rather than being appended into a run-on.
    text: level === 'glance' ? '' : action.intent.trim(),
    sourceElementId: String(action.id),
    sourceElementType: 'action',
    sourceFeatureId: featureId,
    sourceSurfaceId: surfaceId,
    ...(details.length > 0 ? { details } : {})
  };
};

const capabilitiesSection = (
  items: readonly ActionOnSurface[],
  level: DigestDetailLevel,
  surfaceNameById: ReadonlyMap<string, string>,
  featureId: string
): DigestSection | null => {
  if (items.length === 0) return null;
  // One list item per action; the level controls how much each item says (glance
  // names them; standard adds intent + guards; full adds effects + events too).
  const lines: DigestLine[] = items.map(({ action, surfaceId }) =>
    capabilityLine(action, level, surfaceNameById, featureId, surfaceId)
  );
  return { kind: 'capabilities', heading: SECTION_HEADINGS.capabilities, lines };
};

const guardrailsSection = (
  items: readonly GuardrailItem[],
  featureId: string
): DigestSection | null => {
  if (items.length === 0) return null;
  const lines: DigestLine[] = items.map(({ invariant, surfaceId }) => ({
    label: invariant.name,
    text: invariant.message,
    sourceElementId: String(invariant.id),
    sourceElementType: 'invariant',
    sourceFeatureId: featureId,
    sourceSurfaceId: surfaceId
  }));
  return { kind: 'guardrails', heading: SECTION_HEADINGS.guardrails, lines };
};

const navigationSection = (
  surfaces: readonly Surface[],
  surfaceNameById: ReadonlyMap<string, string>,
  featureId: string
): DigestSection | null => {
  const lines: DigestLine[] = [];
  const nameOf = (id: string): string => surfaceNameById.get(id) ?? 'another surface';

  for (const surface of surfaces) {
    const from = surface.name;
    const surfaceId = String(surface.id);
    for (const transition of surface.transitions) {
      lines.push({
        text: `${from} to ${nameOf(String(transition.target))}${transition.label ? ` (${transition.label})` : ''}`,
        sourceElementId: String(transition.id),
        sourceElementType: 'transition',
        sourceFeatureId: featureId,
        sourceSurfaceId: surfaceId
      });
    }
    for (const action of committedActions(surface.actions)) {
      for (const effect of action.effects) {
        if (effect.type === 'transition_surface') {
          lines.push({
            text: `${from} to ${nameOf(String(effect.target))} (${action.name})`,
            sourceElementId: String(action.id),
            sourceElementType: 'action',
            sourceFeatureId: featureId,
            sourceSurfaceId: surfaceId
          });
        }
      }
    }
  }

  if (lines.length === 0) return null;
  return { kind: 'navigation', heading: SECTION_HEADINGS.navigation, lines };
};

type ResolvedScope = {
  readonly scope: DigestScope;
  readonly title: string;
  readonly purposeLine: string;
  readonly actionItems: readonly ActionOnSurface[];
  readonly guardrails: readonly GuardrailItem[];
  /** Surfaces whose navigation the digest covers. */
  readonly navSurfaces: readonly Surface[];
};

const EMPTY: ResolvedScope = {
  scope: 'feature',
  title: '',
  purposeLine: '',
  actionItems: [],
  guardrails: [],
  navSurfaces: []
};

const committedOn = (surface: Surface): ActionOnSurface[] =>
  committedActions(surface.actions).map((action) => ({ action, surfaceId: String(surface.id) }));

const resolveScope = (feature: Feature, ref: DigestScopeRef): ResolvedScope => {
  if (ref.kind === 'feature') {
    return {
      scope: 'feature',
      title: feature.name,
      purposeLine: feature.description ?? '',
      actionItems: feature.surfaces.flatMap(committedOn),
      guardrails: [
        ...(feature.featureInvariants ?? []).map((invariant) => ({ invariant })),
        ...feature.surfaces.flatMap((surface) =>
          surface.invariants.map((invariant) => ({ invariant, surfaceId: String(surface.id) }))
        )
      ],
      navSurfaces: feature.surfaces
    };
  }
  if (ref.kind === 'project') return EMPTY; // handled before resolveScope

  const surface = feature.surfaces.find((s) => String(s.id) === ref.surfaceId);
  if (!surface) return EMPTY;
  const surfaceId = String(surface.id);

  if (ref.kind === 'surface') {
    return {
      scope: 'surface',
      title: surface.name,
      purposeLine: surface.description ?? '',
      actionItems: committedOn(surface),
      guardrails: surface.invariants.map((invariant) => ({ invariant, surfaceId })),
      navSurfaces: [surface]
    };
  }

  const action = surface.actions.find((a) => String(a.id) === ref.actionId);
  if (!action) return EMPTY;
  // An action scope is summarized as a one-surface digest holding just that action,
  // so the same section builders describe it without a special code path.
  return {
    scope: 'action',
    title: action.name,
    purposeLine: action.intent,
    actionItems: [{ action, surfaceId }],
    guardrails: action.invariants.map((invariant) => ({ invariant, surfaceId })),
    navSurfaces: [{ ...surface, actions: [action] }]
  };
};

/** A whole project at a glance: one clickable line per feature. */
const buildProjectDigest = (
  features: readonly Feature[],
  project: Project | undefined,
  level: DigestDetailLevel
): DigestSpec => {
  const lines: DigestLine[] = features.map((feature) => ({
    label: feature.name,
    text: level === 'glance' ? '' : firstSentence(feature.description ?? ''),
    sourceElementId: String(feature.id),
    sourceElementType: 'feature',
    sourceFeatureId: String(feature.id)
  }));
  const sections: DigestSection[] =
    lines.length > 0 ? [{ kind: 'features', heading: SECTION_HEADINGS.features, lines }] : [];
  return {
    scope: 'project',
    detailLevel: level,
    title: project?.name ?? 'Project',
    purposeLine: project?.description ?? '',
    sections
  };
};

export const buildDigest = (source: DigestSource): DigestSpec => {
  const level: DigestDetailLevel = source.detailLevel ?? 'standard';
  const { scope } = source;

  if (scope.kind === 'project') return buildProjectDigest(source.features, source.project, level);

  const feature = source.features.find((f) => String(f.id) === scope.featureId);
  if (!feature) {
    return { scope: scope.kind, detailLevel: level, title: '', purposeLine: '', sections: [] };
  }

  const featureId = String(feature.id);
  const surfaceNameById = new Map<string, string>(
    feature.surfaces.map((surface) => [String(surface.id), surface.name])
  );
  const resolved = resolveScope(feature, scope);

  const sections: DigestSection[] = [];
  const capabilities = capabilitiesSection(resolved.actionItems, level, surfaceNameById, featureId);
  if (capabilities) sections.push(capabilities);

  if (level !== 'glance') {
    const guardrails = guardrailsSection(resolved.guardrails, featureId);
    if (guardrails) sections.push(guardrails);
  }
  if (level === 'full') {
    const navigation = navigationSection(resolved.navSurfaces, surfaceNameById, featureId);
    if (navigation) sections.push(navigation);
  }

  return {
    scope: resolved.scope,
    detailLevel: level,
    title: resolved.title,
    purposeLine: resolved.purposeLine,
    sections
  };
};

/** The single digest projector, behind the `DigestProjector` port for injection. */
export const digestProjector: DigestProjector = { project: buildDigest };
