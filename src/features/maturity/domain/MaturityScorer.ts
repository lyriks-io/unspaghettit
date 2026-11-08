import type { Action } from '$features/behavior-model/domain/entities/Action';
import { committedActions, effectiveActor } from '$features/behavior-model/domain/entities/Action';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Surface } from '$features/behavior-model/domain/entities/Surface';
import { isExpression, type Expression } from '$features/behavior-model/domain/value-objects/Expression';
import type { Effect } from '$features/behavior-model/domain/value-objects/Effect';
import {
  flattenLeafConditions,
  isParamLeft,
  type RuleCondition
} from '$features/behavior-model/domain/value-objects/RuleCondition';
import type { StatePath } from '$features/behavior-model/domain/value-objects/StatePath';
import {
  actionEmittedEvents,
  actionStateReads as semanticActionStateReads,
  actionStateWrites
} from '$features/behavior-model/domain/services/BehaviorSemantics';
import type {
  CheckLocation,
  MaturityIssue,
  MaturityReport,
  PassedCheck,
  SurfacePanelTab
} from './MaturityReport';
import { combineReports, emptyReport } from './MaturityReport';
import { frenchTypography, NBSP, quoteName, type ReportLanguage } from '$shared/language';

/**
 * The text of a check in the report's language. English is returned as is (a
 * caller that passes no language reads exactly what it always read); French
 * gets its typography (no-break spaces before : ; ! ? and inside « »).
 */
const say = (lang: ReportLanguage, en: string, fr: string): string =>
  lang === 'fr' ? frenchTypography(fr) : en;

/**
 * The same, for a French sentence that carries names from the model (state
 * paths, event names). It is taken as written: its no-break spaces are
 * authored explicitly around the names, because running the typography pass
 * over the whole sentence could rewrite a space inside a name.
 */
const sayNamed = (lang: ReportLanguage, en: string, fr: string): string =>
  lang === 'fr' ? fr : en;

/** French plural: the singular up to 1 ("0 règle", "1 règle"), plural from 2. */
const frCount = (n: number, one: string, many: string): string =>
  `${n} ${n >= 2 ? many : one}`;

/**
 * A short list of model names (state paths, event names) for a French
 * sentence: each one quoted, at most three, an ellipsis when more exist. The
 * sentence ends on the ellipsis or on a period, never on both.
 */
const frNameList = (names: readonly string[], limit = names.length): string => {
  const shown = names.slice(0, limit).map((name) => quoteName('fr', name)).join(', ');
  return names.length > limit ? `${shown}…` : `${shown}.`;
};

/**
 * "<subject> un chemin d'état qui n'est déclaré nulle part dans cette
 * fonctionnalité : « a »." (or the plural from two paths), at most three
 * names shown. The no-break spaces are written here, never by a later pass.
 */
const undeclaredPathsFr = (paths: readonly string[], subject: string): string =>
  `${subject} ${
    paths.length >= 2
      ? "des chemins d'état qui ne sont déclarés nulle part"
      : "un chemin d'état qui n'est déclaré nulle part"
  } dans cette fonctionnalité${NBSP}: ${frNameList(paths, 3)}`;

/** "<subject> un chemin d'état déclaré sur une autre surface : « a »." */
const unsharedPathsFr = (paths: readonly string[], subject: string): string =>
  `${subject} ${
    paths.length >= 2 ? "des chemins d'état déclarés" : "un chemin d'état déclaré"
  } sur une autre surface${NBSP}: ${frNameList(paths, 3)}`;

type Check = {
  readonly area: string;
  readonly weight: number;
  readonly severity: 'critical' | 'recommended';
  readonly passes: boolean;
  readonly message: string;
  /** Short label shown next to a passed check (the "good news" version). */
  readonly passLabel: string;
  readonly tab?: SurfacePanelTab;
};

const reportFromChecks = (
  targetKind: MaturityIssue['targetKind'],
  target: string,
  baseLocation: CheckLocation,
  checks: readonly Check[]
): MaturityReport => {
  let score = 0;
  let maxScore = 0;
  const criticalIssues: MaturityIssue[] = [];
  const recommendedIssues: MaturityIssue[] = [];
  const passedChecks: PassedCheck[] = [];
  for (const check of checks) {
    maxScore += check.weight;
    const location: CheckLocation = {
      ...baseLocation,
      surfacePanelTab: check.tab ?? baseLocation.surfacePanelTab
    };
    if (check.passes) {
      score += check.weight;
      passedChecks.push({
        ...location,
        target,
        targetKind,
        area: check.area,
        message: check.passLabel
      });
      continue;
    }
    const issue: MaturityIssue = {
      ...location,
      target,
      targetKind,
      area: check.area,
      message: check.message,
      severity: check.severity
    };
    if (check.severity === 'critical') {
      criticalIssues.push(issue);
    } else {
      recommendedIssues.push(issue);
    }
  }
  return {
    score,
    maxScore,
    percentage: maxScore === 0 ? 100 : Math.round((score / maxScore) * 100),
    criticalIssues,
    recommendedIssues,
    passedChecks
  };
};

const expressionStateReads = (expression: Expression): StatePath[] => {
  // Defensive: legacy snapshots can hold malformed children (e.g. `right: 1`
  // instead of `{kind:"literal",value:1}`). The normalizer rewrites them on
  // write/import, but we guard here too so the scorer can't crash on data
  // that slipped past either boundary.
  if (!isExpression(expression)) return [];
  switch (expression.kind) {
    case 'state':
      return [expression.path];
    case 'add':
    case 'sub':
    case 'mul':
    case 'div':
    case 'mod':
    case 'min':
    case 'max':
      return [
        ...expressionStateReads(expression.left),
        ...expressionStateReads(expression.right)
      ];
    case 'neg':
    case 'not':
    case 'sum':
    case 'count':
      return expressionStateReads(expression.operand);
    case 'sum_pluck':
      return expressionStateReads(expression.operand);
    case 'count_where':
      return [
        ...expressionStateReads(expression.operand),
        ...expressionStateReads(expression.equals)
      ];
    case 'switch':
      // For each case: flatten the `when` to leaf conditions, collect each
      // leaf's `left` path and any state reads on its `right` Expression,
      // then recurse into the case's `then` Expression. Plus the default.
      return [
        ...expression.cases.flatMap((c) => [
          ...flattenLeafConditions(c.when).flatMap((leaf) => [
            // Skip param-lefts: they reference action parameters, not
            // surface state, so they don't count as a state-read here.
            ...(isParamLeft(leaf.left) ? [] : [leaf.left as StatePath]),
            ...(isExpression(leaf.right) ? expressionStateReads(leaf.right) : [])
          ]),
          ...expressionStateReads(c.then)
        ]),
        ...expressionStateReads(expression.default)
      ];
    case 'literal':
    case 'param':
    case 'const':
      return [];
  }
};

