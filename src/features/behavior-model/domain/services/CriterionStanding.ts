import type {
  AcceptanceCriterion,
  CriterionStatus
} from '$features/behavior-model/domain/entities/AcceptanceCriterion';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';

/**
 * Where each acceptance criterion of a feature stands, computed on read.
 *
 * A criterion is prose, and prose ages silently: one that silenced footsteps in
 * water stayed readable as current after two later criteria brought shallow-water
 * footsteps back. Authors now say which criterion supersedes which, and every
 * read derives the other direction from that, so the replaced one names its
 * successors even when nobody went back to mark it.
 *
 * Pure, and deliberately outside the MaturityScorer: a criterion's standing is
 * information for a reader, never a score.
 */
export type CriterionStanding = {
  readonly criterionId: string;
  /** The declared status, defaults applied (absent means `active`). */
  readonly status: CriterionStatus;
  /** Criteria of THIS feature that declare they supersede it. Drafts do not count. */
  readonly supersededBy: readonly string[];
  /** One line a reader can take at face value. See {@link standingLine}. */
  readonly standing: string;
  /** True when a successor exists while the status still says `active`. */
  readonly contested: boolean;
};

export const effectiveCriterionStatus = (
  criterion: Pick<AcceptanceCriterion, 'status'>
): CriterionStatus => criterion.status ?? 'active';

/** True when the relation points inside `feature` (no featureId, or this feature's own). */
const isLocal = (feature: Feature, relationFeatureId: string | undefined): boolean =>
  relationFeatureId === undefined || relationFeatureId === String(feature.id);

/**
 * For each criterion id, the criteria of this feature that supersede it. A draft
 * is a proposal: it supersedes nothing until it is made active, so it is left
 * out, and marking the old criterion is not yet asked of anyone.
 */
const successorsById = (feature: Feature): ReadonlyMap<string, readonly string[]> => {
  const successors = new Map<string, string[]>();
  for (const criterion of feature.acceptanceCriteria ?? []) {
    if (effectiveCriterionStatus(criterion) === 'draft') continue;
    for (const relation of criterion.relations ?? []) {
      if (relation.kind !== 'supersedes' || !isLocal(feature, relation.featureId)) continue;
      const list = successors.get(relation.criterionId) ?? [];
      if (!list.includes(String(criterion.id))) list.push(String(criterion.id));
      successors.set(relation.criterionId, list);
    }
  }
  return successors;
};

/**
 * The one-line standing:
 *  - `draft`
 *  - `superseded by <ids>` / `superseded (no successor named)`
 *  - `active`
 *  - `active, but superseded by <ids>`: the contested case, where a successor
 *    exists and the status was never updated. It is spelled out rather than left
 *    as `active`, because reading as current is exactly the failure this exists
 *    to prevent. The status itself is never changed here: authors decide.
 */
export const standingLine = (status: CriterionStatus, supersededBy: readonly string[]): string => {
  if (status === 'draft') return 'draft';
  const successors = supersededBy.join(', ');
  if (status === 'superseded') {
    return supersededBy.length > 0
      ? `superseded by ${successors}`
      : 'superseded (no successor named)';
  }
  return supersededBy.length > 0 ? `active, but superseded by ${successors}` : 'active';
};

/** The standing of every criterion of the feature, in model order. */
export const criterionStandings = (feature: Feature): readonly CriterionStanding[] => {
  const successors = successorsById(feature);
  return (feature.acceptanceCriteria ?? []).map((criterion) => {
    const status = effectiveCriterionStatus(criterion);
    const supersededBy = successors.get(String(criterion.id)) ?? [];
    return {
      criterionId: String(criterion.id),
      status,
      supersededBy,
      standing: standingLine(status, supersededBy),
      contested: status === 'active' && supersededBy.length > 0
    };
  });
};

/**
 * One sentence per contested criterion, for the answer to a write and for the
 * advisory lists. Empty when every replaced criterion says so.
 */
export const criterionStandingWarnings = (feature: Feature): readonly string[] => {
  const titles = new Map(
    (feature.acceptanceCriteria ?? []).map((c) => [String(c.id), c.title] as const)
  );
  return criterionStandings(feature)
    .filter((standing) => standing.contested)
    .map(
      (standing) =>
        `Acceptance criterion ${standing.criterionId} ("${titles.get(standing.criterionId) ?? ''}") is still active while ${standing.supersededBy.join(', ')} supersede${standing.supersededBy.length === 1 ? 's' : ''} it. Set its status to "superseded" if it no longer holds, or change the relation to "refines" / "exception_to" if it still does.`
    );
};
