import { existsSync } from 'node:fs';
import pc from 'picocolors';
import { discoverSnapshotDirectory } from '../../src/features/behavior-model/infrastructure/persistence/snapshot-discovery';
import { JsonFolderFeatureRepository } from '../../src/features/behavior-model/infrastructure/persistence/JsonFolderFeatureRepository';
import { JsonFolderProjectRepository } from '../../src/features/projects/infrastructure/persistence/JsonFolderProjectRepository';
import { withProjectLibrary } from '../../src/features/projects/infrastructure/persistence/ProjectScopedFeatureRepository';
import { asFeatureId, type FeatureId } from '../../src/features/behavior-model/domain/value-objects/ids';
import type { Invariant } from '../../src/features/behavior-model/domain/entities/Invariant';
import { asProjectId } from '../../src/features/projects/domain/value-objects/ids';
import { fileBehavioralIndexReader } from '../../src/features/verification/infrastructure/persistence/FileBehavioralIndexReader';
import {
  verifyFeaturesUseCase,
  type DriftOwnership
} from '../../src/features/verification/application/use-cases/VerifyFeatures';
import { findOwningProject } from '../../src/features/projects/application/services/bulkRead';
import { strictThresholds } from '../../src/features/verification/domain/VerificationThresholds';
import type { CheckStatus, FeatureVerdict } from '../../src/features/verification/domain/VerificationVerdict';
import {
  mergeVerificationReports,
  type VerificationReport
} from '../../src/features/verification/domain/VerificationReport';
import { activeProver } from '../../src/features/prover/loadProver';
import { loadFeaturesByIds } from '../../src/features/behavior-model/application/services/bulkRead';
import type { Feature } from '../../src/features/behavior-model/domain/entities/Feature';
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
  readonly minVerified?: number;
  readonly maxScenarioFailures?: number;
  readonly requireScenarios?: boolean;
  readonly failOnDrift?: boolean;
  readonly failOnDeadActions?: boolean;
  readonly failOnUnmetGoals?: boolean;
  readonly failOnSkippedActions?: boolean;
  readonly failOnTruncatedExploration?: boolean;
  readonly allowInvariantViolations?: boolean;
  /** Evidence-first preset: 100% maturity/verified, model check, no warnings hidden as pass. */
  readonly strict?: boolean;
  /** Ask the solver (default true). `false` turns it off for this run: nothing is then proven. */
  readonly solver?: boolean;
  /** Fail on a rule the solver proved dead, hidden or always refusing (default: warn only). */
  readonly failOnProvenFlaws?: boolean;
  /** Fail when the solver left something unproven (default: warn only). */
  readonly failOnOpenProofs?: boolean;
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
  if (s.proof) {
    parts.push(
      s.proof.notProven > 0
        ? pc.yellow(`${s.proof.proven} proven, ${s.proof.notProven} not proven`)
        : `${s.proof.proven} proven`
    );
    if (s.proof.explorationsSkipped > 0) parts.push(`${s.proof.explorationsSkipped} exploration(s) not needed`);
  }
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
type Cohort = {
  readonly featureIds: readonly FeatureId[];
  readonly projectInvariants: readonly Invariant[];
  /** Set only for a one-feature cohort: who else may own keys of the index. */
  readonly driftOwnership?: DriftOwnership;
  /** Set only for a one-feature cohort: its project, whose actions the solver's paths may play. */
  readonly projectFeatureIds?: readonly FeatureId[];
};

