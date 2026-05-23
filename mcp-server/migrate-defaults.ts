#!/usr/bin/env node
/**
 * One-shot migration: walks every `unspa/*.feature.json` snapshot,
 * coerces every `defaultValue` (state definitions + action parameters)
 * into a value that matches its declared `type`, and writes the result back
 * atomically. Idempotent. Already-clean files are skipped.
 *
 * Why this exists: early snapshots stored defaults as JSON-encoded strings
 * (`"365"` for `type: number`, `"\"helper\""` for `type: enum`, etc.). The
 * runtime validator now rejects that shape, so this script brings legacy
 * snapshots up to spec before the stricter validator catches them.
 *
 * Run with: `npm run migrate:defaults` (uses tsx).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import writeFileAtomic from 'write-file-atomic';
import type { Action } from '../src/features/behavior-model/domain/entities/Action';
import type { Feature } from '../src/features/behavior-model/domain/entities/Feature';
import type { Parameter } from '../src/features/behavior-model/domain/entities/Parameter';
import type { StateDefinition } from '../src/features/behavior-model/domain/entities/StateDefinition';
import type { Surface } from '../src/features/behavior-model/domain/entities/Surface';
import { coerceDefaultValue } from '../src/features/behavior-model/domain/services/StateValueCoercion';
import { discoverSnapshotDirectory } from '../src/features/behavior-model/infrastructure/persistence/snapshot-discovery';

const SNAPSHOT_SUFFIX = '.feature.json';

type FileReport = {
  readonly file: string;
  readonly stateDefsFixed: number;
  readonly parametersFixed: number;
};

const migrateStateDefinition = (
  def: StateDefinition
): { readonly next: StateDefinition; readonly changed: boolean } => {
  const result = coerceDefaultValue(def.defaultValue, def.type, def.enumValues);
  return {
    next: result.changed ? { ...def, defaultValue: result.value } : def,
    changed: result.changed
  };
};

const migrateParameter = (
  p: Parameter
): { readonly next: Parameter; readonly changed: boolean } => {
  if (p.defaultValue === undefined) return { next: p, changed: false };
  const result = coerceDefaultValue(p.defaultValue, p.type, p.enumValues);
  return {
    next: result.changed ? { ...p, defaultValue: result.value } : p,
    changed: result.changed
  };
};

const migrateCapability = (
  cap: Action
): { readonly next: Action; readonly fixed: number } => {
  let fixed = 0;
  const parameters = cap.parameters.map((p) => {
    const r = migrateParameter(p);
    if (r.changed) fixed += 1;
    return r.next;
  });
  return {
    next: fixed > 0 ? { ...cap, parameters } : cap,
    fixed
  };
};

const migrateSurface = (
  surface: Surface
): { readonly next: Surface; readonly stateDefsFixed: number; readonly parametersFixed: number } => {
  let stateDefsFixed = 0;
  const stateDefinitions = surface.stateDefinitions.map((d) => {
    const r = migrateStateDefinition(d);
    if (r.changed) stateDefsFixed += 1;
    return r.next;
  });
  let parametersFixed = 0;
  const actions = surface.actions.map((c) => {
    const r = migrateCapability(c);
    parametersFixed += r.fixed;
    return r.next;
  });
  const changed = stateDefsFixed > 0 || parametersFixed > 0;
  return {
    next: changed ? { ...surface, stateDefinitions, actions } : surface,
    stateDefsFixed,
    parametersFixed
  };
};

const migrateFeature = (
  exp: Feature
): { readonly next: Feature; readonly stateDefsFixed: number; readonly parametersFixed: number } => {
  let stateDefsFixed = 0;
  let parametersFixed = 0;
  const surfaces = exp.surfaces.map((s) => {
    const r = migrateSurface(s);
    stateDefsFixed += r.stateDefsFixed;
    parametersFixed += r.parametersFixed;
    return r.next;
  });
  const changed = stateDefsFixed > 0 || parametersFixed > 0;
  return {
    next: changed ? { ...exp, surfaces } : exp,
    stateDefsFixed,
    parametersFixed
  };
};

const migrateFile = async (path: string): Promise<FileReport> => {
  const raw = readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw) as { readonly feature: Feature };
  if (!parsed.feature) {
    return { file: path, stateDefsFixed: 0, parametersFixed: 0 };
  }
  const result = migrateFeature(parsed.feature);
  if (result.stateDefsFixed === 0 && result.parametersFixed === 0) {
    return { file: path, stateDefsFixed: 0, parametersFixed: 0 };
  }
  const nextEnvelope = { ...parsed, feature: result.next };
  await writeFileAtomic(path, JSON.stringify(nextEnvelope, null, 2), 'utf8');
  return {
    file: path,
    stateDefsFixed: result.stateDefsFixed,
    parametersFixed: result.parametersFixed
  };
};

const main = async (): Promise<void> => {
  const { directory } = discoverSnapshotDirectory({});
  if (!existsSync(directory)) {
    process.stderr.write(`[migrate-defaults] no snapshot directory at ${directory}\n`);
    process.exit(1);
  }
  const files = readdirSync(directory).filter((f) => f.endsWith(SNAPSHOT_SUFFIX));
  process.stderr.write(
    `[migrate-defaults] scanning ${files.length} file(s) in ${directory}\n`
  );

  let totalStateDefs = 0;
  let totalParams = 0;
  let touched = 0;
  for (const file of files) {
    const report = await migrateFile(join(directory, file));
    if (report.stateDefsFixed > 0 || report.parametersFixed > 0) {
      touched += 1;
      totalStateDefs += report.stateDefsFixed;
      totalParams += report.parametersFixed;
      process.stderr.write(
        `  fixed ${file}: ${report.stateDefsFixed} state default(s), ${report.parametersFixed} parameter default(s)\n`
      );
    }
  }
  process.stderr.write(
    `[migrate-defaults] done. ${touched}/${files.length} file(s) touched, ${totalStateDefs} state default(s) + ${totalParams} parameter default(s) coerced.\n`
  );
};

main().catch((err) => {
  process.stderr.write(`[migrate-defaults] fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
