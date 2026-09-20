import type { Feature } from '../../src/features/behavior-model/domain/entities/Feature';
import { criterionStandings } from '../../src/features/behavior-model/domain/services/CriterionStanding';
import type { CriterionEvidenceInput } from '../../src/features/implementation-status/application/use-cases/RecordCriteriaEvidence';
import {
  ALL_INDEX_VERIFICATION_KINDS,
  type IndexVerification,
  type IndexVerificationKind
} from '../repo-link';

/**
 * The `criteria` block of a sync_from_index answer: for every acceptance
 * criterion of the project, whether the index says what verifies it and how that
 * last went.
 *
 * Repositories kept this in a private block of their index file that the engine
 * never read, so "is this criterion actually checked?" had no answer anywhere.
 * It is now an ordinary index entry keyed `criterion:<id>`, and this module is
 * what reads it. Pure: features and the index in, a report out. The block is
 * recomputed from the index on every sync; what the sync KEEPS of it, so the
 * answer outlives the call, is read off the same entries by
 * {@link criteriaEvidenceFromIndex} and stored with the feature's status record.
 *
 * Counts, never scores: a criterion is prose and stays out of maturity and of
 * every verification verdict.
 */
export type CriterionIndexRow = {
  readonly key: string;
  readonly criterionId: string;
  readonly title: string;
  /** The computed one-line standing (see CriterionStanding). */
  readonly standing: string;
  /** Whether the index holds an entry for this criterion at all. */
  readonly indexed: boolean;
  readonly file?: string;
  readonly verification?: IndexVerification;
};

export type MalformedVerification = {
  readonly key: string;
  readonly problems: readonly string[];
};

export type CriteriaIndexReport = {
  /** Every acceptance criterion of the synced features. */
  readonly total: number;
  /** Criteria with a `criterion:<id>` entry in the index. */
  readonly indexed: number;
  /** Indexed, and the last recorded result passed. */
  readonly verified: number;
  /** Indexed, and the last recorded result failed. */
  readonly failing: number;
  /** Indexed, with no recorded result to read. */
  readonly unverified: number;
  readonly entries: readonly CriterionIndexRow[];
  /** Verification blocks that could not be read as written. Reported, never fatal. */
  readonly malformed: readonly MalformedVerification[];
};

const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const textList = (value: unknown): readonly string[] | undefined =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? (value as readonly string[])
    : undefined;

/**
 * Read a verification block leniently: keep every part that is well formed, name
 * every part that is not. A block without a usable `kind` is dropped whole (the
 * kind is what says how to read the rest); a bad `lastResult` costs only the
 * result, so the entry reads as unverified rather than as passed or failed.
 */
export const readVerification = (
  raw: unknown
): { readonly verification?: IndexVerification; readonly problems: readonly string[] } => {
  if (raw === undefined) return { problems: [] };
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      problems: [
        '"verification" must be an object { kind, command?, files?, artifacts?, lastResult? }. The block was ignored.'
      ]
    };
  }
  const block = raw as Record<string, unknown>;
  const problems: string[] = [];

  if (!(ALL_INDEX_VERIFICATION_KINDS as readonly unknown[]).includes(block.kind)) {
    return {
      problems: [
        `"verification.kind" must be one of ${ALL_INDEX_VERIFICATION_KINDS.join(', ')} (got ${JSON.stringify(block.kind)}). The block was ignored.`
      ]
    };
  }

  if (block.command !== undefined && !isText(block.command)) {
    problems.push('"verification.command" must be a non-empty string. It was ignored.');
  }
  const files = textList(block.files);
  if (block.files !== undefined && files === undefined) {
    problems.push('"verification.files" must be an array of strings. It was ignored.');
  }
  const artifacts = textList(block.artifacts);
  if (block.artifacts !== undefined && artifacts === undefined) {
    problems.push('"verification.artifacts" must be an array of strings. It was ignored.');
  }

  let lastResult: IndexVerification['lastResult'];
  if (block.lastResult !== undefined) {
    const result = (block.lastResult ?? {}) as Record<string, unknown>;
    if (typeof result.passed !== 'boolean' || !isText(result.at)) {
      problems.push(
        '"verification.lastResult" needs a boolean "passed" and an ISO "at". It was ignored, so the criterion reads as unverified.'
      );
    } else {
      lastResult = {
        passed: result.passed,
        at: result.at,
        ...(isText(result.summary) ? { summary: result.summary } : {}),
        ...(isText(result.revision) ? { revision: result.revision } : {})
      };
    }
  }

  return {
    verification: {
      kind: block.kind as IndexVerificationKind,
      ...(isText(block.command) ? { command: block.command } : {}),
      ...(files ? { files } : {}),
      ...(artifacts ? { artifacts } : {}),
      ...(lastResult ? { lastResult } : {})
    },
    problems
  };
};