// Recurses into composite conditions and ignores the unconditional case
// (condition === undefined). Each leaf contributes its `.left` and any
// state references buried in an Expression on `.right`.
const conditionStateReads = (
  condition: RuleCondition | undefined
): StatePath[] => {
  const out: StatePath[] = [];
  for (const leaf of flattenLeafConditions(condition)) {
    // Param-left conditions reference action parameters, not surface
    // state; they don't contribute a state-path read here.
    if (!isParamLeft(leaf.left)) out.push(leaf.left as StatePath);
    if (isExpression(leaf.right)) out.push(...expressionStateReads(leaf.right));
  }
  return out;
};

// Every state path an action reads from OR writes to (conditions, set_state targets,
// expression operands, requiredStates). Used to validate paths against surface scope.
const allCapabilityStatePaths = (action: Action): readonly StatePath[] => {
  return [
    ...new Set([
      ...action.requiredStates,
      ...semanticActionStateReads(action),
      ...actionStateWrites(action)
    ])
  ];
};

const allSurfaceRuleStatePaths = (surface: Surface): readonly StatePath[] => {
  const paths = new Set<StatePath>();
  for (const rule of surface.rules) {
    for (const p of conditionStateReads(rule.condition)) paths.add(p);
    if (rule.effect.type === 'set_state') {
      paths.add(rule.effect.path);
      if (isExpression(rule.effect.value))
        for (const p of expressionStateReads(rule.effect.value)) paths.add(p);
    }
  }
  return [...paths];
};

// All state paths visible on a surface: own definitions + paths shared TO this surface
// from any other surface in the feature.
const buildKnownPaths = (surfaceId: string, allSurfaces: readonly Surface[]): ReadonlySet<string> => {
  const paths = new Set<string>();
  for (const surface of allSurfaces) {
    for (const def of surface.stateDefinitions) {
      const isOwn = String(surface.id) === surfaceId;
      const isShared = (def.sharedWith ?? []).map(String).includes(surfaceId);
      if (isOwn || isShared) paths.add(String(def.path));
    }
  }
  return paths;
};

// Every state path declared anywhere in the feature, regardless of sharing.
// Used to distinguish "truly undeclared" (critical) from "declared but not
// shared with this surface" (recommended).
const buildAllDeclaredPaths = (allSurfaces: readonly Surface[]): ReadonlySet<string> => {
  const paths = new Set<string>();
  for (const surface of allSurfaces) {
    for (const def of surface.stateDefinitions) {
      paths.add(String(def.path));
    }
  }
  return paths;
};

const effectUsesExpression = (effect: Effect): boolean =>
  effect.type === 'set_state' && isExpression(effect.value);

const conditionUsesExpression = (c: RuleCondition | undefined): boolean =>
  flattenLeafConditions(c).some((leaf) => isExpression(leaf.right));

const capabilityUsesExpression = (action: Action): boolean =>
  action.rules.some((rule) => conditionUsesExpression(rule.condition)) ||
  action.invariants.some((invariant) => conditionUsesExpression(invariant.condition)) ||
  [...action.effects, ...(action.onBlockedEffects ?? [])].some(effectUsesExpression);

const surfaceTransitionTargets = (surface: Surface): readonly string[] => {
  const targets = new Set<string>();
  for (const action of surface.actions) {
    for (const effect of [...action.effects, ...(action.onBlockedEffects ?? [])]) {
      if (effect.type === 'transition_surface' && effect.target) targets.add(String(effect.target));
    }
    for (const rule of action.rules) {
      if (rule.effect.type === 'transition_surface' && rule.effect.target) {
        targets.add(String(rule.effect.target));
      }
    }
  }
  for (const rule of surface.rules) {
    if (rule.effect.type === 'transition_surface' && rule.effect.target) {
      targets.add(String(rule.effect.target));
    }
  }
  return [...targets];
};

const emittedEventNames = (feature: Feature): readonly string[] => {
  const names = new Set<string>();
  for (const surface of feature.surfaces) {
    for (const action of surface.actions) {
      for (const event of action.emittedEvents) names.add(String(event));
      for (const effect of [...action.effects, ...(action.onBlockedEffects ?? [])]) {
        if (effect.type === 'emit_event') names.add(String(effect.event));
      }
      for (const rule of action.rules) {
        if (rule.effect.type === 'emit_event') names.add(String(rule.effect.event));
      }
    }
    for (const rule of surface.rules) {
      if (rule.effect.type === 'emit_event') names.add(String(rule.effect.event));
    }
  }
  return [...names];
};

const hasResourceReferences = (feature: Feature): boolean =>
  feature.surfaces.some((surface) =>
    surface.actions.some((action) =>
      action.parameters.some((parameter) => parameter.resourceId !== undefined)
    )
  );

const hasScenarioExpectations = (feature: Feature): boolean =>
  feature.surfaces.some((surface) =>
    surface.actions.some((action) =>
      (action.scenarios ?? []).some(
        (scenario) =>
          scenario.expectedStatus !== undefined ||
          (scenario.expectedAssertions?.length ?? 0) > 0
      )
    )
  );

