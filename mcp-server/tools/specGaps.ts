import { z } from 'zod';
import type { Action } from '../../src/features/behavior-model/domain/entities/Action';
import { isEvolution } from '../../src/features/behavior-model/domain/entities/Action';
import type { Invariant } from '../../src/features/behavior-model/domain/entities/Invariant';
import {
  analyzeActionDecisions,
  decisionDetail,
  type DecisionFindingKind
} from '../../src/features/behavior-model/domain/services/DecisionAnalysis';
import type { Effect } from '../../src/features/behavior-model/domain/value-objects/Effect';
import type { Feature } from '../../src/features/behavior-model/domain/entities/Feature';
import type { Surface } from '../../src/features/behavior-model/domain/entities/Surface';
import { criterionStandings } from '../../src/features/behavior-model/domain/services/CriterionStanding';
import { asFeatureId } from '../../src/features/behavior-model/domain/value-objects/ids';
import { isStatePath } from '../../src/features/behavior-model/domain/value-objects/StatePath';
import { trackTokens } from '../metrics';
import { errorText, text, type ToolDeps } from './_shared';
import { expandFeatureId } from './short-ids';
import {
  projectStateVariables,
  stateCoherenceIssues
} from '../../src/features/projects/domain/services/stateRegistry';
import { loadFeaturesByIds } from '../../src/features/behavior-model/application/services/bulkRead';
import { findOwningProject } from '../../src/features/projects/application/services/bulkRead';
import { runScenariosUseCase } from '../../src/features/simulator/application/use-cases/RunScenarios';
import { NBSP, quoteName, type ReportLanguage } from '../../src/shared/language';
import { activeProver } from '../../src/features/prover/loadProver';
import type { ProverGap } from '../../src/features/prover/ProverPort';

type Severity = 'critical' | 'recommended';
type EntityKind = 'feature' | 'surface' | 'action' | 'criterion';

/**
 * Every code a gap can carry, with what it means. A code is stable: readers
 * sort, count and match gaps by it, never by the wording of `reason`, which
 * follows the spec's language.
 */
export const SPEC_GAP_CODES = {
  'missing-expected-action': 'An expectedActions entry of the feature has no action of that name.',
  'invalid-state-path': 'A surface declares a state whose path is not a valid dotted state path.',
  'stateless-surface': 'A surface has no state of its own and none shared into it.',
  'no-effects': 'An action does nothing: no effect on itself, its rules or its blocked runs.',
  'inert-emitted-event': 'An action declares an event that no emit_event effect of it fires.',
  'untested-destructive': 'A destructive action has no scenario.',
  'async-without-loading-error': 'An async action has no scenario setting or asserting a loading or error state.',
  'validation-without-blocking-rule': 'A validation action has no rule that blocks invalid input.',
  'not-implemented': 'An action has no implementation status entry.',
  'bypass-invariants': 'An action skips every invariant with bypassInvariants.',
  'dangling-invariant-relaxation': 'An action relaxes an invariant id that does not exist (subjectId: that id).',
  'untransitioned-states': 'A surface declares several states and no transition.',
  'dependency-without-operations': 'An external dependency declares no operation (subjectId: the dependency).',
  'operation-without-timeout': 'An external operation has no documented timeout (subjectId: the operation).',
  'operation-without-failure-modes': 'An external operation has no documented failure mode (subjectId: the operation).',
  'contested-criterion': 'An acceptance criterion is still active while another one supersedes it.',
  'decision:dead-rule': 'A rule whose condition asks a state to hold two values at once (subjectId: the rule).',
  'decision:conflicting-rules': 'Two rules fire on the same condition with effects that disagree (subjectId: the first rule).',
  'decision:redundant-rule': 'Two rules share the same condition and effect (subjectId: the first rule).',
  'decision:shadowed-rule': 'A rule placed after an unconditional block (subjectId: the rule).',
  'decision:always-blocked': 'A rule blocks unconditionally, so the action never succeeds (subjectId: the rule).',
  'solver-unavailable': 'The solver did not run, so nothing was proven.',
  /*
   * A loaded proof module adds its own codes, each prefixed `proof:` (and
   * `missing-scenario`); they are listed by the module, not here.
   */
  'state:missing-data-field': 'A canonical state links to an entity field that does not exist (subjectId: the state).',
  'state:field-type-mismatch': 'A canonical state and its linked field have different types (subjectId: the state).',
  'state:field-enum-mismatch': 'A canonical state and its linked field have different enum values (subjectId: the state).',
  'state:declaration-type-mismatch':
    'Two features declare one state path with different kinds of value (subjectId: the state), so every proof reading it depends on which was read first.',
  'state:declaration-choices-mismatch':
    'Two features declare one choice state allowing different values (subjectId: the state); critical when a project invariant reads it.',
} as const;

