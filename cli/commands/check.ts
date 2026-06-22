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
import {
  mergeVerificationReports,
  type VerificationReport
} from '../../src/features/verification/domain/VerificationReport';
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
 * Resolve the cohorts to verify. Precedence: an explicit feature id (one
 * cohort of one), then an explicit/linked project (one cohort), then — when
 * unscoped — EACH project as its own cohort plus any orphan features, so a
 * multi-project hub doesn't treat features from different products as
 * siblings (which would skew cross-feature checks). Each cohort is verified
 * independently and the reports are merged. Empty cohorts are dropped.
 */
const resolveCohorts = async (
  options: CheckOptions,
  cwd: string,
  featureRepo: JsonFolderFeatureRepository,
  projectRepo: JsonFolderProjectRepository
): Promise<readonly (readonly FeatureId[])[]> => {
  if (options.featureId) return [[asFeatureId(options.featureId)]];

  const explicitProjectId = options.project ?? readRepoLink(cwd)?.projectId;
  if (explicitProjectId) {
    const project = await projectRepo.get(asProjectId(explicitProjectId));
    return project && project.featureIds.length > 0 ? [[...project.featureIds]] : [];
  }

  const cohorts: FeatureId[][] = [];
  const assigned = new Set<string>();
  for (const summary of await projectRepo.list()) {
    const project = await projectRepo.get(summary.id);
    if (project && project.featureIds.length > 0) {
      cohorts.push([...project.featureIds]);
      for (const id of project.featureIds) assigned.add(String(id));
    }
  }
  const orphans = (await featureRepo.list())
    .map((s) => s.id)
    .filter((id) => !assigned.has(String(id)));
  if (orphans.length > 0) cohorts.push(orphans);
  return cohorts;
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
  const cohorts = await resolveCohorts(options, cwd, featureRepo, projectRepo);

  const verify = verifyFeaturesUseCase({
    features: featureRepo,
    index: fileBehavioralIndexReader({ cwd })
  });

  const thresholds = {
    minMaturity: options.minMaturity ?? 0,
    maxScenarioFailures: options.maxScenarioFailures ?? 0,
    allowInvariantViolations: options.allowInvariantViolations === true,
    failOnDeadActions: options.failOnDeadActions === true,
    allowDrift: options.failOnDrift !== true,
    requireScenarios: options.requireScenarios === true,
    failOnUnmetGoals: options.failOnUnmetGoals === true
  };
  const modelCheck = options.modelCheck
    ? {
        ...(options.maxDepth !== undefined ? { maxDepth: options.maxDepth } : {}),
        ...(options.maxStates !== undefined ? { maxStates: options.maxStates } : {})
      }
    : false;

  const reports: VerificationReport[] = [];
  for (const cohort of cohorts) {
    reports.push(await verify({ featureIds: cohort, thresholds, modelCheck }));
  }
  const report = mergeVerificationReports(reports);

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