const capabilityChecks = (
  action: Action,
  knownPaths?: ReadonlySet<string>,
  allDeclaredPaths?: ReadonlySet<string>,
  lang: ReportLanguage = 'en'
): readonly Check[] => {
  const sensitiveCategories = new Set(['security', 'permissions', 'compliance']);
  const hasPermissionRule = action.rules.some((r) => sensitiveCategories.has(r.category));
  const writesState = actionStateWrites(action).some((path) => String(path) !== 'clock.now');
  const securityRelevantMutation = writesState &&
    (action.roles ?? []).some((role) => role === 'persistence' || role === 'destructive');
  const hasValidationRule = action.rules.some((r) => r.category === 'validation');
  const hasParameterValidations = action.parameters.some(
    (p) => p.validations !== undefined && p.validations.length > 0
  );
  const hasValidatableParam = action.parameters.some(
    (p) =>
      p.type === 'string' ||
      p.type === 'number' ||
      p.type === 'email' ||
      p.type === 'url' ||
      p.type === 'date' ||
      p.type === 'time' ||
      p.type === 'timestamp' ||
      p.type === 'object' ||
      p.type === 'array' ||
      p.type === 'geolocation'
  );
  const hasInputs = action.parameters.length > 0;
  const hasParameterDefaults = action.parameters.every(
    (p) => p.required || p.defaultValue !== undefined
  );
  const enumParametersConfigured = action.parameters.every(
    (p) => p.type !== 'enum' || (p.enumValues !== undefined && p.enumValues.length > 0)
  );
  const stateReads = semanticActionStateReads(action);
  const declaredRequiredStates = new Set(action.requiredStates.map(String));
  const hasRequiredStateCoverage =
    stateReads.length === 0 ||
    action.requiredStates.length === 0 ||
    stateReads.every((path) => declaredRequiredStates.has(String(path)));
  const emittedEventsFromEffects = actionEmittedEvents(action);
  const emitsEventsFromEffects = emittedEventsFromEffects.length > 0;
  const declaredEventNames = new Set(action.emittedEvents.map(String));
  const undeclaredEmissions = emittedEventsFromEffects.filter(
    (event) => !declaredEventNames.has(String(event))
  );
  // Any on-block effect answers "what happens on a blocked run", a `no_feedback`
  // one included: it is the author saying "nothing, on purpose", which is an
  // answer. It therefore satisfies the check for every actor.
  const hasBlockedFallback = (action.onBlockedEffects ?? []).length > 0;
  // The check asks what a PERSON sees when the action refuses. An action no
  // person fires (system, schedule, event) has nobody to tell, so it is waived
  // there instead of pushing authors to invent messages the product never shows.
  const actor = effectiveActor(action);
  const firedByAPerson = actor === 'user';
  const scenarioRelevantRole = (action.roles ?? []).some((role) =>
    ['primary', 'destructive', 'async', 'persistence'].includes(role)
  );
  const hasComplexBehavior =
    action.rules.length > 1 ||
    action.effects.length > 1 ||
    action.invariants.length > 0 ||
    hasInputs ||
    scenarioRelevantRole;
  const scenarioCount = action.scenarios?.length ?? 0;
  const hasScenarioCoverage = !hasComplexBehavior || scenarioCount > 0;
  const hasExpressionUse = capabilityUsesExpression(action);

  return [
    {
      area: 'intent',
      weight: 1,
      severity: 'critical',
      passes: action.intent.trim().length > 0,
      message: say(
        lang,
        'Add a short description of what this action is for.',
        'Ajoutez une courte description de ce à quoi sert cette action.'
      ),
      passLabel: say(lang, 'Has a description', 'Possède une description'),
      tab: 'actions'
    },
    {
      area: 'rules',
      weight: 1,
      severity: 'recommended',
      passes: action.rules.length > 0,
      message: say(
        lang,
        'Add rules to control when this action can or cannot run.',
        "Ajoutez des règles qui décident quand cette action peut s'exécuter ou non."
      ),
      passLabel: say(
        lang,
        `Has ${action.rules.length} rule${action.rules.length === 1 ? '' : 's'}`,
        `Possède ${frCount(action.rules.length, 'règle', 'règles')}`
      ),
      tab: 'actions'
    },
    {
      area: 'effects',
      weight: 1,
      severity: 'critical',
      passes: action.effects.length > 0 || action.rules.length > 0,
      message: say(
        lang,
        'Nothing happens when this runs. Add an effect or a rule.',
        "Rien ne se passe quand cette action s'exécute. Ajoutez un effet ou une règle."
      ),
      passLabel: say(lang, 'Has effects or rules', 'Possède des effets ou des règles'),
      tab: 'actions'
    },
    {
      area: 'events',
      weight: 1,
      severity: 'recommended',
      passes:
        action.emittedEvents.length > 0 ||
        emitsEventsFromEffects,
      message: say(
        lang,
        'Other parts of your feature cannot react when this runs. Make it emit and declare an event.',
        "Le reste de la fonctionnalité ne peut pas réagir quand cette action s'exécute. Faites-lui émettre un événement et déclarez-le."
      ),
      passLabel:
        action.emittedEvents.length > 0 && emitsEventsFromEffects
          ? say(lang, 'Emits and declares events', 'Émet et déclare des événements')
          : say(lang, 'Has event signaling', 'Signale son exécution par des événements'),
      tab: 'actions'
    },
    {
      area: 'required states',
      weight: 1,
      severity: 'recommended',
      passes: hasRequiredStateCoverage,
      message: say(
        lang,
        'Declare requiredStates so readers and implementation audits know which state this action depends on.',
        "Déclarez requiredStates pour que les lecteurs et les audits d'implémentation sachent de quel état dépend cette action."
      ),
      passLabel:
        action.requiredStates.length === 0
          ? say(lang, 'Required states not declared', 'États requis non déclarés')
          : say(
              lang,
              `Documents ${action.requiredStates.length} required state${
                action.requiredStates.length === 1 ? '' : 's'
              }`,
              `Documente ${frCount(action.requiredStates.length, 'état requis', 'états requis')}`
            ),
      tab: 'actions'
    },
    {
      area: 'event declarations',
      weight: 1,
      severity: 'recommended',
      passes: undeclaredEmissions.length === 0,
      message: sayNamed(
        lang,
        `This action emits event${undeclaredEmissions.length === 1 ? '' : 's'} not listed in emittedEvents: ${undeclaredEmissions.map(String).join(', ')}.`,
        `Cette action émet ${
          undeclaredEmissions.length >= 2 ? 'des événements absents' : 'un événement absent'
        } de la liste emittedEvents${NBSP}: ${frNameList(undeclaredEmissions.map(String))}`
      ),
      passLabel: emitsEventsFromEffects
        ? say(lang, 'Declares emitted events', 'Déclare les événements émis')
        : say(lang, 'No emitted event effects', "Aucun effet n'émet d'événement"),
      tab: 'actions'
    },
    {
      area: 'permissions',
      weight: 1,
      severity: securityRelevantMutation ? 'critical' : 'recommended',
      passes: !securityRelevantMutation || hasPermissionRule,
      message: say(
        lang,
        'This action changes data. Add a rule that decides who is allowed to run it.',
        "Cette action modifie des données. Ajoutez une règle qui décide qui a le droit de l'exécuter."
      ),
      passLabel: securityRelevantMutation
        ? say(lang, 'Has a permission rule', 'Possède une règle de permission')
        : writesState
          ? say(
              lang,
              'Changes transient state; no persistence/destructive role',
              'Modifie un état transitoire, sans rôle « persistence » ni « destructive »'
            )
          : say(
              lang,
              'Does not change data. No permission rule needed',
              'Ne modifie pas de données. Aucune règle de permission nécessaire'
            ),
      tab: 'actions'
    },
    {
      area: 'validation',
      weight: 1,
      severity: 'recommended',
      passes:
        action.parameters.length === 0 ||
        !hasValidatableParam ||
        hasValidationRule ||
        hasParameterValidations,
      message: say(
        lang,
        'Inputs are not checked before this runs. Add a rule with category "validation" or attach validations to a parameter.',
        "Les entrées ne sont pas vérifiées avant l'exécution. Ajoutez une règle de catégorie « validation » ou attachez des validations à un paramètre."
      ),
      passLabel:
        action.parameters.length === 0
          ? say(lang, 'No inputs to validate', 'Aucune entrée à valider')
          : !hasValidatableParam
            ? say(
                lang,
                'Inputs are booleans/enums. No validation needed',
                'Entrées booléennes ou énumérées. Aucune validation nécessaire'
              )
            : say(lang, 'Validates its inputs', 'Valide ses entrées'),
      tab: 'actions'
    },
    {
      area: 'parameters',
      weight: 1,
      severity: 'recommended',
      passes: !hasInputs || (hasParameterDefaults && enumParametersConfigured),
      message: say(
        lang,
        'Make parameter behavior explicit: optional parameters need defaults, and enum parameters need allowed values.',
        'Rendez le comportement des paramètres explicite : un paramètre facultatif demande une valeur par défaut, un paramètre enum demande ses valeurs autorisées.'
      ),
      passLabel: hasInputs
        ? say(
            lang,
            'Parameters have defaults/enum options',
            "Paramètres pourvus de valeurs par défaut et d'options d'énumération"
          )
        : say(lang, 'No parameters', 'Aucun paramètre'),
      tab: 'actions'
    },
    {
      area: 'block handling',
      weight: 1,
      severity: 'recommended',
      passes:
        !firedByAPerson ||
        action.rules.length === 0 ||
        hasBlockedFallback ||
        action.rules.some((rule) => rule.effect.type !== 'allow_action'),
      message: say(
        lang,
        'Add on-block effects when a blocked run should show a message, emit an audit event, or navigate. If a blocked attempt shows nothing on purpose, say so with a no_feedback on-block effect; if no person fires this action, set its actor (system, schedule or event).',
        "Ajoutez des effets en cas de blocage quand une exécution bloquée doit afficher un message, émettre un événement d'audit ou naviguer. Si une tentative bloquée n'affiche volontairement rien, dites-le avec un effet no_feedback en cas de blocage ; si aucune personne ne déclenche cette action, définissez son acteur (system, schedule ou event)."
      ),
      passLabel:
        action.rules.length === 0
          ? say(lang, 'No block paths', 'Aucun chemin de blocage')
          : !firedByAPerson && !hasBlockedFallback
            ? say(
                lang,
                `No person fires it (actor: ${actor}), nothing to show when blocked`,
                `Aucune personne ne la déclenche (acteur : ${actor}), rien à afficher en cas de blocage`
              )
            : say(lang, 'Has block fallback effects', 'Possède des effets en cas de blocage'),
      tab: 'actions'
    },
    {
      area: 'scenarios',
      weight: 1,
      severity: 'recommended',
      passes: hasScenarioCoverage,
      message: say(
        lang,
        'Add at least one scenario for this non-trivial action so examples become regression checks.',
        'Ajoutez au moins un scénario à cette action non triviale pour que ses exemples deviennent des tests de non-régression.'
      ),
      passLabel: hasComplexBehavior
        ? say(
            lang,
            `Has ${scenarioCount} scenario${scenarioCount === 1 ? '' : 's'}`,
            `Possède ${frCount(scenarioCount, 'scénario', 'scénarios')}`
          )
        : say(
            lang,
            'Scenarios optional until added',
            "Scénarios facultatifs tant qu'aucun n'est ajouté"
          ),
      tab: 'actions'
    },
    {
      area: 'expressions',
      weight: 1,
      severity: 'recommended',
      passes: !hasExpressionUse || action.rules.length > 0 || action.effects.length > 0,
      message: say(
        lang,
        'Expression values should live in explicit rules or effects so readers can inspect the calculation.',
        'Les valeurs calculées par une expression doivent vivre dans des règles ou des effets explicites, pour que le lecteur puisse examiner le calcul.'
      ),
      passLabel: hasExpressionUse
        ? say(lang, 'Uses expression values', 'Utilise des valeurs calculées par expression')
        : say(lang, 'No expression values needed', 'Aucune valeur calculée nécessaire'),
      tab: 'actions'
    },
    ...(knownPaths !== undefined
      ? (() => {
          const referenced = allCapabilityStatePaths(action).map(String);
          const undeclared = referenced.filter((p) => !allDeclaredPaths!.has(p));
          const unsharedOnly = referenced.filter(
            (p) => allDeclaredPaths!.has(p) && !knownPaths.has(p)
          );
          return [
            // Truly undefined paths (declared nowhere in the feature) are a
            // real spec gap: the simulator returns undefined, comparisons
            // misbehave. Keep this critical.
            {
              area: 'undefined state',
              weight: 1,
              severity: 'critical' as const,
              passes: undeclared.length === 0,
              message: sayNamed(
                lang,
                `Uses state ${undeclared.length === 1 ? 'path' : 'paths'} not declared anywhere in this feature: ${undeclared.slice(0, 3).join(', ')}${undeclared.length > 3 ? '…' : ''}. Declare ${undeclared.length === 1 ? 'it' : 'them'} on a surface.`,
                `${undeclaredPathsFr(undeclared, 'Cette action utilise')} Déclarez-${undeclared.length >= 2 ? 'les' : 'le'} sur une surface.`
              ),
              passLabel: say(
                lang,
                'All referenced state paths are declared',
                "Tous les chemins d'état référencés sont déclarés"
              ),
              tab: 'actions' as SurfacePanelTab
            },
            // Paths declared on a SIBLING surface without sharedWith are not a
            // runtime bug (the simulator reads from a unified snapshot) but
            // hide a cross-surface dependency. Downgraded from critical to
            // recommended so LLMs aren't blocked by sharedWith hygiene.
            {
              area: 'unshared state',
              weight: 1,
              severity: 'recommended' as const,
              passes: unsharedOnly.length === 0,
              message: sayNamed(
                lang,
                `Reads state ${unsharedOnly.length === 1 ? 'path' : 'paths'} declared on another surface: ${unsharedOnly.slice(0, 3).join(', ')}${unsharedOnly.length > 3 ? '…' : ''}. Add this surface to that StateDefinition's sharedWith to make the dependency explicit.`,
                `${unsharedPathsFr(unsharedOnly, 'Cette action lit')} Ajoutez cette surface au sharedWith de la définition d'état concernée pour rendre la dépendance explicite.`
              ),
              passLabel: say(
                lang,
                'No unshared cross-surface reads',
                "Aucune lecture d'un état non partagé d'une autre surface"
              ),
              tab: 'actions' as SurfacePanelTab
            }
          ];
        })()
      : [])
  ];
};

