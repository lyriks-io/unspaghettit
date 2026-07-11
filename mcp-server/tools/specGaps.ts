import { z } from 'zod';
import type { Action } from '../../src/features/behavior-model/domain/entities/Action';
import { isEvolution } from '../../src/features/behavior-model/domain/entities/Action';
import {
  analyzeActionDecisions,
  type DecisionFindingKind
} from '../../src/features/behavior-model/domain/services/DecisionAnalysis';
import type { Effect } from '../../src/features/behavior-model/domain/value-objects/Effect';
import type { Feature } from '../../src/features/behavior-model/domain/entities/Feature';
import type { Surface } from '../../src/features/behavior-model/domain/entities/Surface';
import { asFeatureId } from '../../src/features/behavior-model/domain/value-objects/ids';
import { trackTokens } from '../metrics';
import { errorText, text, type ToolDeps } from './_shared';
import { expandFeatureId } from './short-ids';

type Severity = 'critical' | 'recommended';
type EntityKind = 'feature' | 'surface' | 'action';

export type SpecGap = {
  readonly severity: Severity;
  readonly entityType: EntityKind;
  readonly entityId: string;
  readonly entityName: string;
  readonly reason: string;
  readonly suggestedFix: string;
};

const normalizeName = (s: string): string => s.trim().toLowerCase();

const DECISION_FIX: Record<DecisionFindingKind, string> = {
  'dead-rule': 'Fix the contradictory condition so the rule can fire, or remove the rule.',
  'conflicting-rules':
    'Make the two conditions mutually exclusive, or reconcile the effects so the outcome does not depend on rule order.',
  'redundant-rule': 'Remove the duplicate rule.',
  'shadowed-rule': 'Move this rule before the unconditional block, or remove it.',
  'always-blocked': 'Give the blocking rule a condition, or drop the success effects that can never run.'
};

const hasLoadingOrErrorCoverage = (action: Action): boolean => {
  const scenarios = action.scenarios ?? [];
  return scenarios.some((sc) => {
    const overridePaths = sc.stateOverrides.map((o) => String(o.path).toLowerCase());
    const assertionPaths = (sc.expectedAssertions ?? []).map((a) =>
      String(a.path).toLowerCase()
    );
    const all = [...overridePaths, ...assertionPaths];
    return all.some((p) => p.includes('loading') || p.includes('error'));
  });
};