export type SpecGapCode = keyof typeof SPEC_GAP_CODES | `proof:${string}` | 'missing-scenario';

export type SpecGap = {
  /** Stable kebab-case code (see {@link SPEC_GAP_CODES}): match gaps by it, never by wording. */
  readonly code: SpecGapCode;
  readonly severity: Severity;
  readonly entityType: EntityKind;
  readonly entityId: string;
  readonly entityName: string;
  /** The rule, invariant, goal, state or operation the gap is about, when it is not the entity itself. */
  readonly subjectId?: string;
  readonly reason: string;
  readonly suggestedFix: string;
};

const normalizeName = (s: string): string => s.trim().toLowerCase();

const DECISION_FIX: Record<ReportLanguage, Record<DecisionFindingKind, string>> = {
  en: {
    'dead-rule': 'Fix the contradictory condition so the rule can fire, or remove the rule.',
    'conflicting-rules':
      'Make the two conditions mutually exclusive, or reconcile the effects so the outcome does not depend on rule order.',
    'redundant-rule': 'Remove the duplicate rule.',
    'shadowed-rule': 'Move this rule before the unconditional block, or remove it.',
    'always-blocked':
      'Give the blocking rule a condition, or drop the success effects that can never run.'
  },
  fr: {
    'dead-rule':
      'Corrigez la condition contradictoire pour que la règle puisse se déclencher, ou supprimez la règle.',
    'conflicting-rules':
      "Rendez les deux conditions mutuellement exclusives, ou accordez les effets pour que le résultat ne dépende pas de l'ordre des règles.",
    'redundant-rule': 'Supprimez la règle en double.',
    'shadowed-rule': 'Placez cette règle avant le blocage sans condition, ou supprimez-la.',
    'always-blocked':
      "Donnez une condition à la règle qui bloque, ou retirez les effets de succès qui ne peuvent jamais s'exécuter."
  }
};

/** The first letter of a sentence lowered, so it can follow a French colon. */
const afterColon = (sentence: string): string =>
  sentence.length > 0 ? sentence[0]!.toLowerCase() + sentence.slice(1) : sentence;

const hasLoadingOrErrorCoverage = (action: Action): boolean => {
  const scenarios = action.scenarios ?? [];
  return scenarios.some((sc) => {
    const overridePaths = sc.stateOverrides.map((o) => String(o.path).toLowerCase());
    const assertionPaths = (sc.expectedAssertions ?? []).map((a) => String(a.path).toLowerCase());
    const all = [...overridePaths, ...assertionPaths];
    return all.some((p) => p.includes('loading') || p.includes('error'));
  });
};

const hasBlockingValidationRule = (action: Action): boolean =>
  action.rules.some(
    (r) =>
      r.condition !== undefined &&
      'operator' in r.condition &&
      (r.condition.operator === 'is_false' || r.condition.operator === 'does_not_exist')
  );

/**
 * An action "does something" if it carries effects directly, if any of its
 * rules carries an effect (every Rule has a required `effect`), or if it has
 * onBlocked fallbacks. Counting rule-carried effects is what keeps the "no
 * effects" gap from crying wolf on a perfectly valid action whose entire
 * behavior lives in conditional rules (e.g. a tick whose set_state fires from
 * a rule, or a validation action that only blocks).
 */