export const scoreCapability = (
  surface: Surface,
  action: Action,
  allSurfaces?: readonly Surface[],
  language: ReportLanguage = 'en'
): MaturityReport => {
  const knownPaths =
    allSurfaces !== undefined ? buildKnownPaths(String(surface.id), allSurfaces) : undefined;
  const allDeclaredPaths =
    allSurfaces !== undefined ? buildAllDeclaredPaths(allSurfaces) : undefined;
  return reportFromChecks(
    'action',
    action.name,
    {
      surfaceId: surface.id as unknown as string,
      actionId: action.id as unknown as string,
      surfacePanelTab: 'actions'
    },
    capabilityChecks(action, knownPaths, allDeclaredPaths, language)
  );
};

const surfaceChecks = (
  surface: Surface,
  knownPaths?: ReadonlySet<string>,
  allDeclaredPaths?: ReadonlySet<string>,
  lang: ReportLanguage = 'en'
): readonly Check[] => {
  const transitionTargets = surfaceTransitionTargets(surface);
  const hasSharedState = surface.stateDefinitions.some(
    (definition) => definition.sharedWith !== undefined && definition.sharedWith.length > 0
  );
  const hasEnumStateWithoutValues = surface.stateDefinitions.some(
    (definition) =>
      definition.type === 'enum' &&
      (definition.enumValues === undefined || definition.enumValues.length === 0)
  );
  const hasSurfaceWideRules =
    surface.actions.length <= 1 ||
    surface.rules.length > 0 ||
    surface.actions.every((action) => action.rules.length > 0);

  return [
    {
      area: 'actions',
      weight: 1,
      severity: 'critical',
      passes: surface.actions.length > 0,
      message: say(
        lang,
        'Add at least one thing the user can do here.',
        "Ajoutez au moins une chose que l'utilisateur peut faire ici."
      ),
      passLabel: say(
        lang,
        `Has ${surface.actions.length} capabilit${
          surface.actions.length === 1 ? 'y' : 'ies'
        }`,
        `Possède ${frCount(surface.actions.length, 'action', 'actions')}`
      ),
      tab: 'actions'
    },
    {
      area: 'states',
      weight: 1,
      severity: 'recommended',
      // Count shared-in state as "has state". A surface that legitimately
      // operates on state shared from another surface (e.g. a modal that
      // reads/writes the parent screen's payment.* paths) shouldn't be
      // flagged for "no state" just because it doesn't own any natively.
      passes:
        surface.stateDefinitions.length > 0 ||
        (knownPaths !== undefined && knownPaths.size > 0),
      message: say(
        lang,
        'Add some state - the data your rules read to decide what happens.',
        'Ajoutez un état : les données que vos règles lisent pour décider de ce qui se passe.'
      ),
      passLabel: say(
        lang,
        `Has ${surface.stateDefinitions.length} state value${
          surface.stateDefinitions.length === 1 ? '' : 's'
        }`,
        `Possède ${frCount(surface.stateDefinitions.length, "valeur d'état", "valeurs d'état")}`
      ),
      tab: 'state'
    },
    {
      area: 'state metadata',
      weight: 1,
      severity: 'recommended',
      passes:
        surface.stateDefinitions.length === 0 ||
        !hasEnumStateWithoutValues,
      message: say(
        lang,
        'Document state definitions with descriptions, and give enum states their allowed values.',
        "Documentez les définitions d'état par des descriptions, et donnez aux états enum leurs valeurs autorisées."
      ),
      passLabel:
        surface.stateDefinitions.length === 0
          ? say(lang, 'No state to document', 'Aucun état à documenter')
          : say(lang, 'State definitions are documented', "Les définitions d'état sont documentées"),
      tab: 'state'
    },
    {
      area: 'shared state',
      weight: 1,
      severity: 'recommended',
      passes:
        surface.stateDefinitions.length <= 1 ||
        hasSharedState ||
        surface.stateDefinitions.every((definition) => definition.sharedWith === undefined),
      message: say(
        lang,
        'Shared state is declared but incomplete. Check sharedWith links on state definitions.',
        "Un état partagé est déclaré mais incomplet. Vérifiez les liens sharedWith des définitions d'état."
      ),
      passLabel: hasSharedState
        ? say(lang, 'Declares shared state', 'Déclare un état partagé')
        : say(lang, 'No obvious shared state', 'Aucun état partagé évident'),
      tab: 'state'
    },
    {
      area: 'surface rules',
      weight: 1,
      severity: 'recommended',
      passes: hasSurfaceWideRules,
      message: say(
        lang,
        'This surface has multiple actions and no visible gating. Add surface rules or action rules.',
        "Cette surface a plusieurs actions et aucune garde visible. Ajoutez des règles de surface ou des règles d'action."
      ),
      passLabel:
        surface.actions.length <= 1
          ? say(lang, 'No cross-cutting gate needed', 'Aucune garde transversale nécessaire')
          : say(lang, 'Has surface rules', 'Possède des règles de surface'),
      tab: 'rules'
    },
    {
      area: 'invariants',
      weight: 1,
      severity: 'recommended',
      passes:
        surface.invariants.length > 0 ||
        surface.actions.some((c) => c.invariants.length > 0),
      message: say(
        lang,
        'Add an invariant - a fact that should always be true here, so broken states are caught early.',
        'Ajoutez un invariant : un fait qui doit toujours être vrai ici, pour repérer tôt les états incohérents.'
      ),
      passLabel: say(lang, 'Has invariants', 'Possède des invariants'),
      tab: 'invariants'
    },
    {
      area: 'transitions',
      weight: 1,
      severity: 'recommended',
      passes: transitionTargets.length === 0 || surface.transitions.length > 0,
      message: say(
        lang,
        'This surface navigates through effects. Declare transitions so the graph is visible outside individual actions.',
        'Cette surface navigue par des effets. Déclarez ses transitions pour que le graphe soit visible hors de chaque action.'
      ),
      passLabel:
        transitionTargets.length === 0
          ? say(lang, 'No navigation effects', 'Aucun effet de navigation')
          : say(lang, 'Declares surface transitions', 'Déclare les transitions de la surface'),
      tab: 'actions'
    },
    ...(knownPaths !== undefined
      ? (() => {
          const referenced = allSurfaceRuleStatePaths(surface).map(String);
          const undeclared = referenced.filter((p) => !allDeclaredPaths!.has(p));
          const unsharedOnly = referenced.filter(
            (p) => allDeclaredPaths!.has(p) && !knownPaths.has(p)
          );
          return [
            {
              area: 'undefined state in rules',
              weight: 1,
              severity: 'critical' as const,
              passes: undeclared.length === 0,
              message: sayNamed(
                lang,
                `Surface rule uses state ${undeclared.length === 1 ? 'path' : 'paths'} not declared anywhere in this feature: ${undeclared.slice(0, 3).join(', ')}${undeclared.length > 3 ? '…' : ''}. Declare ${undeclared.length === 1 ? 'it' : 'them'} on a surface.`,
                `${undeclaredPathsFr(undeclared, 'Une règle de surface utilise')} Déclarez-${undeclared.length >= 2 ? 'les' : 'le'} sur une surface.`
              ),
              passLabel: say(
                lang,
                'All surface rule state paths are declared',
                "Tous les chemins d'état des règles de surface sont déclarés"
              ),
              tab: 'rules' as SurfacePanelTab
            },
            {
              area: 'unshared state in rules',
              weight: 1,
              severity: 'recommended' as const,
              passes: unsharedOnly.length === 0,
              message: sayNamed(
                lang,
                `Surface rule reads state ${unsharedOnly.length === 1 ? 'path' : 'paths'} declared on another surface: ${unsharedOnly.slice(0, 3).join(', ')}${unsharedOnly.length > 3 ? '…' : ''}. Add this surface to that StateDefinition's sharedWith.`,
                `${unsharedPathsFr(unsharedOnly, 'Une règle de surface lit')} Ajoutez cette surface au sharedWith de la définition d'état concernée.`
              ),
              passLabel: say(
                lang,
                'No unshared cross-surface reads in surface rules',
                "Aucune lecture d'un état non partagé d'une autre surface dans les règles de surface"
              ),
              tab: 'rules' as SurfacePanelTab
            }
          ];
        })()
      : [])
  ];
};