const entryOf = (
  index: Readonly<Record<string, unknown>>,
  key: string
): Record<string, unknown> | undefined => {
  const raw = index[key];
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : undefined;
};

/**
 * What one sync should keep about the criteria of `feature`: a record per
 * criterion the index names with a live entry, and the ids it names as
 * `missing` (whose record goes). A criterion the index does not name appears in
 * neither list, so whatever was kept for it stays: an index is partial by
 * nature, and silence is not a retraction.
 *
 * Read with the same leniency as the answer block: a part that does not read is
 * left out of the record, never a reason to keep nothing. An entry without a
 * status is kept as implemented, the reading drift already gives it.
 */
export const criteriaEvidenceFromIndex = (
  feature: Feature,
  index: Readonly<Record<string, unknown>>
): { readonly evidence: readonly CriterionEvidenceInput[]; readonly missing: readonly string[] } => {
  const evidence: CriterionEvidenceInput[] = [];
  const missing: string[] = [];
  for (const criterion of feature.acceptanceCriteria ?? []) {
    const criterionId = String(criterion.id);
    const entry = entryOf(index, `criterion:${criterionId}`);
    if (!entry) continue;
    if (entry.status === 'missing') {
      missing.push(criterionId);
      continue;
    }
    const { verification } = readVerification(entry.verification);
    evidence.push({
      criterionId,
      status: entry.status === 'partial' ? 'partial' : 'implemented',
      ...(isText(entry.file) ? { file: entry.file } : {}),
      ...(typeof entry.line === 'number' && entry.line > 0 ? { line: entry.line } : {}),
      ...(isText(entry.signature) ? { signature: entry.signature } : {}),
      ...(verification ? { verification } : {}),
      ...(isText(entry.specVersion) ? { specVersion: entry.specVersion } : {})
    });
  }
  return { evidence, missing };
};

/** The criteria of `features` against `index`, in model order. */
export const buildCriteriaIndexReport = (
  features: readonly Feature[],
  index: Readonly<Record<string, unknown>>
): CriteriaIndexReport => {
  const entries: CriterionIndexRow[] = [];
  const malformed: MalformedVerification[] = [];

  for (const feature of features) {
    const standings = new Map(criterionStandings(feature).map((s) => [s.criterionId, s.standing]));
    for (const criterion of feature.acceptanceCriteria ?? []) {
      const criterionId = String(criterion.id);
      const key = `criterion:${criterionId}`;
      const entry = entryOf(index, key);
      const { verification, problems } = readVerification(entry?.verification);
      if (problems.length > 0) malformed.push({ key, problems });
      const file = entry?.file;
      entries.push({
        key,
        criterionId,
        title: criterion.title,
        standing: standings.get(criterionId) ?? 'active',
        indexed: entry !== undefined,
        ...(isText(file) ? { file } : {}),
        ...(verification ? { verification } : {})
      });
    }
  }

  const indexed = entries.filter((row) => row.indexed);
  const resultOf = (row: CriterionIndexRow) => row.verification?.lastResult;
  return {
    total: entries.length,
    indexed: indexed.length,
    verified: indexed.filter((row) => resultOf(row)?.passed === true).length,
    failing: indexed.filter((row) => resultOf(row)?.passed === false).length,
    unverified: indexed.filter((row) => resultOf(row) === undefined).length,
    entries,
    malformed
  };
};
