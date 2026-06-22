import { existsSync } from 'node:fs';
import pc from 'picocolors';
import { discoverSnapshotDirectory } from '../../src/features/behavior-model/infrastructure/persistence/snapshot-discovery';
import { JsonFolderFeatureRepository } from '../../src/features/behavior-model/infrastructure/persistence/JsonFolderFeatureRepository';
import { JsonFolderProjectRepository } from '../../src/features/projects/infrastructure/persistence/JsonFolderProjectRepository';
import { asFeatureId, type FeatureId } from '../../src/features/behavior-model/domain/value-objects/ids';
import { asProjectId } from '../../src/features/projects/domain/value-objects/ids';
import { fileBehavioralIndexReader } from '../../src/features/verification/infrastructure/persistence/FileBehavioralIndexReader';
import { verifyFeaturesUseCase } from '../../src/features/verification/application/use-cases/VerifyFeatures';
import type { CheckStatus, FeatureVerdict } from '../../src/features/verification/domain/VerificationVerdict';
import type { VerificationReport } from '../../src/features/verification/domain/VerificationReport';
import { readRepoLink } from '../util/link';
import { log } from '../util/log';

export type CheckOptions = {
  readonly cwd?: string;
  /** Verify only this feature (skips project/link scoping). */
  readonly featureId?: string;
  /** Verify this project's features. Defaults to the repo's linked project (.unspa.json). */
  readonly project?: string;
  readonly snapshots?: string;
  readonly json?: boolean;
  /** Run bounded model checking (state-space exploration). Off by default. */
  readonly modelCheck?: boolean;
  readonly maxDepth?: number;
  readonly maxStates?: number;
  readonly minMaturity?: number;
  readonly maxScenarioFailures?: number;
  readonly requireScenarios?: boolean;
  readonly failOnDrift?: boolean;
  readonly failOnDeadActions?: boolean;
  readonly failOnUnmetGoals?: boolean;
  readonly allowInvariantViolations?: boolean;
};

const STATUS_GLYPH: Record<CheckStatus, string> = {
  pass: pc.green('✓'),
  warn: pc.yellow('⚠'),
  fail: pc.red('✗')
};

const printVerdict = (verdict: FeatureVerdict): void => {
  const head = verdict.passed ? pc.green('✓') : pc.red('✗');
  process.stdout.write(`${head} ${pc.bold(verdict.featureName)}\n`);
  for (const check of verdict.checks) {
    process.stdout.write(`    ${STATUS_GLYPH[check.status]} ${check.label.padEnd(14)} ${pc.dim(check.detail)}\n`);
    for (const item of check.items ?? []) {
      process.stdout.write(`        ${pc.dim('-')} ${item}\n`);
    }
  }
  process.stdout.write('\n');
};

const printSummary = (report: VerificationReport): void => {
  const s = report.summary;
  const parts = [
    `${s.featuresChecked} feature${s.featuresChecked === 1 ? '' : 's'}`,
    `${s.featuresPassed} passed`,
    s.featuresFailed > 0 ? pc.red(`${s.featuresFailed} failed`) : `${s.featuresFailed} failed`,
    `${s.scenariosRun} scenario${s.scenariosRun === 1 ? '' : 's'}${s.scenariosFailed > 0 ? ` (${s.scenariosFailed} failing)` : ''}`
  ];
  if (report.drift.stale.length > 0) parts.push(pc.yellow(`${report.drift.stale.length} drifted`));
  log.dim(parts.join(pc.dim(' · ')));
  process.stdout.write(report.passed ? `${pc.green(pc.bold('PASS'))}\n` : `${pc.red(pc.bold('FAIL'))}\n`);
};

/**
 * Resolve which features make up this run's cohort. Precedence: an explicit
 * feature id, then an explicit/linked project's features, then "every feature
 * in the snapshot folder". Returns `undefined` to mean "all" (the use case
 * lists them), which keeps the all-features path a single source of truth.
 */
const resolveCohort = async (
  options: CheckOptions,
  cwd: string,
  projectRepo: JsonFolderProjectRepository
): Promise<readonly FeatureId[] | undefined> => {
  if (options.featureId) return [asFeatureId(options.featureId)];
  const projectId = options.project ?? readRepoLink(cwd)?.projectId;
  if (!projectId) return undefined;
  const project = await projectRepo.get(asProjectId(projectId));
  return project ? [...project.featureIds] : undefined;
};

export const runCheckCommand = async (options: CheckOptions = {}): Promise<number> => {
  const cwd = options.cwd ?? process.cwd();
  const { directory, source } = discoverSnapshotDirectory({ cwd, override: options.snapshots });

  if (!existsSync(directory)) {
    if (options.json) {
      process.stdout.write(`${JSON.stringify({ error: 'no-snapshots', directory }, null, 2)}\n`);
    } else {
      log.err(`No unspa/ folder found at or above ${cwd}.`);
      log.dim('Run `unspa init` first, then model a feature.');
    }
    return 2;
  }

  const featureRepo = new JsonFolderFeatureRepository(directory);
  const projectRepo = new JsonFolderProjectRepository(directory);
  const cohort = await resolveCohort(options, cwd, projectRepo);

  const verify = verifyFeaturesUseCase({
    features: featureRepo,
    index: fileBehavioralIndexReader({ cwd })
  });

  const report = await verify({
    ...(cohort ? { featureIds: cohort } : {}),
    thresholds: {
      minMaturity: options.minMaturity ?? 0,
      maxScenarioFailures: options.maxScenarioFailures ?? 0,
      allowInvariantViolations: options.allowInvariantViolations === true,
      failOnDeadActions: options.failOnDeadActions === true,
      allowDrift: options.failOnDrift !== true,
      requireScenarios: options.requireScenarios === true,
      failOnUnmetGoals: options.failOnUnmetGoals === true
    },
    modelCheck: options.modelCheck
      ? {
          ...(options.maxDepth !== undefined ? { maxDepth: options.maxDepth } : {}),
          ...(options.maxStates !== undefined ? { maxStates: options.maxStates } : {})
        }
      : false
  });

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.passed ? 0 : 1;
  }

  log.step(`Verifying ${report.summary.featuresChecked} feature${report.summary.featuresChecked === 1 ? '' : 's'} in ${pc.cyan(directory)} (${source})`);
  process.stdout.write('\n');
  if (report.features.length === 0) {
    log.warn('No features matched. Nothing to verify.');
    return 0;
  }
  for (const verdict of report.features) printVerdict(verdict);
  printSummary(report);

  return report.passed ? 0 : 1;
};