export const scoreSurface = (
  surface: Surface,
  allSurfaces?: readonly Surface[],
  language: ReportLanguage = 'en'
): MaturityReport => {
  const knownPaths = allSurfaces !== undefined
    ? buildKnownPaths(String(surface.id), allSurfaces)
    : undefined;
  const allDeclaredPaths = allSurfaces !== undefined
    ? buildAllDeclaredPaths(allSurfaces)
    : undefined;
  // Evolution actions are dashed proposals, not committed behavior: scoring
  // their empty bodies would tank the surface. Exclude them from BOTH the
  // surface-level checks (so an evolution-only surface still asks for a real
  // action) and the per-action rollup.
  const committed = committedActions(surface.actions);
  const baseReport = reportFromChecks(
    'surface',
    surface.name,
    { surfaceId: surface.id as unknown as string },
    surfaceChecks({ ...surface, actions: committed }, knownPaths, allDeclaredPaths, language)
  );
  const childrenReport = committed.reduce<MaturityReport>(
    (acc, c) => combineReports(acc, scoreCapability(surface, c, allSurfaces, language)),
    emptyReport()
  );
  return combineReports(baseReport, childrenReport);
};

const featureChecks = (feature: Feature, lang: ReportLanguage = 'en'): readonly Check[] => {
  const nameCheck: Check = {
    area: 'name',
    weight: 1,
    severity: 'critical',
    passes: feature.name.trim().length > 0,
    message: say(lang, 'Give this feature a name.', 'Donnez un nom à cette fonctionnalité.'),
    passLabel: say(lang, 'Has a name', 'Possède un nom')
  };
  const surfacesCheck: Check = {
    area: 'surfaces',
    weight: 1,
    severity: 'critical',
    passes: feature.surfaces.length > 0,
    message: say(
      lang,
      'Add a surface - a place where users see and do things.',
      'Ajoutez une surface : un endroit où les utilisateurs voient et font des choses.'
    ),
    passLabel: say(
      lang,
      `Has ${feature.surfaces.length} surface${
        feature.surfaces.length === 1 ? '' : 's'
      }`,
      `Possède ${frCount(feature.surfaces.length, 'surface', 'surfaces')}`
    )
  };

  // Without surfaces, the remaining feature-level checks would all pass
  // vacuously (no emitted events to register, no resources to reference, no
  // scenarios to assert against, ...) and the score would read ~90% for a
  // feature with nothing in it. Gate them behind the "has a surface"
  // prerequisite so the maturity card honestly says "0 / 1: add a surface"
  // on a fresh feature instead of misleading the user into thinking they're
  // nearly done.
  if (feature.surfaces.length === 0) {
    return [nameCheck, surfacesCheck];
  }

  const emittedEvents = emittedEventNames(feature);
  const registeredEvents = new Set((feature.events ?? []).map((event) => String(event.name)));
  const allEmittedEventsRegistered = emittedEvents.every((event) => registeredEvents.has(event));
  const registeredEventsHavePayloads = (feature.events ?? []).every(
    (event) =>
      (event.payloadSchema?.length ?? 0) === 0 ||
      event.payloadSchema?.every((field) => field.name.trim().length > 0)
  );
  const resourceReferences = hasResourceReferences(feature);
  const scenarios = feature.surfaces.flatMap((surface) =>
    surface.actions.flatMap((action) => action.scenarios ?? [])
  );

  return [
    nameCheck,
    {
      area: 'description',
      weight: 1,
      severity: 'recommended',
      passes: true,
      message: say(
        lang,
        'Add an feature description so agents and humans know the product boundary.',
        'Ajoutez une description de la fonctionnalité pour que les agents et les humains connaissent le périmètre du produit.'
      ),
      passLabel:
        (feature.description?.trim().length ?? 0) > 0
          ? say(lang, 'Has a description', 'Possède une description')
          : say(lang, 'Description optional', 'Description facultative')
    },
    surfacesCheck,
    {
      area: 'events registry',
      weight: 1,
      severity: 'recommended',
      passes:
        emittedEvents.length === 0 ||
        (feature.events ?? []).length === 0 ||
        allEmittedEventsRegistered,
      message: say(
        lang,
        'Register emitted events in the Events tab so payloads and producers are discoverable.',
        "Enregistrez les événements émis dans l'onglet Events pour que leurs charges utiles et leurs émetteurs soient faciles à trouver."
      ),
      passLabel:
        emittedEvents.length === 0
          ? say(lang, 'No emitted events to register', 'Aucun événement émis à enregistrer')
          : (feature.events ?? []).length === 0
            ? say(
                lang,
                'Event registry optional until used',
                "Registre d'événements facultatif tant qu'il ne sert pas"
              )
            : say(lang, 'Emitted events are registered', 'Les événements émis sont enregistrés')
    },
    {
      area: 'event payloads',
      weight: 1,
      severity: 'recommended',
      passes: registeredEventsHavePayloads,
      message: say(
        lang,
        'Event payload schema fields need names when payloads are declared.',
        "Quand la charge utile d'un événement est déclarée, chaque champ de son schéma doit avoir un nom."
      ),
      passLabel:
        (feature.events ?? []).length === 0
          ? say(lang, 'No event payloads declared', "Aucune charge utile d'événement déclarée")
          : say(lang, 'Payload schemas are valid', 'Les schémas de charge utile sont valides')
    },
    {
      area: 'resources',
      weight: 1,
      severity: 'recommended',
      passes: !resourceReferences || feature.resources.length > 0,
      message: say(
        lang,
        'Parameters reference resources, but no Resources are declared at the feature level.',
        "Des paramètres font référence à des ressources, mais aucune ressource n'est déclarée au niveau de la fonctionnalité."
      ),
      passLabel: resourceReferences
        ? say(lang, 'Declares referenced resources', 'Déclare les ressources référencées')
        : say(lang, 'No resource references', 'Aucune référence à une ressource')
    },
    {
      area: 'data',
      weight: 1,
      severity: 'recommended',
      passes: true,
      message: say(
        lang,
        'Promote repeated or domain-shaped state into Entity definitions so the model has a clear schema.',
        "Transformez l'état répété ou propre au métier en définitions d'entité pour donner au modèle un schéma clair."
      ),
      passLabel:
        feature.entities.length > 0
          ? say(lang, 'Has data definitions', 'Possède des définitions de données')
          : say(lang, 'Entity definitions optional', "Définitions d'entité facultatives")
    },
    {
      area: 'personas',
      weight: 1,
      severity: 'recommended',
      passes: true,
      message: say(
        lang,
        'Add personas to exercise important roles, regions, plans, or auth states.',
        "Ajoutez des personas pour éprouver les rôles, régions, offres ou états d'authentification importants."
      ),
      passLabel:
        feature.personas.length > 0
          ? say(lang, 'Has personas', 'Possède des personas')
          : say(lang, 'Personas optional', 'Personas en option')
    },
    {
      area: 'scenario assertions',
      weight: 1,
      severity: 'recommended',
      passes: scenarios.length === 0 || hasScenarioExpectations(feature) || scenarios.length > 0,
      message: say(
        lang,
        'Scenarios are more useful when they declare expectedStatus or expectedAssertions.',
        'Un scénario est plus utile quand il déclare expectedStatus ou expectedAssertions.'
      ),
      passLabel:
        scenarios.length === 0
          ? say(lang, 'No scenarios yet', "Aucun scénario pour l'instant")
          : hasScenarioExpectations(feature)
            ? say(lang, 'Scenarios have expectations', 'Les scénarios déclarent leurs attentes')
            : say(lang, 'Scenario expectations optional', 'Attentes des scénarios facultatives')
    },
    {
      area: 'implementation context',
      weight: 1,
      severity: 'recommended',
      passes: true,
      message: say(
        lang,
        'Add devContext so MCP implementation audits can reflect the stack and coding conventions.',
        "Ajoutez devContext pour que les audits d'implémentation MCP reflètent la pile technique et les conventions de code."
      ),
      passLabel: feature.devContext
        ? say(lang, 'Has implementation context', "Possède un contexte d'implémentation")
        : say(lang, 'Implementation context optional', "Contexte d'implémentation facultatif")
    },
    {
      area: 'liveness',
      weight: 1,
      severity: 'recommended',
      // Liveness goals are optional (not every feature has a "this must stay
      // reachable" property), so this never fails — it credits the modeler for
      // declaring goals the model checker can verify, the complement to the
      // invariant (safety) coverage the surface/action checks already reward.
      passes: true,
      message: say(
        lang,
        'Add reachability goals so the model checker can prove key states stay reachable (liveness), not just that invariants hold (safety).',
        "Ajoutez des objectifs d'atteignabilité pour que le vérificateur de modèle prouve que les états clés restent atteignables (vivacité), et pas seulement que les invariants tiennent (sûreté)."
      ),
      passLabel:
        (feature.reachabilityGoals?.length ?? 0) > 0
          ? say(
              lang,
              `Declares ${feature.reachabilityGoals!.length} liveness goal${feature.reachabilityGoals!.length === 1 ? '' : 's'}`,
              `Déclare ${frCount(
                feature.reachabilityGoals!.length,
                "objectif d'atteignabilité",
                "objectifs d'atteignabilité"
              )}`
            )
          : say(lang, 'Liveness goals optional', "Objectifs d'atteignabilité facultatifs")
    }
  ];
};