const resolveCohorts = async (
  options: CheckOptions,
  cwd: string,
  featureRepo: JsonFolderFeatureRepository,
  projectRepo: JsonFolderProjectRepository
): Promise<readonly Cohort[]> => {
  if (options.featureId) {
    // `.unspa.json` maps the whole project: without the siblings as possible
    // owners, every key of theirs would read as an orphan of this one feature.
    const owner = await findOwningProject(projectRepo, options.featureId);
    return [
      {
        featureIds: [asFeatureId(options.featureId)],
        // One feature still belongs to its project: the project's invariants
        // hold on it exactly as they do in the MCP verify of the same feature.
        projectInvariants: owner?.projectInvariants ?? [],
        driftOwnership: owner ? owner.featureIds : 'all',
        ...(owner ? { projectFeatureIds: owner.featureIds } : {})
      }
    ];
  }

  const explicitProjectId = options.project ?? readRepoLink(cwd)?.projectId;
  if (explicitProjectId) {
    const project = await projectRepo.get(asProjectId(explicitProjectId));
    return project && project.featureIds.length > 0
      ? [{ featureIds: [...project.featureIds], projectInvariants: project.projectInvariants ?? [] }]
      : [];
  }

  const cohorts: Cohort[] = [];
  const assigned = new Set<string>();
  for (const summary of await projectRepo.list()) {
    const project = await projectRepo.get(summary.id);
    if (project && project.featureIds.length > 0) {
      cohorts.push({
        featureIds: [...project.featureIds],
        projectInvariants: project.projectInvariants ?? []
      });
      for (const id of project.featureIds) assigned.add(String(id));
    }
  }
  const orphans = (await featureRepo.list())
    .map((s) => s.id)
    .filter((id) => !assigned.has(String(id)));
  if (orphans.length > 0) cohorts.push({ featureIds: orphans, projectInvariants: [] });
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

  const features = withProjectLibrary(featureRepo, projectRepo);
  // The proof module UNSPA_PROVER names, if any: every feature is proven before it is judged.
  const prover = activeProver();
  const verify = verifyFeaturesUseCase({
    // Read through the project library so a feature that REFERENCES canonical
    // entities/resources/personas verifies with them resolved — CI and the
    // in-chat `verify` tool must gate on exactly the same model.
    features,
    index: fileBehavioralIndexReader({ cwd }),
    ...(prover ? { prove: (feature, context) => prover.verdictProof(feature, { ...context, depth: 'full' }) } : {})
  });

  const thresholds = {
    ...(options.strict ? strictThresholds() : {}),
    minMaturity: options.minMaturity ?? (options.strict ? 100 : 0),
    minVerified: options.minVerified ?? (options.strict ? 100 : 0),
    maxScenarioFailures: options.maxScenarioFailures ?? 0,
    allowInvariantViolations: !options.strict && options.allowInvariantViolations === true,
    failOnDeadActions: options.strict || options.failOnDeadActions === true,
    allowDrift: !(options.strict || options.failOnDrift === true),
    requireScenarios: options.strict || options.requireScenarios === true,
    failOnUnmetGoals: options.strict || options.failOnUnmetGoals === true,
    failOnSkippedActions: options.strict || options.failOnSkippedActions === true,
    failOnTruncatedExploration: options.strict || options.failOnTruncatedExploration === true,
    failOnProvenFlaws: options.strict || options.failOnProvenFlaws === true,
    failOnOpenProofs: options.strict || options.failOnOpenProofs === true
  };
  const modelCheck = options.modelCheck || options.strict
    ? {
        ...(options.maxDepth !== undefined ? { maxDepth: options.maxDepth } : {}),
        ...(options.maxStates !== undefined ? { maxStates: options.maxStates } : {})
      }
    : false;

  const reports: VerificationReport[] = [];
  try {
    for (const cohort of cohorts) {
      const projectFeatures = cohort.projectFeatureIds
        ? (await loadFeaturesByIds(features, cohort.projectFeatureIds)).filter(
            (feature): feature is Feature => feature !== null
          )
        : undefined;
      reports.push(
        await verify({
          featureIds: cohort.featureIds,
          projectInvariants: cohort.projectInvariants,
          ...(cohort.driftOwnership ? { driftOwnership: cohort.driftOwnership } : {}),
          ...(projectFeatures ? { projectFeatures } : {}),
          thresholds,
          modelCheck,
          prove: options.solver !== false
        })
      );
    }
  } finally {
    // The proof module's processes would keep the command alive after its answer.
    prover?.shutdown();
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