const hasAnyEffect = (action: Action): boolean =>
  action.effects.length > 0 ||
  action.rules.length > 0 ||
  // `no_feedback` is the statement "a blocked attempt shows nothing": it answers
  // the blocked-run check, it is not something the action does.
  (action.onBlockedEffects ?? []).some((effect) => effect.type !== 'no_feedback');

/**
 * Every event name this action actually emits at runtime, gathered from
 * emit_event effects wherever they live: the action's own effects, its
 * onBlocked fallbacks, and any rule-carried effect. `Action.emittedEvents` is
 * a DECLARATION (a catalog the dashboard and coverage read); only an
 * emit_event *effect* triggers a cascade / `triggeredByEvent` handler at
 * runtime. Comparing the two catches the silent no-op where an action claims
 * to emit an event that nothing fires.
 */
const emittedEventNames = (action: Action): ReadonlySet<string> => {
  const names = new Set<string>();
  const scan = (effects: readonly Effect[] | undefined): void => {
    for (const e of effects ?? []) {
      if (e.type === 'emit_event') names.add(String(e.event));
    }
  };
  scan(action.effects);
  scan(action.onBlockedEffects);
  for (const r of action.rules) {
    if (r.effect.type === 'emit_event') names.add(String(r.effect.event));
  }
  return names;
};

/**
 * Pure detector. Walks the feature + implementation-status sidecar and
 * returns spec-depth gaps in priority order: critical first, then
 * recommended; stable surface-index / action-index ordering within each
 * group. Reuses existing entity references, no new validation fork. Every gap
 * carries its stable `code`; `reason` and `suggestedFix` follow `language`,
 * names from the model quoted as they are.
 */