/**
 * A feature with zero surfaces hasn't been built yet. Reporting anything
 * above 0% (the old behaviour gave ~50% when only the "has a name" check
 * passed) misled users into thinking they were halfway done. Force 0%
 * and clear the passedChecks list — the only thing a user can act on at
 * this stage is "add a surface", which is already surfaced as the lone
 * critical issue from featureChecks's early-return path.
 */
const emptyFeatureReport = (baseReport: MaturityReport): MaturityReport => ({
  ...baseReport,
  score: 0,
  percentage: 0,
  passedChecks: []
});

export const scoreFeature = (feature: Feature, language: ReportLanguage = 'en'): MaturityReport => {
  const baseReport = reportFromChecks(
    'feature',
    feature.name,
    {},
    featureChecks(feature, language)
  );
  // Presentation surfaces are pure UI (see Surface.presentation): excluded from
  // the behavior-maturity rollup and from the empty-feature short-circuit, so a
  // feature whose only surfaces are presentation ones reads as not built (0%)
  // rather than being dragged down by their empty behavioral bodies. They stay
  // in the path-sharing context (full feature.surfaces) so cross-surface reads
  // of state shared FROM a presentation surface don't misfire.
  const behavioralSurfaces = feature.surfaces.filter((s) => !s.presentation);
  if (behavioralSurfaces.length === 0) return emptyFeatureReport(baseReport);
  const childrenReport = behavioralSurfaces.reduce<MaturityReport>(
    (acc, s) => combineReports(acc, scoreSurface(s, feature.surfaces, language)),
    emptyReport()
  );
  return combineReports(baseReport, childrenReport);
};

