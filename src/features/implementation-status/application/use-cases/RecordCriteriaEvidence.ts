import type { FeatureRepository } from '$features/behavior-model/application/ports/FeatureRepository';
import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';
import type { Clock } from '$shared/domain/Clock';
import type { ImplementationStatusRepository } from '$features/implementation-status/application/ports/ImplementationStatusRepository';
import {
  emptyImplementationStatus,
  removeCriterionEvidence,
  upsertCriterionEvidence,
  type CriterionEvidence,
  type ImplementationStatus
} from '$features/implementation-status/domain/ImplementationStatus';
import { FeatureNotFoundForReportError } from './ReportImplementationStatus';

/** One criterion's evidence as a sync read it; the use case stamps `key` and `syncedAt`. */
export type CriterionEvidenceInput = Omit<CriterionEvidence, 'key' | 'syncedAt'>;

export type RecordCriteriaEvidenceInput = {
  readonly featureId: FeatureId;
  /** Criteria the index named with a live entry: their record is replaced. */
  readonly evidence: readonly CriterionEvidenceInput[];
  /** Criteria the index named as `missing`: their record is dropped. */
  readonly missing: readonly string[];
};

export type RecordCriteriaEvidenceOutput = {
  readonly featureId: FeatureId;
  readonly revision: number;
  readonly updatedAt: string;
  readonly written: number;
  readonly removed: number;
  /** Ids the feature holds no criterion for. Never kept: a record must describe something. */
  readonly rejected: readonly string[];
};

/**
 * Keep what a sync said about the acceptance criteria of one feature.
 *
 * The index is partial by nature, so this only ever speaks for the criteria it
 * was given: a criterion absent from both lists keeps whatever record it had,
 * exactly as an action absent from the index keeps its report. One load and one
 * save per call, and no save at all when nothing changed, so a sync whose index
 * names no criterion leaves the record byte for byte as it was.
 */
export const recordCriteriaEvidenceUseCase =
  (deps: {
    readonly features: FeatureRepository;
    readonly statuses: ImplementationStatusRepository;
    readonly clock: Clock;
  }) =>
  async (input: RecordCriteriaEvidenceInput): Promise<RecordCriteriaEvidenceOutput> => {
    const feature = await deps.features.get(input.featureId);
    if (!feature) throw new FeatureNotFoundForReportError(input.featureId);

    const now = deps.clock();
    const known = new Set((feature.acceptanceCriteria ?? []).map((c) => String(c.id)));
    const previous: ImplementationStatus =
      (await deps.statuses.get(input.featureId)) ??
      emptyImplementationStatus(input.featureId, now);

    const accepted = input.evidence.filter((e) => known.has(e.criterionId));
    const rejected = [
      ...input.evidence.map((e) => e.criterionId),
      ...input.missing
    ].filter((id) => !known.has(id));

    const written = accepted.reduce((status, { criterionId, ...rest }) => {
      const record = { criterionId, key: `criterion:${criterionId}`, ...rest, syncedAt: now };
      return upsertCriterionEvidence(status, record, now);
    }, previous);
    const next = input.missing
      .filter((id) => known.has(id))
      .reduce((status, id) => removeCriterionEvidence(status, id, now), written);

    if (next !== previous) await deps.statuses.save(next);

    return {
      featureId: input.featureId,
      revision: next.revision,
      updatedAt: next.updatedAt,
      written: accepted.length,
      // Each removal that found a record bumped the revision once.
      removed: next.revision - written.revision,
      rejected
    };
  };
