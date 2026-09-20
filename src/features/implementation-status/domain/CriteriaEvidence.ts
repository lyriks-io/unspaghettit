import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import { criterionStandings } from '$features/behavior-model/domain/services/CriterionStanding';
import { elementVersionOf } from '$features/behavior-model/domain/services/FeatureElementVersions';
import type {
  CriterionEvidence,
  CriterionVerification,
  ImplementationStatus
} from '$features/implementation-status/domain/ImplementationStatus';

/**
 * The evidence read model: what the status record KEEPS about each acceptance
 * criterion and about proof against the code, laid against the feature as it is
 * now.
 *
 * A sync answers these once, to whoever ran it. Everyone else (a dashboard, a
 * host that never holds the index, the next session) reads them from the record,
 * so the record has to be judged against the current spec on the way out: a
 * criterion reworded since its check was written is stale, and a record whose
 * criterion is gone describes nothing.
 *
 * Pure, and counts only: none of this feeds maturity or a verification verdict.
 */
export type CriterionEvidenceState = 'verified' | 'failing' | 'unverified' | 'none';

export type CriterionEvidenceRow = {
  readonly criterionId: string;
  readonly title: string;
  /** The computed one-line standing (see CriterionStanding). */
  readonly standing: string;
  readonly key: string;
  /** Whether a sync ever kept a record for this criterion. */
  readonly indexed: boolean;
  readonly state: CriterionEvidenceState;
  /** True when the criterion changed after the spec version its check was written against. */
  readonly stale: boolean;
  readonly file?: string;
  readonly line?: number;
  readonly verification?: CriterionVerification;
  readonly specVersion?: string;
  readonly syncedAt?: string;
};

export type CriteriaEvidenceReport = {
  /** One row per criterion of the feature, in model order. */
  readonly criteria: readonly CriterionEvidenceRow[];
  /** Records left out because their criterion no longer exists in the feature. */
  readonly orphanedCriteria: number;
};

/**
 * `verified` and `failing` repeat what the last recorded run said; `unverified`
 * is a record with no run to read; `none` is no record at all.
 */
export const criterionEvidenceState = (
  record: Pick<CriterionEvidence, 'verification'> | undefined
): CriterionEvidenceState => {
  if (!record) return 'none';
  const passed = record.verification?.lastResult?.passed;
  if (passed === undefined) return 'unverified';
  return passed ? 'verified' : 'failing';
};

/**
 * Whether the criterion moved after the check was written. The comparison is the
 * one get_drift makes for the same index entry (the element's own stamp, else
 * the feature's `updatedAt` for a snapshot written before per-element stamps),
 * so the two reads cannot disagree about one criterion. A record without a
 * readable `specVersion` cannot be judged and is not called stale: drift calls
 * that case unversioned, which is a different thing to fix.
 */
export const isCriterionEvidenceStale = (
  feature: Feature,
  record: Pick<CriterionEvidence, 'key' | 'specVersion'>
): boolean => {
  if (!record.specVersion) return false;
  const written = Date.parse(record.specVersion);
  const current = Date.parse(elementVersionOf(feature, record.key) ?? String(feature.updatedAt));
  if (Number.isNaN(written) || Number.isNaN(current)) return false;
  return current > written;
};

/**
 * Every criterion of `feature` against the records kept in `status`. A criterion
 * no sync ever named is listed all the same (`indexed: false`, state `none`),
 * because "nothing checks this" is the answer a reader came for.
 */
export const criteriaEvidenceReport = (
  feature: Feature,
  status: Pick<ImplementationStatus, 'criteria'> | null
): CriteriaEvidenceReport => {
  const records = new Map((status?.criteria ?? []).map((r) => [r.criterionId, r] as const));
  const standings = new Map(criterionStandings(feature).map((s) => [s.criterionId, s.standing]));
  const criteria = (feature.acceptanceCriteria ?? []).map((criterion): CriterionEvidenceRow => {
    const criterionId = String(criterion.id);
    const record = records.get(criterionId);
    return {
      criterionId,
      title: criterion.title,
      standing: standings.get(criterionId) ?? 'active',
      key: record?.key ?? `criterion:${criterionId}`,
      indexed: record !== undefined,
      state: criterionEvidenceState(record),
      stale: record !== undefined && isCriterionEvidenceStale(feature, record),
      ...(record?.file !== undefined ? { file: record.file } : {}),
      ...(record?.line !== undefined ? { line: record.line } : {}),
      ...(record?.verification !== undefined ? { verification: record.verification } : {}),
      ...(record?.specVersion !== undefined ? { specVersion: record.specVersion } : {}),
      ...(record !== undefined ? { syncedAt: record.syncedAt } : {})
    };
  });
  const known = new Set(criteria.map((row) => row.criterionId));
  return {
    criteria,
    orphanedCriteria: [...records.keys()].filter((id) => !known.has(id)).length
  };
};

export type VerifiedActions = {
  /** Reported actions whose index entry carried `verifiedAt` at the last sync. */
  readonly actions: number;
  /** Actions that have a report at all. */
  readonly total: number;
};

/**
 * How many reported actions are PROVEN against the code rather than claimed.
 * Counted over the actions that have a report: an action nobody mapped has no
 * claim to prove yet, and get_implementation_gaps is what lists those.
 */
export const verifiedActionsOf = (
  status: Pick<ImplementationStatus, 'actions'> | null
): VerifiedActions => {
  const reported = status?.actions ?? [];
  return {
    actions: reported.filter((a) => Boolean(a.auditMeta?.verifiedAt)).length,
    total: reported.length
  };
};
