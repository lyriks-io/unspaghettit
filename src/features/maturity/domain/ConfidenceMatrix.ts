import { committedActions } from '$features/behavior-model/domain/entities/Action';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import { analyzeActionDecisions } from '$features/behavior-model/domain/services/DecisionAnalysis';
import { frenchTypography, type ReportLanguage } from '$shared/language';

/** English as is; French with its typography (no-break spaces). */
const say = (lang: ReportLanguage, en: string, fr: string): string =>
  lang === 'fr' ? frenchTypography(fr) : en;

/** The French word for a count: singular up to 1, plural from 2. */
const frWord = (n: number, one: string, many: string): string => (n >= 2 ? many : one);

/**
 * A single maturity percentage mixes very different things — "are the fields
 * filled in?" and "is the behavior actually covered and consistent?" — so a
 * high number can hide a weak spot. The confidence matrix breaks it into
 * independent dimensions, and reports the WEAKEST one as the headline so a
 * strong average can never bury a zero.
 *
 * It is built to be honest, explainable, and trustworthy:
 *   - HONEST:      overall = min(dimensions), not an average.
 *   - EXPLAINABLE: every dimension carries the exact counts it was derived from
 *                  and a plain-language `detail`, so the number is auditable.
 *   - TRUSTWORTHY: each dimension is a share of concrete, checkable facts about
 *                  the model — no opaque weighting, nothing self-reported.
 */
export type ConfidenceDimensionKey =
  | 'structural'
  | 'behavioral'
  | 'guardrails'
  | 'executability'
  | 'consistency';

export type ConfidenceDimension = {
  readonly key: ConfidenceDimensionKey;
  readonly label: string;
  /** 0..100. A dimension with nothing to measure scores 100 (nothing is wrong). */
  readonly score: number;
  /** Numerator: the checkable facts that hold. */
  readonly covered: number;
  /** Denominator: the facts in scope. 0 means "not applicable here". */
  readonly total: number;
  /** Plain-language explanation with the counts, so the score is auditable. */
  readonly detail: string;
};

export type ConfidenceMatrix = {
  readonly dimensions: readonly ConfidenceDimension[];
  /** The honest headline: the weakest dimension's score. */
  readonly overall: number;
  readonly weakest: { readonly key: ConfidenceDimensionKey; readonly score: number };
};

const share = (covered: number, total: number): number =>
  total === 0 ? 100 : Math.round((covered / total) * 100);

/**
 * Compute the confidence matrix. `structural` is the already-computed maturity
 * tally (passed / max checks) so we do not re-run the scorer; every other
 * dimension is derived directly from the committed model.
 */