export const detectSpecGaps = (
  feature: Feature,
  implementedCapabilityIds: ReadonlySet<string>,
  language: ReportLanguage = 'en'
): readonly SpecGap[] => {
  const fr = language === 'fr';
  const q = (name: string): string => quoteName('fr', name);
  const critical: SpecGap[] = [];
  const recommended: SpecGap[] = [];

  // Evolution proposals (dashed placeholders) are not committed behavior, so
  // a proposal named "Sign in with SSO" must NOT satisfy an expectedActions
  // entry of the same name.
  const allActionNames = new Set<string>();
  for (const s of feature.surfaces) {
    for (const c of s.actions) {
      if (!isEvolution(c)) allActionNames.add(normalizeName(c.name));
    }
  }

  // Feature-level: expectedActions without a matching Action.
  for (const expected of feature.expectedActions ?? []) {
    if (!allActionNames.has(normalizeName(expected))) {
      critical.push({
        code: 'missing-expected-action',
        severity: 'critical',
        entityType: 'feature',
        entityId: String(feature.id),
        entityName: feature.name,
        reason: fr
          ? `L'entrée ${q(expected)} de expectedActions n'a aucune action correspondante.`
          : `expectedActions entry "${expected}" has no matching Action.`,
        suggestedFix: fr ? `Ajoutez une action ${q(expected)}.` : `Add an Action for ${expected}`
      });
    }
  }

  // A surface counts as having state if it owns at least one stateDefinition
  // OR another surface shares one into it via stateDefinition.sharedWith.
  // Without this, a modal that legitimately operates entirely on shared state
  // (e.g. a payment-hold modal sharing payment.* from the parent screen)
  // gets flagged as critical even though every action on it reads + writes
  // state.
  const sharedIntoSurface = new Set<string>();
  for (const s of feature.surfaces) {
    for (const def of s.stateDefinitions) {
      for (const target of def.sharedWith ?? []) {
        sharedIntoSurface.add(String(target));
      }
    }
  }

  // Every invariant id in the feature, used to validate that a scoped
  // invariantRelaxation names an invariant that actually exists.
  const allInvariantIds = new Set<string>();
  for (const inv of feature.featureInvariants ?? []) allInvariantIds.add(String(inv.id));
  for (const s of feature.surfaces) {
    for (const inv of s.invariants) allInvariantIds.add(String(inv.id));
    for (const c of s.actions) for (const inv of c.invariants) allInvariantIds.add(String(inv.id));
  }

  feature.surfaces.forEach((surface: Surface) => {
    for (const definition of surface.stateDefinitions) {
      if (isStatePath(String(definition.path))) continue;
      critical.push({
        code: 'invalid-state-path',
        severity: 'critical',
        entityType: 'surface',
        entityId: String(surface.id),
        entityName: surface.name,
        reason: fr
          ? `La surface ${q(surface.name)} déclare un état à ${q(String(definition.path))}, qui n'est pas un chemin d'état valide (des noms séparés par des points, chacun commençant par une lettre ou un tiret bas)${NBSP}: rien ne peut donc le lire ni l'écrire, et le projet l'exclut de ses états canoniques.`
          : `Surface "${surface.name}" declares a state at "${String(definition.path)}", which is not a valid state path (dotted names, each starting with a letter or an underscore), so nothing can read or write it and the project leaves it out of its canonical states.`,
        suggestedFix: fr
          ? `Renommez l'état avec un chemin valide, par exemple ${q('drivers.first.name')} au lieu de ${q('driver.0.name')}, ou gardez la liste dans un état de type tableau.`
          : 'Rename the state to a valid path, e.g. "drivers.first.name" instead of "driver.0.name", or hold the list in an array state.'
      });
    }
    if (surface.stateDefinitions.length === 0 && !sharedIntoSurface.has(String(surface.id))) {
      critical.push({
        code: 'stateless-surface',
        severity: 'critical',
        entityType: 'surface',
        entityId: String(surface.id),
        entityName: surface.name,
        reason: fr
          ? `La surface ${q(surface.name)} ne déclare aucun état (stateDefinitions).`
          : `Surface "${surface.name}" has no stateDefinitions.`,
        suggestedFix: fr ? "Définissez au moins un chemin d'état." : 'Define at least one state path'
      });
    }

    surface.actions.forEach((cap: Action) => {
      // Skip Evolution proposals entirely: they're intentionally empty
      // dashed placeholders, so every gap check (no effects, no impl status…)
      // would fire falsely. They re-enter analysis once accepted.
      if (isEvolution(cap)) return;
      const roles = new Set<string>(cap.roles ?? []);
      const onAction = {
        entityType: 'action' as const,
        entityId: String(cap.id),
        entityName: cap.name
      };

      if (!hasAnyEffect(cap)) {
        critical.push({
          code: 'no-effects',
          severity: 'critical',
          ...onAction,
          reason: fr
            ? `L'action ${q(cap.name)} n'a aucun effet (ni sur l'action, ni dans ses règles, ni dans onBlocked).`
            : `Action "${cap.name}" has no effects (none on the action, its rules, or onBlocked).`,
          suggestedFix: fr
            ? 'Ajoutez au moins un effet, directement ou par une règle.'
            : 'Add at least one effect, directly or via a rule'
        });
      }

      // A feature saved through this server has every declared event wired to an
      // emit_event effect (FeatureEmittedEventsNormalizer), so this fires only on
      // a model written by another tool, or on one loaded read-only. It stays as
      // the statement of the rule: a declaration nothing emits is inert.
      const emitted = emittedEventNames(cap);
      for (const declared of cap.emittedEvents) {
        if (!emitted.has(String(declared))) {
          const english = {
            code: 'inert-emitted-event' as const,
            severity: 'recommended' as const,
            ...onAction,
            reason: `Action "${cap.name}" declares it emits "${declared}" but no emit_event effect fires it — the declaration is inert at runtime (no cascade or triggeredByEvent handler will run).`,
            suggestedFix: `Add an emit_event effect for "${declared}" (on the action or a rule), or remove it from emittedEvents`
          };
          recommended.push(
            fr
              ? {
                  ...english,
                  reason: `L'action ${q(cap.name)} déclare émettre ${q(String(declared))}, mais aucun effet emit_event ne l'émet${NBSP}: la déclaration est inerte à l'exécution (aucune cascade ni aucun gestionnaire triggeredByEvent ne s'exécutera).`,
                  suggestedFix: `Ajoutez un effet emit_event pour ${q(String(declared))} (sur l'action ou une règle), ou retirez-le de emittedEvents.`
                }
              : english
          );
        }
      }

      if (roles.has('destructive') && (cap.scenarios ?? []).length === 0) {
        critical.push({
          code: 'untested-destructive',
          severity: 'critical',
          ...onAction,
          reason: fr
            ? `L'action destructive ${q(cap.name)} n'a aucun scénario qui couvre son chemin.`
            : `Destructive action "${cap.name}" has no scenario covering its path.`,
          suggestedFix: fr
            ? 'Ajoutez un scénario qui couvre le chemin destructif.'
            : 'Add a scenario covering the destructive path'
        });
      }

      if (roles.has('async') && !hasLoadingOrErrorCoverage(cap)) {
        recommended.push({
          code: 'async-without-loading-error',
          severity: 'recommended',
          ...onAction,
          reason: fr
            ? `L'action asynchrone ${q(cap.name)} n'a aucun scénario qui définit ou vérifie un état de chargement ou d'erreur.`
            : `Async action "${cap.name}" has no scenario setting or asserting a loading/error state.`,
          suggestedFix: fr
            ? "Ajoutez des scénarios de chargement et d'erreur."
            : 'Add loading + error scenarios'
        });
      }

      if (roles.has('validation') && !hasBlockingValidationRule(cap)) {
        recommended.push({
          code: 'validation-without-blocking-rule',
          severity: 'recommended',
          ...onAction,
          reason: fr
            ? `L'action de validation ${q(cap.name)} n'a aucune règle avec l'opérateur is_false ou does_not_exist.`
            : `Validation action "${cap.name}" has no rule with operator is_false/does_not_exist.`,
          suggestedFix: fr
            ? 'Ajoutez une règle qui bloque une saisie invalide.'
            : 'Add a rule blocking invalid input'
        });
      }

      if (!implementedCapabilityIds.has(String(cap.id))) {
        recommended.push({
          code: 'not-implemented',
          severity: 'recommended',
          ...onAction,
          reason: fr
            ? `L'action ${q(cap.name)} n'a aucun statut d'implémentation (ImplementationStatus).`
            : `Action "${cap.name}" has no ImplementationStatus entry.`,
          suggestedFix: fr
            ? "Déclarez l'implémentation avec report_implementation_status."
            : 'Report implementation via report_implementation_status'
        });
      }

      // The blunt bypassInvariants relaxes EVERY invariant with no rationale.
      // Nudge toward the scoped, auditable form.
      if (cap.bypassInvariants === true) {
        recommended.push({
          code: 'bypass-invariants',
          severity: 'recommended',
          ...onAction,
          reason: fr
            ? `L'action ${q(cap.name)} utilise bypassInvariants, qui ignore sans rien dire tous les invariants après son exécution.`
            : `Action "${cap.name}" uses bypassInvariants, which silently skips every invariant after it runs.`,
          suggestedFix: fr
            ? 'Remplacez-le par invariantRelaxation, en ne nommant que les invariants que cette action doit assouplir, avec une justification.'
            : 'Replace it with invariantRelaxation naming only the invariants this action must relax, plus a rationale.'
        });
      }
      // A scoped relaxation that names an invariant which does not exist relaxes
      // nothing (or masks a rename); flag the dangling reference.
      for (const invId of cap.invariantRelaxation?.invariantIds ?? []) {
        if (!allInvariantIds.has(String(invId))) {
          recommended.push({
            code: 'dangling-invariant-relaxation',
            severity: 'recommended',
            ...onAction,
            subjectId: String(invId),
            reason: fr
              ? `L'action ${q(cap.name)} déclare invariantRelaxation pour ${q(String(invId))}, mais aucun invariant de la fonctionnalité ne porte cet identifiant.`
              : `Action "${cap.name}" declares invariantRelaxation for "${String(invId)}", but no invariant with that id exists in the feature.`,
            suggestedFix: fr
              ? "Corrigez l'identifiant de l'invariant, ou retirez-le de invariantRelaxation.invariantIds."
              : 'Fix the invariant id, or drop it from invariantRelaxation.invariantIds.'
          });
        }
      }

      // Decision-table analysis: contradictory, dead, redundant, or shadowed
      // rules. Every finding is provable from the rule set, so it is safe to
      // surface as a gap rather than a guess.
      for (const finding of analyzeActionDecisions(cap)) {
        const rule = cap.rules[(finding.rulePositions[0] ?? 0) - 1];
        (finding.severity === 'critical' ? critical : recommended).push({
          code: `decision:${finding.kind}`,
          severity: finding.severity,
          ...onAction,
          ...(rule ? { subjectId: String(rule.id) } : {}),
          reason: fr
            ? `L'action ${q(cap.name)}${NBSP}: ${afterColon(decisionDetail(finding.kind, cap.rules, finding.rulePositions, 'fr'))}`
            : `Action "${cap.name}": ${finding.detail}`,
          suggestedFix: DECISION_FIX[language][finding.kind]
        });
      }
    });

    if (surface.stateDefinitions.length > 1 && surface.transitions.length === 0) {
      recommended.push({
        code: 'untransitioned-states',
        severity: 'recommended',
        entityType: 'surface',
        entityId: String(surface.id),
        entityName: surface.name,
        reason: fr
          ? `La surface ${q(surface.name)} déclare plusieurs états mais aucune transition ne les relie.`
          : `Surface "${surface.name}" declares multiple states but no transitions wire them.`,
        suggestedFix: fr ? 'Ajoutez les transitions qui relient les états.' : 'Add transitions wiring the states'
      });
    }
  });

  // External dependencies: the boundary is where a lot of real logic (and
  // risk) lives. Nudge for the contract details code hides: a call with no
  // timeout, or an operation with no documented failure modes.
  const onFeature = {
    entityType: 'feature' as const,
    entityId: String(feature.id),
    entityName: feature.name
  };
  for (const dependency of feature.dependencies ?? []) {
    if (dependency.operations.length === 0) {
      recommended.push({
        code: 'dependency-without-operations',
        severity: 'recommended',
        ...onFeature,
        subjectId: String(dependency.id),
        reason: fr
          ? `La dépendance ${q(dependency.name)} ne déclare aucune opération.`
          : `Dependency "${dependency.name}" declares no operations.`,
        suggestedFix: fr
          ? 'Ajoutez les opérations que la fonctionnalité y appelle.'
          : 'Add the operations the feature invokes on it.'
      });
    }
    for (const operation of dependency.operations) {
      const call = `${dependency.name}.${operation.name}`;
      if (operation.timeout === undefined) {
        recommended.push({
          code: 'operation-without-timeout',
          severity: 'recommended',
          ...onFeature,
          subjectId: String(operation.id),
          reason: fr
            ? `L'opération externe ${q(call)} n'a aucun délai d'expiration documenté.`
            : `External operation "${call}" has no documented timeout.`,
          suggestedFix: fr
            ? "Fixez un délai d'expiration pour que la limite de l'échec soit explicite."
            : 'Set a timeout so the failure boundary is explicit.'
        });
      }
      if ((operation.failureModes?.length ?? 0) === 0) {
        recommended.push({
          code: 'operation-without-failure-modes',
          severity: 'recommended',
          ...onFeature,
          subjectId: String(operation.id),
          reason: fr
            ? `L'opération externe ${q(call)} n'a aucun mode d'échec documenté.`
            : `External operation "${call}" has no documented failure modes.`,
          suggestedFix: fr
            ? "Listez comment l'appel peut échouer (refusé, délai dépassé, indisponible), pour pouvoir modéliser les chemins de reprise."
            : 'List how the call can fail (declined, timeout, unavailable), so recovery paths can be modeled.'
        });
      }
    }
  }

  // Acceptance criteria are prose and are never scored, but one failure is
  // worth a line here: a criterion another one supersedes while it still says
  // `active` reads as current to anyone who opens it. Recommended, never
  // critical: it is a decision for the author, and nothing sets it for them.
  const criterionTitles = new Map(
    (feature.acceptanceCriteria ?? []).map((c) => [String(c.id), c.title] as const)
  );
  for (const standing of criterionStandings(feature)) {
    if (!standing.contested) continue;
    const title = criterionTitles.get(standing.criterionId) ?? standing.criterionId;
    const many = standing.supersededBy.length !== 1;
    recommended.push({
      code: 'contested-criterion',
      severity: 'recommended',
      entityType: 'criterion',
      entityId: standing.criterionId,
      entityName: criterionTitles.get(standing.criterionId) ?? '',
      reason: fr
        ? `Le critère d'acceptation ${q(title)} est toujours actif alors que ${standing.supersededBy.join(', ')} le ${many ? 'remplacent' : 'remplace'}.`
        : `Acceptance criterion "${title}" is still active while ${standing.supersededBy.join(', ')} supersede${many ? '' : 's'} it.`,
      suggestedFix: fr
        ? `Passez son statut à ${q('superseded')} (update_acceptance_criterion) s'il ne tient plus, ou changez la relation en ${q('refines')} ou ${q('exception_to')} s'il tient encore.`
        : 'Set its status to "superseded" (update_acceptance_criterion) if it no longer holds, or change the relation to "refines" / "exception_to" if it still does.'
    });
  }

  return [...critical, ...recommended];
};

