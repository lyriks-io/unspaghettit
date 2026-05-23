import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { Feature } from '../../src/features/behavior-model/domain/entities/Feature';
import { generateTypesTool } from '../../src/features/mcp-tools/application/tools/generateTypes';
import { writeRepoLink, type RepoLink } from '../repo-link';
import type { RepoContext } from '../server';

export type CodegenResult = {
  readonly outputPath: string;
  readonly stats: ReturnType<typeof generateTypesTool>['stats'];
};

/**
 * Resolve `outputPath` against the repo root and assert it stays inside it.
 *
 * The `outputPath` is LLM-controlled (it arrives via the `generate_types`
 * MCP tool input), so an absolute path or a `..`-escape would let a
 * prompt-injected model overwrite arbitrary files the MCP process can
 * touch. We reject both up front; the surrounding try/catch in
 * `tools/read.ts` turns the throw into an MCP error envelope.
 */
const resolveOutputPath = (
  repoRoot: string,
  outputPath: string
): string => {
  if (typeof outputPath !== 'string' || outputPath.length === 0) {
    throw new Error('outputPath must be a non-empty relative path');
  }
  if (isAbsolute(outputPath)) {
    throw new Error(
      `outputPath must be relative to the repo root, refusing absolute "${outputPath}"`
    );
  }
  const root = resolve(repoRoot);
  const target = resolve(root, outputPath);
  const rel = relative(root, target);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).includes('..')) {
    throw new Error(
      `outputPath must stay under the repo root, refusing escape "${outputPath}"`
    );
  }
  return target;
};

/**
 * Generate the TS types module to `outputPath` and persist the chosen
 * path back to `.unspa.json` so later spec mutations can auto-regen.
 *
 * Returns the absolute path and codegen stats. Throws if the write fails;
 * callers convert to MCP error envelopes.
 */
export const runGenerateTypes = (
  feature: Feature,
  repoContext: RepoContext | undefined,
  outputPath: string
): CodegenResult => {
  const repoRoot = repoContext?.linkPath ? dirname(repoContext.linkPath) : process.cwd();
  const targetPath = resolveOutputPath(repoRoot, outputPath);
  const result = generateTypesTool({
    feature,
    header: `Generated from feature "${feature.name}" (${feature.id}) at ${new Date().toISOString()}.`
  });
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, result.source, 'utf8');

  // Persist the relative path so apply_batch can auto-regen on the next spec
  // write. `targetPath` is guaranteed to live under `repoRoot` by
  // `resolveOutputPath`, so the slice + forward-slash normalize is safe and
  // the stored value never carries a host-specific absolute prefix.
  if (repoContext?.linkPath) {
    const stored = relative(resolve(repoRoot), targetPath).replace(/\\/g, '/');
    try {
      const raw = readFileSync(repoContext.linkPath, 'utf8');
      const link = JSON.parse(raw) as RepoLink;
      if (link.generatedTypesPath !== stored) {
        writeRepoLink(repoContext.linkPath, { ...link, generatedTypesPath: stored });
      }
    } catch {
      // Non-fatal: persistence is a convenience, not a hard requirement.
    }
  }

  return { outputPath: targetPath, stats: result.stats };
};

/**
 * Read `.unspa.json` and, if `generatedTypesPath` is set, regenerate the
 * TS types module to that path. Returns the codegen result so write tools
 * can surface it in their response (or `null` when no autoregen runs).
 *
 * Designed for apply_batch and any other multi-op mutator that wants to
 * keep the codegen output in step with the spec without making the LLM
 * remember to call `generate_types` after every batch.
 */
export const maybeAutoGenerateTypes = (
  feature: Feature,
  repoContext: RepoContext | undefined
): CodegenResult | null => {
  if (!repoContext?.linkPath) return null;
  let link: RepoLink;
  try {
    link = JSON.parse(readFileSync(repoContext.linkPath, 'utf8')) as RepoLink;
  } catch {
    return null;
  }
  if (!link.generatedTypesPath) return null;
  try {
    return runGenerateTypes(feature, repoContext, link.generatedTypesPath);
  } catch {
    // Codegen failure must not abort the surrounding write. The caller's
    // response still confirms the spec change; the LLM can rerun
    // generate_types manually to surface the error.
    return null;
  }
};