/**
 * Per-action breakdown for a single surface. The aggregate is the surface
 * score (surface-level checks + every action), exposing both halves
 * separately so the UI can render the rollup action → surface explicitly.
 */
export type SurfaceMaturityBreakdown = {
  readonly surface: Surface;
  readonly aggregate: MaturityReport;
  readonly surfaceLevel: MaturityReport;
  readonly perAction: readonly {
    readonly action: Action;
    readonly report: MaturityReport;
  }[];
};

export const scoreSurfaceBreakdown = (
  surface: Surface,
  allSurfaces?: readonly Surface[],
  language: ReportLanguage = 'en'
): SurfaceMaturityBreakdown => {
  const knownPaths =
    allSurfaces !== undefined ? buildKnownPaths(String(surface.id), allSurfaces) : undefined;
  const allDeclaredPaths =
    allSurfaces !== undefined ? buildAllDeclaredPaths(allSurfaces) : undefined;
  const committed = committedActions(surface.actions);
  const surfaceLevel = reportFromChecks(
    'surface',
    surface.name,
    { surfaceId: surface.id as unknown as string },
    surfaceChecks({ ...surface, actions: committed }, knownPaths, allDeclaredPaths, language)
  );
  // Skip evolution proposals: the maturity breakdown lists committed actions
  // only, so a dashed placeholder never appears as a "0/14" red row.
  const perAction = committed.map((action) => ({
    action,
    report: scoreCapability(surface, action, allSurfaces, language)
  }));
  const aggregate = perAction.reduce<MaturityReport>(
    (acc, entry) => combineReports(acc, entry.report),
    surfaceLevel
  );
  return { surface, aggregate, surfaceLevel, perAction };
};