/** The gaps a project's canonical states raise on this feature, in `language`. */
export const stateCoherenceGaps = (
  feature: Feature,
  states: ReturnType<typeof projectStateVariables>,
  features: readonly Feature[],
  language: ReportLanguage = 'en',
  projectInvariants: readonly Invariant[] = []
): SpecGap[] => {
  const gaps: SpecGap[] = [];
  for (const issue of stateCoherenceIssues(states, features, language, projectInvariants)) {
    const state = states.find((candidate) => String(candidate.id) === issue.stateId);
    // A declaration disagreement is reported by every feature it involves.
    if (issue.featureIds) {
      if (!issue.featureIds.includes(String(feature.id))) continue;
    } else if (
      state &&
      state.owner.featureId !== feature.id &&
      state.links?.dataField?.featureId !== feature.id
    )
      continue;
    const fr = language === 'fr';
    gaps.push({
      code: `state:${issue.kind}`,
      severity: issue.severity === 'error' ? 'critical' : 'recommended',
      entityType: 'feature',
      entityId: String(feature.id),
      entityName: feature.name,
      subjectId: issue.stateId,
      reason: fr
        ? `État canonique ${quoteName('fr', issue.path)}${NBSP}: ${afterColon(issue.message)}`
        : `Canonical state "${issue.path}": ${issue.message}`,
      suggestedFix:
        issue.kind === 'declaration-type-mismatch' || issue.kind === 'declaration-choices-mismatch'
          ? fr
            ? "Déclarez l'état de la même façon dans chaque feature (même type, mêmes valeurs), ou renommez-le dans celle qui parle d'autre chose."
            : 'Declare the state the same way in every feature (same kind of value, same choices), or rename it in the feature that means something else.'
          : issue.kind === 'missing-data-field'
          ? fr
            ? "Reliez la variable d'état à un champ d'entité existant, ou effacez le lien périmé."
            : 'Relink the state variable to an existing entity field, or clear the stale link.'
          : fr
            ? "Alignez le type ou le valueSetId du champ d'entité lié sur la variable d'état canonique."
            : 'Align the linked entity field type/valueSetId with the canonical state variable.'
    });
  }
  return gaps;
};

