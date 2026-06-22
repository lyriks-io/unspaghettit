import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import pc from 'picocolors';
import { discoverSnapshotDirectory } from '../../src/features/behavior-model/infrastructure/persistence/snapshot-discovery';
import { JsonFolderFeatureRepository } from '../../src/features/behavior-model/infrastructure/persistence/JsonFolderFeatureRepository';
import type { FeatureId } from '../../src/features/behavior-model/domain/value-objects/ids';
import { generateAdapterStub, type IndexHint } from '../scenarios/adapter-scaffold';
import { log } from '../util/log';

export type ScenariosAdapterOptions = {
  readonly featureId: string;
  readonly cwd?: string;
  /** Output path. Defaults to ./unspa.adapter.ts so the export command's default import resolves. */
  readonly out?: string;
  readonly adapterExport?: string;
  readonly dryRun?: boolean;
  readonly force?: boolean;
};

const EXPERIMENTAL_BANNER = 'experimental — adapter contract may change between minor versions';

/** Best-effort read of the behavioral index from `.unspa.json` for impl hints. */
const readIndex = (cwd: string): Readonly<Record<string, IndexHint>> => {
  try {
    const raw = JSON.parse(readFileSync(join(cwd, '.unspa.json'), 'utf8')) as {
      index?: Record<string, IndexHint>;
    };
    return raw.index ?? {};
  } catch {
    return {};
  }
};

export const runScenariosAdapterCommand = async (
  options: ScenariosAdapterOptions
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
    log.dim('Use `unspa list` (then open a project) or the dashboard to find feature ids.');
    return 1;
  }

  const { code, actionCount } = generateAdapterStub(feature, {
    index: readIndex(cwd),
    ...(options.adapterExport ? { adapterExportName: options.adapterExport } : {})
  });

  if (actionCount === 0) {
    log.warn(
      `Feature "${feature.name}" has no scenarios on any action, so the adapter would be empty.`
    );
    log.dim('Author scenarios first, then re-run; the stub mirrors the actions the export tests cover.');
    return 0;
  }

  if (options.dryRun) {
    process.stdout.write(`${code}\n`);
    log.dim(`(dry-run; ${actionCount} action case${actionCount === 1 ? '' : 's'} would be written)`);
    return 0;
  }

  const outPath = options.out
    ? isAbsolute(options.out)
      ? options.out
      : resolve(cwd, options.out)
    : resolve(cwd, 'unspa.adapter.ts');

  if (existsSync(outPath) && options.force !== true) {
    log.err(`Refusing to overwrite existing file: ${outPath}`);
    log.dim('Re-run with --force to overwrite, or pass --out <path> to write elsewhere.');
    return 1;
  }

  const outDir = dirname(outPath);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, code, 'utf8');

  log.ok(`Wrote ${pc.cyan(outPath)}`);
  log.dim(`${actionCount} action case${actionCount === 1 ? '' : 's'} to fill in.`);
  log.dim(
    `Next: implement the cases, then \`unspa scenarios export ${feature.id}\` and run vitest.`
  );
  return 0;
};
