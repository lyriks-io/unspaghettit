import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import pc from 'picocolors';
import { discoverSnapshotDirectory } from '../../src/features/behavior-model/infrastructure/persistence/snapshot-discovery';
import { JsonFolderFeatureRepository } from '../../src/features/behavior-model/infrastructure/persistence/JsonFolderFeatureRepository';
import { toSlug } from '../../src/features/behavior-model/domain/value-objects/slug';
import type { FeatureId } from '../../src/features/behavior-model/domain/value-objects/ids';
import { generateScenarioSpec } from '../scenarios/codegen';
import { log } from '../util/log';

export type ScenariosExportOptions = {
  readonly featureId: string;
  readonly cwd?: string;
  /**
   * Path to write the generated Vitest spec. May be absolute or relative to
   * cwd. When omitted, defaults to `./<feature-slug>.scenarios.spec.ts` in
   * cwd, which keeps the file next to whatever the user is running the
   * command from (typically their tests directory).
   */
  readonly out?: string;
  /**
   * Module specifier the generated test uses to import the adapter. Defaults
   * to `./unspa.adapter`, which makes the adapter and the spec siblings — the
   * shortest path to "drop in a thin adapter and run vitest".
   */
  readonly adapter?: string;
  /** Named export inside the adapter module. Defaults to `adapter`. */
  readonly adapterExport?: string;
  /** Print to stdout instead of writing to disk. Useful for piping/inspection. */
  readonly dryRun?: boolean;
  /**
   * Overwrite the output file when it already exists. Without this flag the
   * command refuses to clobber, so a user who hand-edited the spec (or has
   * an adapter file at the default path) doesn't silently lose work. Dry-run
   * mode skips the check entirely.
   */
  readonly force?: boolean;
};

const EXPERIMENTAL_BANNER =
  'experimental — adapter contract may change between minor versions';

const formatDriftLine = (s: {
  scenarioName: string;
  authoredStatus: 'success' | 'blocked';
  simulatorStatus: 'success' | 'blocked';
}): string =>
  `${pc.yellow('drift')} ${pc.cyan(s.scenarioName)}: simulator says ${pc.bold(
    s.simulatorStatus
  )} but scenario says ${pc.bold(s.authoredStatus)}`;

export const runScenariosExportCommand = async (
  options: ScenariosExportOptions
): Promise<number> => {
  const cwd = options.cwd ?? process.cwd();
  log.dim(`(${EXPERIMENTAL_BANNER})`);
  const { directory } = discoverSnapshotDirectory({ cwd });

  if (!existsSync(directory)) {
    log.err(`No unspa/ folder found at or above ${cwd}.`);
    log.dim('Run `unspa init` first, then add a feature with scenarios.');
    return 1;
  }

  const repo = new JsonFolderFeatureRepository(directory);
  const feature = await repo.get(options.featureId as FeatureId);
  if (!feature) {
    log.err(`No feature with id "${options.featureId}" in ${directory}.`);
    log.dim('Use `unspa list` (then open a project) or your dashboard to find feature ids.');
    return 1;
  }

  const { code, scenarios } = generateScenarioSpec(feature, {
    adapterImportPath: options.adapter ?? './unspa.adapter',
    adapterExportName: options.adapterExport ?? 'adapter'
  });

  if (scenarios.length === 0) {
    log.warn(
      `Feature "${feature.name}" has no scenarios authored on any action. Nothing to export.`
    );
    log.dim('Add scenarios via your AI client (MCP) or the dashboard, then re-run.');
    return 0;
  }

  // Drift is informational at codegen time. The user authored expectedStatus
  // intentionally — we report the disagreement so they can investigate, but
  // we still emit the test as authored. Lets the human pick which oracle is
  // right (simulator interpretation vs. the value the scenario claims).
  const driftScenarios = scenarios.filter((s) => s.drift);
  if (driftScenarios.length > 0) {
    log.warn(
      `${driftScenarios.length}/${scenarios.length} scenario${
        driftScenarios.length === 1 ? '' : 's'
      } disagree with the simulator's prediction. Tests still emitted; review:`
    );
    for (const s of driftScenarios) {
      process.stdout.write(`  ${formatDriftLine(s)}\n`);
    }
  }

  if (options.dryRun) {
    process.stdout.write(`${code}\n`);
    log.dim(`(dry-run; ${scenarios.length} scenario${scenarios.length === 1 ? '' : 's'} would be exported)`);
    return 0;
  }

  const outPath = options.out
    ? isAbsolute(options.out)
      ? options.out
      : resolve(cwd, options.out)
    : resolve(cwd, `${toSlug(feature.name) || feature.id}.scenarios.spec.ts`);

  // Refuse to clobber an existing file unless --force. The default spec name
  // collides with a hand-edited file or a stale generated file, and silent
  // overwrite would discard work without any signal. Re-running with --force
  // is one extra keystroke; losing edits is not recoverable.
  if (existsSync(outPath) && options.force !== true) {
    log.err(`Refusing to overwrite existing file: ${outPath}`);
    log.dim('Re-run with --force to overwrite, or pass --out <path> to write elsewhere.');
    return 1;
  }

  const outDir = dirname(outPath);
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }
  writeFileSync(outPath, code, 'utf8');

  const emittedCount = scenarios.reduce((acc, s) => acc + s.assertionsEmitted, 0);
  const skippedCount = scenarios.reduce((acc, s) => acc + s.assertionsSkipped, 0);

  log.ok(`Wrote ${pc.cyan(outPath)}`);
  log.dim(
    `${scenarios.length} scenario${scenarios.length === 1 ? '' : 's'} | ${emittedCount} assertion${
      emittedCount === 1 ? '' : 's'
    } emitted${skippedCount > 0 ? ` | ${skippedCount} skipped (Expression-valued or non-success)` : ''}`
  );
  log.dim(
    `Next: implement the adapter at ${pc.cyan(join(outDir, options.adapter ?? './unspa.adapter'))} (UnspaAdapter from unspaghettit/cli/scenarios), then run vitest.`
  );

  return 0;
};