/**
 * Per-surface breakdown plus the global aggregate. Roll-up flow is
 * action → surface → feature: action checks form the leaves,
 * surface-level checks (state, invariants, presence of actions) sit
 * alongside, and the feature adds its own (name, has surfaces).
 */
export type FeatureMaturityBreakdown = {
  readonly featureLevel: MaturityReport;
  readonly perSurface: readonly {
    readonly surface: Surface;
    /** Aggregate surface score = surfaceLevel + every action. */
    readonly report: MaturityReport;
    readonly surfaceLevel: MaturityReport;
    readonly perAction: readonly {
      readonly action: Action;
      readonly report: MaturityReport;
    }[];
  }[];
  readonly global: MaturityReport;
};

export const scoreFeatureBreakdown = (
  feature: Feature,
  language: ReportLanguage = 'en'
): FeatureMaturityBreakdown => {
  const featureLevel = reportFromChecks(
    'feature',
    feature.name,
    {},
    featureChecks(feature, language)
  );
  // Same empty-feature short-circuit as scoreFeature — keep the global
  // bar at 0% and drop "passed" noise when no surfaces exist. The
  // featureLevel report still carries the "add a surface" critical
  // issue so the user can act on it. Presentation surfaces are excluded from
  // the rollup (and this short-circuit) exactly as in scoreFeature, so the
  // global percentage matches. The full feature.surfaces stays as path context.
  const behavioralSurfaces = feature.surfaces.filter((s) => !s.presentation);
  if (behavioralSurfaces.length === 0) {
    return {
      featureLevel,
      perSurface: [],
      global: emptyFeatureReport(featureLevel)
    };
  }
  const perSurface = behavioralSurfaces.map((surface) => {
    const breakdown = scoreSurfaceBreakdown(surface, feature.surfaces, language);
    return {
      surface: breakdown.surface,
      report: breakdown.aggregate,
      surfaceLevel: breakdown.surfaceLevel,
      perAction: breakdown.perAction
    };
  });
  const global = perSurface.reduce<MaturityReport>(
    (acc, entry) => combineReports(acc, entry.report),
    featureLevel
  );
  return { featureLevel, perSurface, global };
};