export const computeConfidence = (
  feature: Feature,
  structural: { readonly passed: number; readonly total: number },
  language: ReportLanguage = 'en'
): ConfidenceMatrix => {
  const lang = language;
  // Presentation surfaces are excluded from the feature rollup (same rule as
  // MaturityScorer): scoring a view-only screen's actions would only skew the
  // denominators without saying anything about the modeled behavior.
  const surfaces = feature.surfaces.filter((s) => !(s.presentation ?? false));
  const actions = surfaces.flatMap((surface) => committedActions(surface.actions));
  const featureInvariantCount = feature.featureInvariants?.length ?? 0;

  // Behavioral coverage: of the actions that actually do something worth an
  // example (rules, effects, or inputs), how many carry at least one scenario.
  const nonTrivial = actions.filter(
    (a) => a.rules.length > 0 || a.effects.length > 0 || a.parameters.length > 0
  );
  const withScenario = nonTrivial.filter((a) => (a.scenarios ?? []).length > 0);

  // Guardrails: surfaces protected by an invariant — its own, one on an action,
  // or a feature-level invariant that constrains every surface's post-state.
  const guarded = surfaces.filter(
    (s) =>
      s.invariants.length > 0 ||
      s.actions.some((a) => a.invariants.length > 0) ||
      featureInvariantCount > 0
  );

  // Executability: actions the simulator can actually run to an effect (they
  // have effects, rules, or outcomes rather than an empty body).
  const runnable = actions.filter(
    (a) => a.effects.length > 0 || a.rules.length > 0 || (a.outcomes?.length ?? 0) > 0
  );

  // Consistency: actions free of a provable decision-table contradiction (a rule
  // that can never fire, or two rules that disagree on the same condition).
  const conflicted = actions.filter((a) =>
    analyzeActionDecisions(a).some((f) => f.severity === 'critical')
  );

  const dimensions: ConfidenceDimension[] = [
    {
      key: 'structural',
      label: say(lang, 'Structural completeness', 'Complétude structurelle'),
      score: share(structural.passed, structural.total),
      covered: structural.passed,
      total: structural.total,
      detail: say(
        lang,
        `${structural.passed} of ${structural.total} maturity checks pass`,
        `${structural.passed} ${frWord(structural.passed, 'vérification', 'vérifications')} de maturité sur ${structural.total} ${frWord(structural.passed, 'réussit', 'réussissent')}`
      )
    },
    {
      key: 'behavioral',
      label: say(lang, 'Behavioral coverage', 'Couverture comportementale'),
      score: share(withScenario.length, nonTrivial.length),
      covered: withScenario.length,
      total: nonTrivial.length,
      detail:
        nonTrivial.length === 0
          ? say(
              lang,
              'no non-trivial actions to cover with scenarios',
              'aucune action non triviale à couvrir par des scénarios'
            )
          : say(
              lang,
              `${withScenario.length} of ${nonTrivial.length} non-trivial actions have a scenario`,
              `${withScenario.length} ${frWord(withScenario.length, 'action non triviale', 'actions non triviales')} sur ${nonTrivial.length} ${frWord(withScenario.length, 'a', 'ont')} un scénario`
            )
    },
    {
      key: 'guardrails',
      label: say(lang, 'Guardrails', 'Garde-fous'),
      score: share(guarded.length, surfaces.length),
      covered: guarded.length,
      total: surfaces.length,
      detail:
        surfaces.length === 0
          ? say(lang, 'no surfaces yet', "aucune surface pour l'instant")
          : say(
              lang,
              `${guarded.length} of ${surfaces.length} surfaces are covered by an invariant`,
              `${guarded.length} ${frWord(guarded.length, 'surface', 'surfaces')} sur ${surfaces.length} ${frWord(guarded.length, 'est couverte', 'sont couvertes')} par un invariant`
            )
    },
    {
      key: 'executability',
      label: say(lang, 'Executability', 'Exécutabilité'),
      score: share(runnable.length, actions.length),
      covered: runnable.length,
      total: actions.length,
      detail:
        actions.length === 0
          ? say(lang, 'no actions yet', "aucune action pour l'instant")
          : say(
              lang,
              `${runnable.length} of ${actions.length} actions run to an effect, rule, or outcome`,
              `${runnable.length} ${frWord(runnable.length, 'action', 'actions')} sur ${actions.length} ${frWord(runnable.length, "s'exécute", "s'exécutent")} jusqu'à un effet, une règle ou un résultat`
            )
    },
    {
      key: 'consistency',
      label: say(lang, 'Consistency', 'Cohérence'),
      score: share(actions.length - conflicted.length, actions.length),
      covered: actions.length - conflicted.length,
      total: actions.length,
      detail:
        conflicted.length === 0
          ? say(lang, 'no contradictory or dead rules', 'aucune règle contradictoire ou morte')
          : say(
              lang,
              `${conflicted.length} of ${actions.length} actions have a contradictory or dead rule`,
              `${conflicted.length} ${frWord(conflicted.length, 'action', 'actions')} sur ${actions.length} ${frWord(conflicted.length, 'a', 'ont')} une règle contradictoire ou morte`
            )
    }
  ];

  const weakest = dimensions.reduce((min, d) => (d.score < min.score ? d : min), dimensions[0]!);

  return {
    dimensions,
    overall: weakest.score,
    weakest: { key: weakest.key, score: weakest.score }
  };
};
