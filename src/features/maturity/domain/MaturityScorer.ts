import type { Action } from '$features/behavior-model/domain/entities/Action';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Surface } from '$features/behavior-model/domain/entities/Surface';
import { isExpression, type Expression } from '$features/behavior-model/domain/value-objects/Expression';
import type { Effect } from '$features/behavior-model/domain/value-objects/Effect';
import {
  flattenLeafConditions,
  type RuleCondition
} from '$features/behavior-model/domain/value-objects/RuleCondition';
import type { StatePath } from '$features/behavior-model/domain/value-objects/StatePath';
import type {
  CheckLocation,
  MaturityIssue,
  MaturityReport,
  PassedCheck,
  SurfacePanelTab
} from './MaturityReport';
import { combineReports, emptyReport } from './MaturityReport';

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
            leaf.left,
            ...(isExpression(leaf.right) ? expressionStateReads(leaf.right) : [])
          ]),
          ...expressionStateReads(c.then)
        ]),
        ...expressionStateReads(expression.default)
      ];
    case 'literal':
    case 'param':
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
    out.push(leaf.left);
    if (isExpression(leaf.right)) out.push(...expressionStateReads(leaf.right));
  }
  return out;
};

// Every state path an action reads from OR writes to (conditions, set_state targets,
// expression operands, requiredStates). Used to validate paths against surface scope.
const allCapabilityStatePaths = (action: Action): readonly StatePath[] => {
  const paths = new Set<StatePath>();
  const addCondition = (c: RuleCondition | undefined) => {
    for (const p of conditionStateReads(c)) paths.add(p);
  };
  const addEffect = (e: Effect) => {
    if (e.type !== 'set_state') return;
    paths.add(e.path);
    if (isExpression(e.value)) for (const p of expressionStateReads(e.value)) paths.add(p);
  };
  for (const rule of action.rules) { addCondition(rule.condition); addEffect(rule.effect); }
  for (const inv of action.invariants) addCondition(inv.condition);
  for (const e of [...action.effects, ...(action.onBlockedEffects ?? [])]) addEffect(e);
  for (const path of action.requiredStates) paths.add(path);
  return [...paths];
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

const effectStateReads = (effect: Effect): StatePath[] => {
  if (effect.type !== 'set_state' || !isExpression(effect.value)) return [];
  return expressionStateReads(effect.value);
};

const capabilityStateReads = (action: Action): StatePath[] => {
  const paths = new Set<StatePath>();
  for (const rule of action.rules) {
    for (const path of conditionStateReads(rule.condition)) paths.add(path);
  }
  for (const invariant of action.invariants) {
    for (const path of conditionStateReads(invariant.condition)) paths.add(path);
  }
  for (const effect of [...action.effects, ...(action.onBlockedEffects ?? [])]) {
    for (const path of effectStateReads(effect)) paths.add(path);
  }
  return [...paths];
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
  allDeclaredPaths?: ReadonlySet<string>
): readonly Check[] => {
  const sensitiveCategories = new Set(['security', 'permissions', 'compliance']);
  const hasPermissionRule = action.rules.some((r) => sensitiveCategories.has(r.category));
  const dataMutating = [...action.effects, ...(action.onBlockedEffects ?? [])].some(
    (e) => e.type === 'set_state'
  );
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
  const stateReads = capabilityStateReads(action);
  const hasRequiredStateCoverage =
    action.requiredStates.length === 0 ||
    action.requiredStates.length > 0 ||
    stateReads.length === 0;
  const emitsEventsFromEffects = action.effects.some((e) => e.type === 'emit_event');
  const hasBlockedFallback = (action.onBlockedEffects ?? []).length > 0;
  const hasComplexBehavior =
    action.rules.length > 1 ||
    action.effects.length > 1 ||
    action.invariants.length > 0 ||
    hasInputs ||
    dataMutating;
  const scenarioCount = action.scenarios?.length ?? 0;
  const hasScenarioCoverage = scenarioCount === 0 || !hasComplexBehavior || scenarioCount > 0;
  const hasExpressionUse = capabilityUsesExpression(action);

  return [
    {
      area: 'intent',
      weight: 1,
      severity: 'critical',
      passes: action.intent.trim().length > 0,
      message: 'Add a short description of what this action is for.',
      passLabel: 'Has a description',
      tab: 'actions'
    },
    {
      area: 'rules',
      weight: 1,
      severity: 'recommended',
      passes: action.rules.length > 0,
      message: 'Add rules to control when this action can or cannot run.',
      passLabel: `Has ${action.rules.length} rule${action.rules.length === 1 ? '' : 's'}`,
      tab: 'actions'
    },
    {
      area: 'effects',
      weight: 1,
      severity: 'critical',
      passes: action.effects.length > 0 || action.rules.length > 0,
      message: 'Nothing happens when this runs. Add an effect or a rule.',
      passLabel: 'Has effects or rules',
      tab: 'actions'
    },
    {
      area: 'events',
      weight: 1,
      severity: 'recommended',
      passes:
        action.emittedEvents.length > 0 ||
        emitsEventsFromEffects,
      message:
        'Other parts of your feature cannot react when this runs. Make it emit and declare an event.',
      passLabel:
        action.emittedEvents.length > 0 && emitsEventsFromEffects
          ? 'Emits and declares events'
          : 'Has event signaling',
      tab: 'actions'
    },
    {
      area: 'required states',
      weight: 1,
      severity: 'recommended',
      passes: hasRequiredStateCoverage,
      message:
        'Declare requiredStates so readers and implementation audits know which state this action depends on.',
      passLabel:
        action.requiredStates.length === 0
          ? 'Required states not declared'
          : `Documents ${action.requiredStates.length} required state${
              action.requiredStates.length === 1 ? '' : 's'
            }`,
      tab: 'actions'
    },
    {
      area: 'event declarations',
      weight: 1,
      severity: 'recommended',
      passes: !emitsEventsFromEffects || action.emittedEvents.length > 0,
      message:
        'This action emits an event effect but does not declare emittedEvents for audit and discovery.',
      passLabel: emitsEventsFromEffects ? 'Declares emitted events' : 'No emitted event effects',
      tab: 'actions'
    },
    {
      area: 'permissions',
      weight: 1,
      severity: dataMutating ? 'critical' : 'recommended',
      passes: !dataMutating || hasPermissionRule,
      message:
        'This action changes data. Add a rule that decides who is allowed to run it.',
      passLabel: dataMutating
        ? 'Has a permission rule'
        : 'Does not change data. No permission rule needed',
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
      message:
        'Inputs are not checked before this runs. Add a rule with category "validation" or attach validations to a parameter.',
      passLabel:
        action.parameters.length === 0
          ? 'No inputs to validate'
          : !hasValidatableParam
            ? 'Inputs are booleans/enums. No validation needed'
            : 'Validates its inputs',
      tab: 'actions'
    },
    {
      area: 'parameters',
      weight: 1,
      severity: 'recommended',
      passes: !hasInputs || (hasParameterDefaults && enumParametersConfigured),
      message:
        'Make parameter behavior explicit: optional parameters need defaults, and enum parameters need allowed values.',
      passLabel: hasInputs ? 'Parameters have defaults/enum options' : 'No parameters',
      tab: 'actions'
    },
    {
      area: 'block handling',
      weight: 1,
      severity: 'recommended',
      passes:
        action.rules.length === 0 ||
        hasBlockedFallback ||
        action.rules.some((rule) => rule.effect.type !== 'allow_action'),
      message:
        'Add on-block effects when a blocked run should show a message, emit an audit event, or navigate.',
      passLabel: action.rules.length === 0 ? 'No block paths' : 'Has block fallback effects',
      tab: 'actions'
    },
    {
      area: 'scenarios',
      weight: 1,
      severity: 'recommended',
      passes: hasScenarioCoverage,
      message:
        'Add at least one scenario for this non-trivial action so examples become regression checks.',
      passLabel: hasComplexBehavior
        ? `Has ${scenarioCount} scenario${scenarioCount === 1 ? '' : 's'}`
        : 'Scenarios optional until added',
      tab: 'actions'
    },
    {
      area: 'expressions',
      weight: 1,
      severity: 'recommended',
      passes: !hasExpressionUse || action.rules.length > 0 || action.effects.length > 0,
      message:
        'Expression values should live in explicit rules or effects so readers can inspect the calculation.',
      passLabel: hasExpressionUse ? 'Uses expression values' : 'No expression values needed',
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
              message: `Uses state ${undeclared.length === 1 ? 'path' : 'paths'} not declared anywhere in this feature: ${undeclared.slice(0, 3).join(', ')}${undeclared.length > 3 ? '…' : ''}. Declare ${undeclared.length === 1 ? 'it' : 'them'} on a surface.`,
              passLabel: 'All referenced state paths are declared',
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
              message: `Reads state ${unsharedOnly.length === 1 ? 'path' : 'paths'} declared on another surface: ${unsharedOnly.slice(0, 3).join(', ')}${unsharedOnly.length > 3 ? '…' : ''}. Add this surface to that StateDefinition's sharedWith to make the dependency explicit.`,
              passLabel: 'No unshared cross-surface reads',
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
  allSurfaces?: readonly Surface[]
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
    capabilityChecks(action, knownPaths, allDeclaredPaths)
  );
};

const surfaceChecks = (
  surface: Surface,
  knownPaths?: ReadonlySet<string>,
  allDeclaredPaths?: ReadonlySet<string>
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
      message: 'Add at least one thing the user can do here.',
      passLabel: `Has ${surface.actions.length} capabilit${
        surface.actions.length === 1 ? 'y' : 'ies'
      }`,
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
      message: 'Add some state - the data your rules read to decide what happens.',
      passLabel: `Has ${surface.stateDefinitions.length} state value${
        surface.stateDefinitions.length === 1 ? '' : 's'
      }`,
      tab: 'state'
    },
    {
      area: 'state metadata',
      weight: 1,
      severity: 'recommended',
      passes:
        surface.stateDefinitions.length === 0 ||
        !hasEnumStateWithoutValues,
      message:
        'Document state definitions with descriptions, and give enum states their allowed values.',
      passLabel:
        surface.stateDefinitions.length === 0
          ? 'No state to document'
          : 'State definitions are documented',
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
      message:
        'Shared state is declared but incomplete. Check sharedWith links on state definitions.',
      passLabel: hasSharedState ? 'Declares shared state' : 'No obvious shared state',
      tab: 'state'
    },
    {
      area: 'surface rules',
      weight: 1,
      severity: 'recommended',
      passes: hasSurfaceWideRules,
      message:
        'This surface has multiple actions and no visible gating. Add surface rules or action rules.',
      passLabel:
        surface.actions.length <= 1 ? 'No cross-cutting gate needed' : 'Has surface rules',
      tab: 'rules'
    },
    {
      area: 'invariants',
      weight: 1,
      severity: 'recommended',
      passes:
        surface.invariants.length > 0 ||
        surface.actions.some((c) => c.invariants.length > 0),
      message:
        'Add an invariant - a fact that should always be true here, so broken states are caught early.',
      passLabel: 'Has invariants',
      tab: 'invariants'
    },
    {
      area: 'transitions',
      weight: 1,
      severity: 'recommended',
      passes: transitionTargets.length === 0 || surface.transitions.length > 0,
      message:
        'This surface navigates through effects. Declare transitions so the graph is visible outside individual actions.',
      passLabel:
        transitionTargets.length === 0 ? 'No navigation effects' : 'Declares surface transitions',
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
              message: `Surface rule uses state ${undeclared.length === 1 ? 'path' : 'paths'} not declared anywhere in this feature: ${undeclared.slice(0, 3).join(', ')}${undeclared.length > 3 ? '…' : ''}. Declare ${undeclared.length === 1 ? 'it' : 'them'} on a surface.`,
              passLabel: 'All surface rule state paths are declared',
              tab: 'rules' as SurfacePanelTab
            },
            {
              area: 'unshared state in rules',
              weight: 1,
              severity: 'recommended' as const,
              passes: unsharedOnly.length === 0,
              message: `Surface rule reads state ${unsharedOnly.length === 1 ? 'path' : 'paths'} declared on another surface: ${unsharedOnly.slice(0, 3).join(', ')}${unsharedOnly.length > 3 ? '…' : ''}. Add this surface to that StateDefinition's sharedWith.`,
              passLabel: 'No unshared cross-surface reads in surface rules',
              tab: 'rules' as SurfacePanelTab
            }
          ];
        })()
      : [])
  ];
};

