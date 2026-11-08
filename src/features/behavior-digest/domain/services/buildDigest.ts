import type { Action } from '$features/behavior-model/domain/entities/Action';
import {
  committedActions,
  effectiveActor,
  isOffered
} from '$features/behavior-model/domain/entities/Action';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Invariant } from '$features/behavior-model/domain/entities/Invariant';
import type { Surface } from '$features/behavior-model/domain/entities/Surface';
import type { Project } from '$features/projects/domain/entities/Project';
import type { Effect } from '$features/behavior-model/domain/value-objects/Effect';
import { humanizeStatePath } from '$features/behavior-model/domain/value-objects/humanize';
import { NBSP, numberText, quoteName, truthText, type ReportLanguage } from '$shared/language';
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
 *
 * Every sentence the digest writes itself (headings, connectives, effect verbs,
 * guard labels) follows the spec's language; what comes from the model (an
 * intent, a reason, a message, a label, a name) is carried exactly as authored.
 * English is the default and reads byte for byte as it always did.
 */

const SECTION_HEADINGS: Record<ReportLanguage, Record<DigestSection['kind'], string>> = {
  en: {
    features: 'Features',
    capabilities: 'What you can do here',
    guardrails: 'What always holds',
    navigation: 'Where you can go'
  },
  fr: {
    features: 'Fonctionnalités',
    capabilities: 'Ce que vous pouvez faire ici',
    guardrails: 'Ce qui reste toujours vrai',
    navigation: 'Où vous pouvez aller'
  }
};

/** A French list: "a", "a et b", "a, b et c". */
const frenchJoin = (items: readonly string[]): string =>
  items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} et ${items[items.length - 1] as string}`;

/** A model name quoted the French way: « name ». */
const q = (name: string): string => quoteName('fr', name);

/** "l'état « X »" for one path, "les états « X » et « Y »" from two. */
const frenchStates = (paths: readonly string[]): string =>
  paths.length === 1 ? `l'état ${q(paths[0] as string)}` : `les états ${frenchJoin(paths.map(q))}`;

/** "l'état « X »" for a state path of the model, humanized as in English. */
const frenchState = (path: unknown): string => `l'état ${q(humanizeStatePath(String(path)))}`;

const capitalizeFirst = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** The first sentence of a description, for a one-line-per-feature project glance. */
const firstSentence = (text: string): string => {
  const trimmed = text.trim();
  const match = /^(.*?[.!?])(\s|$)/.exec(trimmed);
  return match?.[1] ?? trimmed;
};

const isExpression = (value: unknown): boolean =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { kind?: unknown }).kind === 'string';

const formatValue = (value: unknown, lang: ReportLanguage = 'en'): string => {
  if (lang === 'fr') {
    if (value === null || value === undefined) return 'rien';
    if (typeof value === 'boolean') return truthText('fr', value);
    if (typeof value === 'number') return numberText('fr', value);
    if (typeof value === 'string') return quoteName('fr', value);
    return 'une nouvelle valeur';
  }
  if (value === null || value === undefined) return 'nothing';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (typeof value === 'string') return `"${value}"`;
  return 'a new value';
};

const FRENCH_TONES: Record<
  NonNullable<Extract<Effect, { type: 'show_message' }>['tone']>,
  string
> = {
  info: "un message d'information",
  success: 'un message de réussite',
  warning: "un message d'avertissement",
  error: "un message d'erreur"
};

/** The French verb phrase for what an effect does (same meaning as the English one). */
const describeEffectFr = (
  effect: Effect,
  surfaceNameById: ReadonlyMap<string, string>
): string | null => {
  switch (effect.type) {
    case 'set_state': {
      const state = frenchState(effect.path);
      if (isExpression(effect.value)) return `met à jour ${state}`;
      if (effect.value === null || effect.value === undefined) return `vide ${state}`;
      return `passe ${state} à ${formatValue(effect.value, 'fr')}`;
    }
    case 'show_message':
      return `affiche ${effect.tone ? FRENCH_TONES[effect.tone] : 'un message'}`;
    case 'transition_surface': {
      const target = surfaceNameById.get(String(effect.target));
      return target !== undefined ? `ouvre la surface ${q(target)}` : 'ouvre une autre surface';
    }
    case 'append_to_list':
      return `ajoute un élément à ${frenchState(effect.path)}`;
    case 'remove_from_list':
      return `retire un élément de ${frenchState(effect.path)}`;
    case 'update_list_item':
      return `met à jour un élément de ${frenchState(effect.path)}`;
    case 'advance_time':
      return 'fait avancer le temps';
    case 'invoke_operation':
      return `appelle l'opération ${q(String(effect.operation))}`;
    case 'emit_event':
    case 'block_action':
    case 'allow_action':
    case 'no_feedback':
      return null;
  }
};