const hasBlockingValidationRule = (action: Action): boolean =>
  action.rules.some(
    (r) => r.condition.operator === 'is_false' || r.condition.operator === 'does_not_exist'
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
  (action.onBlockedEffects?.length ?? 0) > 0;

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
 * group. Reuses existing entity references, no new validation fork.
 */
export const detectSpecGaps = (
  feature: Feature,
  implementedCapabilityIds: ReadonlySet<string>
): readonly SpecGap[] => {
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
        severity: 'critical',
        entityType: 'feature',
        entityId: String(feature.id),
        entityName: feature.name,
        reason: `expectedActions entry "${expected}" has no matching Action.`,
        suggestedFix: `Add an Action for ${expected}`
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

  // Every invariant id in the feature — used to validate that a scoped
  // invariantRelaxation names an invariant that actually exists.
  const allInvariantIds = new Set<string>();
  for (const inv of feature.featureInvariants ?? []) allInvariantIds.add(String(inv.id));
  for (const s of feature.surfaces) {
    for (const inv of s.invariants) allInvariantIds.add(String(inv.id));
    for (const c of s.actions) for (const inv of c.invariants) allInvariantIds.add(String(inv.id));
  }

  feature.surfaces.forEach((surface: Surface, surfaceIndex: number) => {
    if (
      surface.stateDefinitions.length === 0 &&
      !sharedIntoSurface.has(String(surface.id))
    ) {
      critical.push({
        severity: 'critical',
        entityType: 'surface',
        entityId: String(surface.id),
        entityName: surface.name,
        reason: `Surface "${surface.name}" has no stateDefinitions.`,
        suggestedFix: 'Define at least one state path'
      });
    }

    surface.actions.forEach((cap: Action, capIndex: number) => {
      // Skip Evolution proposals entirely: they're intentionally empty
      // dashed placeholders, so every gap check (no effects, no impl status…)
      // would fire falsely. They re-enter analysis once accepted.
      if (isEvolution(cap)) {
        void capIndex;
        return;
      }
      const roles = new Set<string>(cap.roles ?? []);

      if (!hasAnyEffect(cap)) {
        critical.push({
          severity: 'critical',
          entityType: 'action',
          entityId: String(cap.id),
          entityName: cap.name,
          reason: `Action "${cap.name}" has no effects (none on the action, its rules, or onBlocked).`,
          suggestedFix: 'Add at least one effect, directly or via a rule'
        });
      }

      // emittedEvents is a declaration; only an emit_event *effect* fires a
      // cascade at runtime. Flag any declared event that nothing emits so a
      // dangling declaration doesn't read as working wiring.
      const emitted = emittedEventNames(cap);
      for (const declared of cap.emittedEvents) {
        if (!emitted.has(String(declared))) {
          recommended.push({
            severity: 'recommended',
            entityType: 'action',
            entityId: String(cap.id),
            entityName: cap.name,
            reason: `Action "${cap.name}" declares it emits "${declared}" but no emit_event effect fires it — the declaration is inert at runtime (no cascade or triggeredByEvent handler will run).`,
            suggestedFix: `Add an emit_event effect for "${declared}" (on the action or a rule), or remove it from emittedEvents`
          });
        }
      }

      if (roles.has('destructive') && (cap.scenarios ?? []).length === 0) {
        critical.push({
          severity: 'critical',
          entityType: 'action',
          entityId: String(cap.id),
          entityName: cap.name,
          reason: `Destructive action "${cap.name}" has no scenario covering its path.`,
          suggestedFix: 'Add a scenario covering the destructive path'
        });
      }

      if (roles.has('async') && !hasLoadingOrErrorCoverage(cap)) {
        recommended.push({
          severity: 'recommended',
          entityType: 'action',
          entityId: String(cap.id),
          entityName: cap.name,
          reason: `Async action "${cap.name}" has no scenario setting or asserting a loading/error state.`,
          suggestedFix: 'Add loading + error scenarios'
        });
      }

      if (roles.has('validation') && !hasBlockingValidationRule(cap)) {
        recommended.push({
          severity: 'recommended',
          entityType: 'action',
          entityId: String(cap.id),
          entityName: cap.name,
          reason: `Validation action "${cap.name}" has no rule with operator is_false/does_not_exist.`,
          suggestedFix: 'Add a rule blocking invalid input'
        });
      }

      if (!implementedCapabilityIds.has(String(cap.id))) {
        recommended.push({
          severity: 'recommended',
          entityType: 'action',
          entityId: String(cap.id),
          entityName: cap.name,
          reason: `Action "${cap.name}" has no ImplementationStatus entry.`,
          suggestedFix: 'Report implementation via report_implementation_status'
        });
      }

      // The blunt bypassInvariants relaxes EVERY invariant with no rationale.
      // Nudge toward the scoped, auditable form.
      if (cap.bypassInvariants === true) {
        recommended.push({
          severity: 'recommended',
          entityType: 'action',
          entityId: String(cap.id),
          entityName: cap.name,
          reason: `Action "${cap.name}" uses bypassInvariants, which silently skips every invariant after it runs.`,
          suggestedFix:
            'Replace it with invariantRelaxation naming only the invariants this action must relax, plus a rationale.'
        });
      }
      // A scoped relaxation that names an invariant which does not exist relaxes
      // nothing (or masks a rename); flag the dangling reference.
      for (const invId of cap.invariantRelaxation?.invariantIds ?? []) {
        if (!allInvariantIds.has(String(invId))) {
          recommended.push({
            severity: 'recommended',
            entityType: 'action',
            entityId: String(cap.id),
            entityName: cap.name,
            reason: `Action "${cap.name}" declares invariantRelaxation for "${String(invId)}", but no invariant with that id exists in the feature.`,
            suggestedFix: 'Fix the invariant id, or drop it from invariantRelaxation.invariantIds.'
          });
        }
      }

      // Decision-table analysis: contradictory, dead, redundant, or shadowed
      // rules. Every finding is provable from the rule set, so it is safe to
      // surface as a gap rather than a guess.
      for (const finding of analyzeActionDecisions(cap)) {
        (finding.severity === 'critical' ? critical : recommended).push({
          severity: finding.severity,
          entityType: 'action',
          entityId: String(cap.id),
          entityName: cap.name,
          reason: `Action "${cap.name}": ${finding.detail}`,
          suggestedFix: DECISION_FIX[finding.kind]
        });
      }

      // surfaceIndex / capIndex are captured implicitly: forEach iterates in
      // declaration order and we push as we go.
      void surfaceIndex;
      void capIndex;
    });

    if (surface.stateDefinitions.length > 1 && surface.transitions.length === 0) {
      recommended.push({
        severity: 'recommended',
        entityType: 'surface',
        entityId: String(surface.id),
        entityName: surface.name,
        reason: `Surface "${surface.name}" declares multiple states but no transitions wire them.`,
        suggestedFix: 'Add transitions wiring the states'
      });
    }
  });

  // External dependencies: the boundary is where a lot of real logic (and
  // risk) lives. Nudge for the contract details code hides — a call with no
  // timeout, or an operation with no documented failure modes.
  for (const dependency of feature.dependencies ?? []) {
    if (dependency.operations.length === 0) {
      recommended.push({
        severity: 'recommended',
        entityType: 'feature',
        entityId: String(feature.id),
        entityName: feature.name,
        reason: `Dependency "${dependency.name}" declares no operations.`,
        suggestedFix: 'Add the operations the feature invokes on it.'
      });
    }
    for (const operation of dependency.operations) {
      if (operation.timeout === undefined) {
        recommended.push({
          severity: 'recommended',
          entityType: 'feature',
          entityId: String(feature.id),
          entityName: feature.name,
          reason: `External operation "${dependency.name}.${operation.name}" has no documented timeout.`,
          suggestedFix: 'Set a timeout so the failure boundary is explicit.'
        });
      }
      if ((operation.failureModes?.length ?? 0) === 0) {
        recommended.push({
          severity: 'recommended',
          entityType: 'feature',
          entityId: String(feature.id),
          entityName: feature.name,
          reason: `External operation "${dependency.name}.${operation.name}" has no documented failure modes.`,
          suggestedFix: 'List how the call can fail (declined, timeout, unavailable), so recovery paths can be modeled.'
        });
      }
    }
  }

  return [...critical, ...recommended];
};

export const registerSpecGapsTool = (deps: ToolDeps): void => {
  const { server, repo, getImplementationStatus } = deps;

  server.registerTool(
    'get_spec_gaps',
    {
      description:
        'Diagnose spec depth: returns a prioritized to-do list of critical + recommended gaps grounded in existing entities. Critical gaps must be resolved before claiming the spec complete (missing expectedActions, stateless surfaces, effect-less actions, untested destructive actions, and decision-table defects: a rule whose condition can never hold, or two rules that fire on the same condition with disagreeing effects). Recommended gaps catch shallow modeling (async without loading/error coverage, validation without blocking rule, multi-state surface without transitions, action never implemented, emittedEvents declared but never fired by an emit_event effect, and redundant / shadowed / unconditionally-blocked rules). Use after build/edit sessions, especially after a "don\'t-ask-just-build" pass.',
      inputSchema: { featureId: z.string() }
    },
    async ({ featureId }) => {
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
      const gaps = detectSpecGaps(exp, implementedIds);
      return text(trackTokens('get_spec_gaps', { gaps }));
    }
  );
};
