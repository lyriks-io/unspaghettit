import { existsSync, readFileSync } from 'node:fs';
import pc from 'picocolors';
import { parseScenarioResults, summarizeByAction } from '../scenarios/results';
import { linkPath } from '../util/link';
import { readJson, writeJson } from '../util/json';
import { log } from '../util/log';

export type CoverageIngestOptions = {
  readonly file: string;
  readonly cwd?: string;
  /** ISO timestamp to stamp (injected for tests; defaults to now). */
  readonly now?: string;
  readonly dryRun?: boolean;
};

type IndexEntry = Record<string, unknown>;
type Link = { index?: Record<string, IndexEntry> } & Record<string, unknown>;

/**
 * Promote indexed actions from "claimed implemented" to "proven against the
 * spec" by reading a Vitest JSON report of the generated scenario spec
 * (`vitest run --reporter=json --outputFile=<file>`). An action whose every
 * scenario passed gets `verifiedAt` stamped on its `.unspa.json` entry; one
 * that now fails has a stale `verifiedAt` cleared. Recording only — the gate
 * is `unspa check --min-verified`.
 */
export const runCoverageIngestCommand = async (
  options: CoverageIngestOptions
): Promise<number> => {
  const cwd = options.cwd ?? process.cwd();

  if (!existsSync(options.file)) {
    log.err(`Results file not found: ${options.file}`);
    log.dim('Run: vitest run <spec> --reporter=json --outputFile=<file>, then ingest that file.');
    return 1;
  }

  let report: unknown;
  try {
    report = JSON.parse(readFileSync(options.file, 'utf8'));
  } catch (e) {
    log.err(`Could not parse ${options.file} as JSON: ${(e as Error).message}`);
    return 1;
  }

  const perAction = summarizeByAction(parseScenarioResults(report));
  if (perAction.length === 0) {
    log.warn('No unspa-tagged scenario tests found in the report.');
    log.dim('Generate the spec with `unspa scenarios export <featureId>`, then run vitest with --reporter=json.');
    return 0;
  }

  const path = linkPath(cwd);
  const link = readJson<Link>(path);
  if (!link) {
    log.err(`No .unspa.json found at ${cwd}.`);
    log.dim('Link the repo (`unspa link`) and record implementations before ingesting verification.');
    return 1;
  }
  const index = link.index ?? {};
  const stampedAt = options.now ?? new Date().toISOString();

  let stamped = 0;
  let cleared = 0;
  const unindexed: string[] = [];

  for (const action of perAction) {
    const key = `action:${action.actionId}`;
    const entry = index[key];
    if (action.verified) {
      if (!entry) {
        unindexed.push(action.actionId);
        continue;
      }
      index[key] = { ...entry, verifiedAt: stampedAt, verifiedScenarios: action.passed };
      stamped += 1;
    } else if (entry && entry.verifiedAt !== undefined) {
      // Was verified, now a scenario fails — the proof is stale, drop it.
      const next = { ...entry };
      delete next.verifiedAt;
      delete next.verifiedScenarios;
      index[key] = next;
      cleared += 1;
    }
  }

  const verifiedCount = perAction.filter((a) => a.verified).length;
  log.step(`Verified coverage from ${pc.cyan(options.file)}`);
  log.dim(
    `${perAction.length} action(s) tested · ${verifiedCount} fully passing · ${perAction.length - verifiedCount} with failures`
  );
  if (unindexed.length > 0) {
    log.warn(
      `${unindexed.length} passing action(s) aren't in .unspa.json yet — record them (implementation status), then re-ingest to mark them verified.`
    );
  }

  if (options.dryRun) {
    log.dim('(dry-run; .unspa.json not written)');
    return 0;
  }
  if (stamped === 0 && cleared === 0) {
    log.dim('No indexed actions to update.');
    return 0;
  }

  await writeJson(path, { ...link, index });
  log.ok(
    `Stamped ${stamped} action(s) verified${cleared > 0 ? `, cleared ${cleared} stale` : ''} in .unspa.json`
  );
  return 0;
};