/** A verb phrase for what an effect does, or null for effects with no reader-facing verb. */
const describeEffect = (
  effect: Effect,
  surfaceNameById: ReadonlyMap<string, string>,
  lang: ReportLanguage = 'en'
): string | null => {
  if (lang === 'fr') return describeEffectFr(effect, surfaceNameById);
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
    case 'no_feedback': // a silence on the blocked path, nothing a reader is shown
      return null;
  }
};

/**
 * The channels the action declares, in one clause each for what is offered and
 * what is kept off on purpose. Nothing when it declares none: an undeclared
 * channel is not a statement, so the digest does not invent one.
 */
const exposurePhrases = (action: Action, lang: ReportLanguage = 'en'): readonly string[] => {
  const exposures = action.exposures ?? [];
  const offered = exposures
    .filter(isOffered)
    .map((e) => (e.operation ? `${e.channel} (${e.operation})` : e.channel));
  const phrases: string[] = [];
  if (lang === 'fr') {
    if (offered.length === 1) phrases.push(`Accessible par le canal ${offered[0] as string}`);
    if (offered.length > 1) phrases.push(`Accessible par les canaux ${frenchJoin(offered)}`);
    for (const e of exposures) {
      if (e.withheld) {
        // "absente" agrees with "action", the element every capability line is about.
        phrases.push(`Volontairement absente du canal ${e.channel}${NBSP}: ${e.withheld.reason}`);
      }
    }
    return phrases;
  }
  if (offered.length > 0) phrases.push(`Reachable over ${offered.join(', ')}`);
  for (const e of exposures) {
    if (e.withheld) phrases.push(`Kept off ${e.channel}: ${e.withheld.reason}`);
  }
  return phrases;
};

/**
 * Who fires the action, said only when it is not a person: "a person does this"
 * is what a reader assumes of every capability, so repeating it on each line
 * would be noise, while "nobody taps this, a timer does" changes how the rest of
 * the line reads.
 */
const firedByPhrase = (action: Action, lang: ReportLanguage = 'en'): string | null => {
  if (lang === 'fr') {
    switch (effectiveActor(action)) {
      case 'user':
        return null;
      case 'system':
        return 'Déclenchée par le système, pas par une personne';
      case 'schedule':
        return 'Déclenchée selon une planification, pas par une personne';
      case 'event':
        return action.triggeredByEvent !== undefined
          ? `Déclenchée par l'événement ${q(String(action.triggeredByEvent))}, pas par une personne`
          : 'Déclenchée par un événement, pas par une personne';
    }
  }
  switch (effectiveActor(action)) {
    case 'user':
      return null;
    case 'system':
      return 'Fired by the system, not by a person';
    case 'schedule':
      return 'Fired on a schedule, not by a person';
    case 'event':
      return action.triggeredByEvent !== undefined
        ? `Fired by the event ${String(action.triggeredByEvent)}, not by a person`
        : 'Fired by an event, not by a person';
  }
};