export const scoreSurface = (surface: Surface, allSurfaces?: readonly Surface[]): MaturityReport => {
  const knownPaths = allSurfaces !== undefined
    ? buildKnownPaths(String(surface.id), allSurfaces)
    : undefined;
  const allDeclaredPaths = allSurfaces !== undefined
    ? buildAllDeclaredPaths(allSurfaces)
    : undefined;
  const baseReport = reportFromChecks(
    'surface',
    surface.name,
    { surfaceId: surface.id as unknown as string },
    surfaceChecks(surface, knownPaths, allDeclaredPaths)
  );
  const childrenReport = surface.actions.reduce<MaturityReport>(
    (acc, c) => combineReports(acc, scoreCapability(surface, c, allSurfaces)),
    emptyReport()
  );
  return combineReports(baseReport, childrenReport);
};

const featureChecks = (feature: Feature): readonly Check[] => {
  const nameCheck: Check = {
    area: 'name',
    weight: 1,
    severity: 'critical',
    passes: feature.name.trim().length > 0,
    message: 'Give this feature a name.',
    passLabel: 'Has a name'
  };
  const surfacesCheck: Check = {
    area: 'surfaces',
    weight: 1,
    severity: 'critical',
    passes: feature.surfaces.length > 0,
    message: 'Add a surface - a place where users see and do things.',
    passLabel: `Has ${feature.surfaces.length} surface${
      feature.surfaces.length === 1 ? '' : 's'
    }`
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
      message: 'Add an feature description so agents and humans know the product boundary.',
      passLabel:
        (feature.description?.trim().length ?? 0) > 0
          ? 'Has a description'
          : 'Description optional'
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
      message:
        'Register emitted events in the Events tab so payloads and producers are discoverable.',
      passLabel:
        emittedEvents.length === 0
          ? 'No emitted events to register'
          : (feature.events ?? []).length === 0
            ? 'Event registry optional until used'
            : 'Emitted events are registered'
    },
    {
      area: 'event payloads',
      weight: 1,
      severity: 'recommended',
      passes: registeredEventsHavePayloads,
      message: 'Event payload schema fields need names when payloads are declared.',
      passLabel:
        (feature.events ?? []).length === 0 ? 'No event payloads declared' : 'Payload schemas are valid'
    },
    {
      area: 'resources',
      weight: 1,
      severity: 'recommended',
      passes: !resourceReferences || feature.resources.length > 0,
      message: 'Parameters reference resources, but no Resources are declared at the feature level.',
      passLabel: resourceReferences ? 'Declares referenced resources' : 'No resource references'
    },
    {
      area: 'data',
      weight: 1,
      severity: 'recommended',
      passes: true,
      message:
        'Promote repeated or domain-shaped state into Entity definitions so the model has a clear schema.',
      passLabel: feature.entities.length > 0 ? 'Has data definitions' : 'Entity definitions optional'
    },
    {
      area: 'personas',
      weight: 1,
      severity: 'recommended',
      passes: true,
      message: 'Add personas to exercise important roles, regions, plans, or auth states.',
      passLabel: feature.personas.length > 0 ? 'Has personas' : 'Personas optional'
    },
    {
      area: 'scenario assertions',
      weight: 1,
      severity: 'recommended',
      passes: scenarios.length === 0 || hasScenarioExpectations(feature) || scenarios.length > 0,
      message: 'Scenarios are more useful when they declare expectedStatus or expectedAssertions.',
      passLabel:
        scenarios.length === 0
          ? 'No scenarios yet'
          : hasScenarioExpectations(feature)
            ? 'Scenarios have expectations'
            : 'Scenario expectations optional'
    },
    {
      area: 'implementation context',
      weight: 1,
      severity: 'recommended',
      passes: true,
      message:
        'Add devContext so MCP implementation audits can reflect the stack and coding conventions.',
      passLabel: feature.devContext ? 'Has implementation context' : 'Implementation context optional'
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

export const scoreFeature = (feature: Feature): MaturityReport => {
  const baseReport = reportFromChecks(
    'feature',
    feature.name,
    {},
    featureChecks(feature)
  );
  if (feature.surfaces.length === 0) return emptyFeatureReport(baseReport);
  const childrenReport = feature.surfaces.reduce<MaturityReport>(
    (acc, s) => combineReports(acc, scoreSurface(s, feature.surfaces)),
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
  allSurfaces?: readonly Surface[]
): SurfaceMaturityBreakdown => {
  const knownPaths =
    allSurfaces !== undefined ? buildKnownPaths(String(surface.id), allSurfaces) : undefined;
  const allDeclaredPaths =
    allSurfaces !== undefined ? buildAllDeclaredPaths(allSurfaces) : undefined;
  const surfaceLevel = reportFromChecks(
    'surface',
    surface.name,
    { surfaceId: surface.id as unknown as string },
    surfaceChecks(surface, knownPaths, allDeclaredPaths)
  );
  const perAction = surface.actions.map((action) => ({
    action,
    report: scoreCapability(surface, action, allSurfaces)
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
  feature: Feature
): FeatureMaturityBreakdown => {
  const featureLevel = reportFromChecks(
    'feature',
    feature.name,
    {},
    featureChecks(feature)
  );
  // Same empty-feature short-circuit as scoreFeature — keep the global
  // bar at 0% and drop "passed" noise when no surfaces exist. The
  // featureLevel report still carries the "add a surface" critical
  // issue so the user can act on it.
  if (feature.surfaces.length === 0) {
    return {
      featureLevel,
      perSurface: [],
      global: emptyFeatureReport(featureLevel)
    };
  }
  const perSurface = feature.surfaces.map((surface) => {
    const breakdown = scoreSurfaceBreakdown(surface, feature.surfaces);
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