export const registerSpecGapsTool = (deps: ToolDeps): void => {
  const { server, repo, projectRepo, getImplementationStatus } = deps;
  // The proof module, where one was asked for: its gaps join the structural ones.
  const prover = activeProver(deps.prover ?? { state: 'not-asked' });
  const proofNote = prover?.toolNotes?.get_spec_gaps;

  server.registerTool(
    'get_spec_gaps',
    {
      description:
        'Diagnose spec depth: returns a prioritized to-do list of critical + recommended gaps grounded in existing entities. Critical gaps must be resolved before claiming the spec complete (missing expectedActions, stateless surfaces, effect-less actions, untested destructive actions, and decision-table defects: a rule whose condition can never hold, or two rules that fire on the same condition with disagreeing effects; an invariant or a reachability goal no state satisfies). Recommended gaps catch shallow modeling (async without loading/error coverage, validation without blocking rule, multi-state surface without transitions, action never implemented, emittedEvents declared but never fired by an emit_event effect, and redundant / shadowed / unconditionally-blocked rules). ' +
        (proofNote ? `${proofNote} ` : '') +
        'Every gap carries a stable `code` (e.g. no-effects, not-implemented, decision:dead-rule) and, when it is about a rule, invariant, goal, state or operation rather than the entity itself, its `subjectId`: sort and match gaps by code, never by wording. Use after build/edit sessions, especially after a "don\'t-ask-just-build" pass.',
      inputSchema: {
        featureId: z.string(),
        language: z
          .enum(['en', 'fr'])
          .optional()
          .describe(
            "The language the project's spec is written in; generated texts follow it (each gap's reason and suggested fix, the leads, generated scenario names and descriptions), while names from the model (state paths, actions, rules, enumeration values) stay as authored and every gap's `code` stays the same; default English."
          ),
        ...(prover
          ? {
              complete: z
                .boolean()
                .optional()
                .describe(
                  "Ask the full proof: after the solver's first pass, the phases it left open are asked again, each with a time of its own (up to about three times the first pass). Without it the answer is the first pass, at once, and `proof.moreToCome` says whether asking with complete:true may settle more."
                ),
              firstPass: z
                .boolean()
                .optional()
                .describe('The first pass, which is also the default: kept for callers that ask for it by name.')
            }
          : {})
      }
    },
    async ({ featureId, language = 'en', complete = false }) => {
      try {
        featureId = await expandFeatureId(repo, featureId);
      } catch (e) {
        return errorText((e as Error).message);
      }
      const exp = await repo.get(asFeatureId(featureId));
      if (!exp) return errorText(`Feature ${featureId} not found`);
      const status = await getImplementationStatus(asFeatureId(featureId));
      const implementedIds = new Set<string>(
        (status?.actions ?? []).map((c) => String(c.actionId))
      );
      // One pass over the projects and one over the features: a `get` per member
      // re-read the whole store each time, so this tool cost N reads of N files.
      const owner = await findOwningProject(projectRepo, String(exp.id));
      const projectFeatures = owner
        ? (await loadFeaturesByIds(repo, owner.featureIds)).filter(
            (feature): feature is Feature => feature !== null
          )
        : [];
      // The proof module proves, for every value at once, what the structural
      // checks can only suspect, on every read: never behind an option. The
      // first pass by default: readers with a budget of seconds (a page, the
      // Control Center) get it at once; the full proof only when asked.
      const proved = prover
        ? await prover.specGaps(exp, {
            projectFeatures,
            ...(owner?.projectInvariants?.length ? { projectInvariants: owner.projectInvariants } : {}),
            complete: complete === true,
            language,
            scenarioRuns: runScenariosUseCase()({
              feature: exp,
              projectFeatures: projectFeatures.filter((feature) => feature.id !== exp.id),
              ...(owner?.projectInvariants?.length ? { projectInvariants: owner.projectInvariants } : {})
            }).results
          })
        : undefined;
      const gaps: readonly (SpecGap | ProverGap)[] = [
        ...detectSpecGaps(exp, implementedIds, language),
        ...(proved?.gaps ?? []),
        ...(owner
          ? stateCoherenceGaps(
              exp,
              projectStateVariables(owner, projectFeatures),
              projectFeatures,
              language,
              owner.projectInvariants ?? []
            )
          : [])
      ];
      const ordered = [
        ...gaps.filter((gap) => gap.severity === 'critical'),
        ...gaps.filter((gap) => gap.severity !== 'critical')
      ];
      return text(
        trackTokens('get_spec_gaps', {
          gaps: ordered,
          ...(proved ? { proof: proved.proof } : {})
        })
      );
    }
  );
};