/** The human guard phrases for an action: block-rule reasons plus required states. */
const guardsOf = (action: Action, lang: ReportLanguage = 'en'): string[] => {
  const guards = action.rules
    .filter((rule) => rule.effect.type === 'block_action')
    .map((rule) => (rule.effect as { reason: string }).reason);
  if (action.requiredStates.length > 0) {
    const paths = action.requiredStates.map((path) => humanizeStatePath(String(path)));
    guards.push(lang === 'fr' ? `nécessite ${frenchStates(paths)}` : `needs ${paths.join(', ')}`);
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
  surfaceNameById: ReadonlyMap<string, string>,
  lang: ReportLanguage
): string[] => {
  const details: string[] = [];
  const firedBy = firedByPhrase(action, lang);
  if (firedBy) details.push(firedBy);
  details.push(...exposurePhrases(action, lang));
  if (level === 'full') {
    for (const effect of action.effects) {
      const phrase = describeEffect(effect, surfaceNameById, lang);
      if (phrase) details.push(capitalizeFirst(phrase));
    }
    if (action.emittedEvents.length > 0) {
      const events = action.emittedEvents.map(String);
      details.push(
        lang === 'fr'
          ? events.length === 1
            ? `Émet l'événement ${q(events[0] as string)}`
            : `Émet les événements ${frenchJoin(events.map(q))}`
          : `Emits ${events.join(', ')}`
      );
    }
  }
  const guardLabel = lang === 'fr' ? `Garde${NBSP}: ` : 'Guard: ';
  for (const guard of guardsOf(action, lang)) details.push(`${guardLabel}${guard}`);
  return details;
};

const capabilityLine = (
  action: Action,
  level: DigestDetailLevel,
  surfaceNameById: ReadonlyMap<string, string>,
  featureId: string,
  surfaceId: string,
  lang: ReportLanguage
): DigestLine => {
  const details = level === 'glance' ? [] : capabilityDetails(action, level, surfaceNameById, lang);
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
  featureId: string,
  lang: ReportLanguage
): DigestSection | null => {
  if (items.length === 0) return null;
  // One list item per action; the level controls how much each item says (glance
  // names them; standard adds intent + guards; full adds effects + events too).
  const lines: DigestLine[] = items.map(({ action, surfaceId }) =>
    capabilityLine(action, level, surfaceNameById, featureId, surfaceId, lang)
  );
  return { kind: 'capabilities', heading: SECTION_HEADINGS[lang].capabilities, lines };
};

const guardrailsSection = (
  items: readonly GuardrailItem[],
  featureId: string,
  lang: ReportLanguage
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
  return { kind: 'guardrails', heading: SECTION_HEADINGS[lang].guardrails, lines };
};

const navigationSection = (
  surfaces: readonly Surface[],
  surfaceNameById: ReadonlyMap<string, string>,
  featureId: string,
  lang: ReportLanguage
): DigestSection | null => {
  const lines: DigestLine[] = [];

  for (const surface of surfaces) {
    const from = surface.name;
    const surfaceId = String(surface.id);
    // Collapse every route from THIS surface to a given target surface into one
    // "where you can go" entry: a declared transition and every action whose
    // transition_surface effect opens the same surface are the same destination,
    // not N places. Declared transitions are added first, so their label wins
    // the deep-link when both exist.
    const seenTargets = new Set<string>();
    const add = (
      target: string,
      sourceElementId: string,
      sourceElementType: NonNullable<DigestLine['sourceElementType']>,
      label: string | undefined
    ): void => {
      // Only real surface-to-surface navigation belongs here. A target that
      // does not resolve to a surface in this feature — a dangling id, or a
      // non-navigation edge whose target is not a surface at all — is not a
      // place the reader can go, so drop it rather than render a mislabelled
      // "… to another surface" line (the old fallback produced N of those).
      const targetName = surfaceNameById.get(target);
      if (targetName === undefined || seenTargets.has(target)) return;
      seenTargets.add(target);
      lines.push({
        text:
          lang === 'fr'
            ? `${q(from)} vers ${q(targetName)}${label ? ` (${label})` : ''}`
            : `${from} to ${targetName}${label ? ` (${label})` : ''}`,
        sourceElementId,
        sourceElementType,
        sourceFeatureId: featureId,
        sourceSurfaceId: surfaceId
      });
    };

    for (const transition of surface.transitions) {
      add(String(transition.target), String(transition.id), 'transition', transition.label);
    }
    for (const action of committedActions(surface.actions)) {
      for (const effect of action.effects) {
        if (effect.type === 'transition_surface') {
          add(String(effect.target), String(action.id), 'action', action.name);
        }
      }
    }
  }

  if (lines.length === 0) return null;
  return { kind: 'navigation', heading: SECTION_HEADINGS[lang].navigation, lines };
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
  level: DigestDetailLevel,
  lang: ReportLanguage
): DigestSpec => {
  const lines: DigestLine[] = features.map((feature) => ({
    label: feature.name,
    text: level === 'glance' ? '' : firstSentence(feature.description ?? ''),
    sourceElementId: String(feature.id),
    sourceElementType: 'feature',
    sourceFeatureId: String(feature.id)
  }));
  const sections: DigestSection[] =
    lines.length > 0 ? [{ kind: 'features', heading: SECTION_HEADINGS[lang].features, lines }] : [];
  return {
    scope: 'project',
    detailLevel: level,
    title: project?.name ?? (lang === 'fr' ? 'Projet' : 'Project'),
    purposeLine: project?.description ?? '',
    sections
  };
};

export const buildDigest = (source: DigestSource): DigestSpec => {
  const level: DigestDetailLevel = source.detailLevel ?? 'standard';
  const lang: ReportLanguage = source.language ?? 'en';
  const { scope } = source;

  if (scope.kind === 'project') {
    return buildProjectDigest(source.features, source.project, level, lang);
  }

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
  const capabilities = capabilitiesSection(
    resolved.actionItems,
    level,
    surfaceNameById,
    featureId,
    lang
  );
  if (capabilities) sections.push(capabilities);

  if (level !== 'glance') {
    const guardrails = guardrailsSection(resolved.guardrails, featureId, lang);
    if (guardrails) sections.push(guardrails);
  }
  if (level === 'full') {
    const navigation = navigationSection(resolved.navSurfaces, surfaceNameById, featureId, lang);
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
