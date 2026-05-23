import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import {
  asActionId,
  asFeatureId,
  asSurfaceId
} from '../../src/features/behavior-model/domain/value-objects/ids';
import type { Feature } from '../../src/features/behavior-model/domain/entities/Feature';
import { asProjectId } from '../../src/features/projects/domain/value-objects/ids';
import {
  ActionNotFoundForReportError,
  FeatureNotFoundForReportError,
  SurfaceNotFoundForReportError,
  type ReportEntityInput
} from '../../src/features/implementation-status/application/use-cases/ReportImplementationStatus';
import type {
  AuditMeta,
  EntityType,
  TagLocation
} from '../../src/features/implementation-status/domain/ImplementationStatus';
import { writeRepoLink, type BehavioralIndex, type IndexEntry, type RepoLink } from '../repo-link';
import type { RepoContext } from '../server';
import { errorText, text, type ToolDeps } from './_shared';
import { trackTokens } from '../metrics';
import { expandFeatureId, expandIdInFeature } from './short-ids';

/** Read audit metadata for a given index key from .unspa.json, if available. */
const readAuditMeta = (repoContext: RepoContext | undefined, indexKey: string): AuditMeta | undefined => {
  if (!repoContext?.linkPath) return undefined;
  try {
    const raw = JSON.parse(readFileSync(repoContext.linkPath, 'utf8')) as { index?: Record<string, unknown> };
    const entry = raw.index?.[indexKey];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return undefined;
    const e = entry as Record<string, unknown>;
    const meta: Record<string, unknown> = {};
    if (typeof e.auditedAt === 'string') meta.auditedAt = e.auditedAt;
    if (typeof e.gitCommit === 'string') meta.gitCommit = e.gitCommit;
    if (typeof e.specVersion === 'string') meta.specVersion = e.specVersion;
    if (typeof e.kind === 'string') meta.kind = e.kind;
    if (typeof e.testFile === 'string') meta.testFile = e.testFile;
    if (Array.isArray(e.relatedFiles)) {
      meta.relatedFiles = (e.relatedFiles as unknown[]).filter(
        (f): f is { file: string; line: number; role: string } =>
          typeof f === 'object' && f !== null && typeof (f as Record<string, unknown>).file === 'string'
      );
    }
    if (Array.isArray(e.knownGaps)) {
      meta.knownGaps = (e.knownGaps as unknown[]).filter((g): g is string => typeof g === 'string');
    }
    return Object.keys(meta).length > 0 ? (meta as AuditMeta) : undefined;
  } catch {
    return undefined;
  }
};

/** Extract AuditMeta directly from a typed IndexEntry (no file I/O needed). */
const extractAuditMeta = (entry: IndexEntry): AuditMeta | undefined => {
  const meta: Record<string, unknown> = {};
  if (entry.auditedAt !== undefined) meta.auditedAt = entry.auditedAt;
  if (entry.gitCommit !== undefined) meta.gitCommit = entry.gitCommit;
  if (entry.specVersion !== undefined) meta.specVersion = entry.specVersion;
  if (entry.kind !== undefined) meta.kind = entry.kind;
  if (entry.testFile !== undefined) meta.testFile = entry.testFile;
  if (entry.relatedFiles !== undefined) meta.relatedFiles = entry.relatedFiles;
  if (entry.knownGaps !== undefined) meta.knownGaps = entry.knownGaps;
  return Object.keys(meta).length > 0 ? (meta as AuditMeta) : undefined;
};

/** Per-sync file cache so we read each implementation file once. */
type FileCache = Map<string, readonly string[] | null>;

/**
 * Resolve a `.unspa.json` `file` entry against the repo root and refuse
 * anything that escapes (absolute paths, `..`-walks). `.unspa.json` is
 * LLM-writable, so without containment a prompt-injected model could point
 * the line-healing pass at arbitrary files and surface their contents back
 * to the dashboard as `snippet`. Returns `null` to make the caller short-
 * circuit cleanly.
 */
const resolveIndexFile = (repoRoot: string, file: string): string | null => {
  if (typeof file !== 'string' || file.length === 0) return null;
  if (isAbsolute(file)) return null;
  const root = resolve(repoRoot);
  const abs = resolve(root, file);
  const rel = relative(root, abs);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).includes('..')) {
    return null;
  }
  return abs;
};

const readLinesCached = (
  cache: FileCache,
  repoRoot: string,
  file: string
): readonly string[] | null => {
  const abs = resolveIndexFile(repoRoot, file);
  if (!abs) return null;
  const cached = cache.get(abs);
  if (cached !== undefined) return cached;
  try {
    const lines = readFileSync(abs, 'utf8').split(/\r?\n/);
    cache.set(abs, lines);
    return lines;
  } catch {
    cache.set(abs, null);
    return null;
  }
};

const normalizeForMatch = (s: string): string => s.replace(/\s+/g, ' ').trim();

/**
 * Locate the line that still carries the audited signature, using progressively
 * looser matches so refactors (line shifts, multi-line reformatting, dropped
 * `let` prefix from class-field migrations) still resolve. Returns 1-based line
 * or `null` if no plausible match exists. First match wins. Heuristic but
 * correct for the common case of one declaration per file region.
 */
const findSignatureLine = (lines: readonly string[], signature: string): number | null => {
  const target = normalizeForMatch(signature);
  if (target.length < 6) return null;

  const tryScan = (needle: string): number | null => {
    if (needle.length < 6) return null;
    for (let i = 0; i < lines.length; i += 1) {
      if (normalizeForMatch(lines[i]!).includes(needle)) return i + 1;
    }
    return null;
  };

  // Tier 1: full normalized signature on a single line.
  const exact = tryScan(target);
  if (exact !== null) return exact;

  // Tier 2: leading 30 chars (catches param-list reformatting / trailing diffs).
  if (target.length >= 18) {
    const head = tryScan(target.slice(0, Math.min(30, target.length)));
    if (head !== null) return head;
  }

  // Tier 3: first identifier (≥ 4 chars) + its trailing operator char.
  // Handles `let foo = ...` → `foo = ...` and multi-line `foo(\n  ...` splits.
  const idMatch = /[a-zA-Z_$][a-zA-Z0-9_$]{3,}\s*[(<=]/.exec(target);
  if (idMatch) return tryScan(idMatch[0]);

  return null;
};

const sliceAround = (
  lines: readonly string[],
  line: number,
  before = 1,
  after = 1
): string | undefined => {
  if (line <= 0) return undefined;
  const start = Math.max(0, line - 1 - before);
  const end = Math.min(lines.length, line + after);
  if (start >= end) return undefined;
  return lines.slice(start, end).join('\n');
};

/** ±2 line tolerance. A small edit above the entity doesn't count as stale. */
const FRESH_WINDOW = 2;

const entryToLocation = (
  entry: IndexEntry,
  repoRoot?: string,
  cache?: FileCache
): TagLocation => {
  const indexedLine = entry.line > 0 ? entry.line : undefined;
  const noFileFallback = (): TagLocation => ({
    file: entry.file,
    ...(indexedLine !== undefined ? { line: indexedLine } : {}),
    ...(entry.signature ? { snippet: entry.signature } : {})
  });
  if (!repoRoot || !cache) return noFileFallback();

  const lines = readLinesCached(cache, repoRoot, entry.file);
  if (!lines) return noFileFallback();

  // No signature → can't detect staleness; just show slice at indexed line.
  if (!entry.signature) {
    const snippet = indexedLine !== undefined ? sliceAround(lines, indexedLine) : undefined;
    return {
      file: entry.file,
      ...(indexedLine !== undefined ? { line: indexedLine } : {}),
      ...(snippet ? { snippet } : {})
    };
  }

  const foundLine = findSignatureLine(lines, entry.signature);
  const fresh =
    indexedLine !== undefined &&
    foundLine !== null &&
    Math.abs(foundLine - indexedLine) <= FRESH_WINDOW;

  if (fresh) {
    const snippet = sliceAround(lines, indexedLine!);
    return {
      file: entry.file,
      line: indexedLine!,
      ...(snippet ? { snippet } : {})
    };
  }

  // Stale + auto-heal hit: show real code at the new line.
  if (foundLine !== null) {
    const snippet = sliceAround(lines, foundLine);
    return {
      file: entry.file,
      ...(indexedLine !== undefined ? { line: indexedLine } : {}),
      stale: true,
      suggestedLine: foundLine,
      ...(snippet ? { snippet } : {})
    };
  }

  // Stale + can't heal: show indexed slice (likely junk) and flag it.
  const snippet =
    (indexedLine !== undefined ? sliceAround(lines, indexedLine) : undefined) ?? entry.signature;
  return {
    file: entry.file,
    ...(indexedLine !== undefined ? { line: indexedLine } : {}),
    stale: true,
    ...(snippet ? { snippet } : {})
  };
};

/**
 * Resolve where a child entity (event, rule, invariant, transition, state,
 * surface_rule, surface_invariant) lives in code. The child must have its
 * own `.unspa.json` entry. We never fall back to the parent's line, since
 * a child sharing the parent's signature is misleading (the snippet would
 * describe the parent, not the child). When no dedicated entry exists the
 * child is reported as missing so the LLM is forced to locate it on the
 * next audit pass.
 */
const resolveChildLocation = (
  key: string,
  index: BehavioralIndex,
  repoRoot?: string,
  cache?: FileCache
): TagLocation | null => {
  const child = index[key];
  if (!child || child.status === 'missing') return null;
  return entryToLocation(child, repoRoot, cache);
};

export type HealedEntry = {
  readonly key: string;
  readonly file: string;
  readonly previousLine: number;
  readonly line: number;
};

/**
 * Walk the index and rewrite every entry whose audited signature still
 * exists in the file but at a different line. Saves the caller from having
 * to hand-edit `.unspa.json` after every refactor that shifts line
 * numbers. Returns the list of healed entries plus a fresh index; the
 * caller is responsible for persisting the new index back to disk.
 */
export const healIndexLines = (
  index: BehavioralIndex,
  repoRoot: string,
  cache: FileCache
): { healed: readonly HealedEntry[]; nextIndex: BehavioralIndex } => {
  const healed: HealedEntry[] = [];
  const nextIndex: BehavioralIndex = { ...index };
  for (const [key, entry] of Object.entries(index)) {
    if (!entry || entry.status === 'missing') continue;
    if (!entry.signature || !entry.line || entry.line <= 0) continue;
    const lines = readLinesCached(cache, repoRoot, entry.file);
    if (!lines) continue;
    const foundLine = findSignatureLine(lines, entry.signature);
    if (foundLine === null) continue;
    if (Math.abs(foundLine - entry.line) <= FRESH_WINDOW) continue;
    nextIndex[key] = { ...entry, line: foundLine };
    healed.push({ key, file: entry.file, previousLine: entry.line, line: foundLine });
  }
  return { healed, nextIndex };
};

const entityTypeSchema = z.enum([
  'action',
  'event',
  'rule',
  'invariant',
  'transition',
  'state',
  'data',
  'surface_rule',
  'surface_invariant'
]);

const tagLocationSchema = z.object({
  file: z.string().min(1),
  line: z.number().int().nonnegative().optional(),
  snippet: z.string().optional(),
  stale: z.boolean().optional(),
  suggestedLine: z.number().int().positive().optional()
});

const foundEntitySchema = z.object({
  entityType: entityTypeSchema,
  entityId: z.string().min(1),
  locations: z.array(tagLocationSchema),
  capturedFields: z.unknown().optional()
});

const extraTagSchema = z.object({
  tag: z.string().min(1),
  locations: z.array(tagLocationSchema)
});

export const registerImplementationStatusTools = (deps: ToolDeps): void => {
  const { server, repo, projectRepo, reportImplementationStatus, getImplementationStatus, repoContext } = deps;

  server.registerTool(
    'report_implementation_status',
    {
      description:
        'Sync one action or surface worth of implementation data from the behavioral index into the dashboard. Pass `actionId` for action-scoped reports (action + events + rules + invariants + transitions) OR `surfaceId` for surface-scoped reports (states + data + surface_rules + surface_invariants). `foundEntities[]` is the entities you resolved. Each with file + line + snippet AND optional `capturedFields` (real values from the implementation for spec-vs-code diff). Missing entities are inferred (expected − found). Returns a slim ack.',
      inputSchema: {
        featureId: z.string(),
        actionId: z.string().optional(),
        surfaceId: z.string().optional(),
        foundEntities: z.array(foundEntitySchema),
        extraTags: z.array(extraTagSchema).optional()
      }
    },
    async (input) => {
      try {
        if (input.actionId && input.surfaceId)
          return errorText('Pass exactly one of actionId or surfaceId, not both');
        if (!input.actionId && !input.surfaceId)
          return errorText('report_implementation_status requires actionId or surfaceId');

        const featureId = await expandFeatureId(repo, input.featureId);
        const exp = await repo.get(asFeatureId(featureId));
        if (input.actionId && exp) {
          input.actionId = expandIdInFeature(exp, input.actionId, 'actionId');
        }
        if (input.surfaceId && exp) {
          input.surfaceId = expandIdInFeature(exp, input.surfaceId, 'surfaceId');
        }

        const indexKey = input.actionId
          ? `action:${input.actionId}`
          : `surface:${input.surfaceId}`;
        const auditMeta = readAuditMeta(repoContext, indexKey);
        const result = await reportImplementationStatus({
          featureId: asFeatureId(featureId),
          actionId: input.actionId ? asActionId(input.actionId) : undefined,
          surfaceId: input.surfaceId ? asSurfaceId(input.surfaceId) : undefined,
          foundEntities: input.foundEntities.map((f) => ({
            entityType: f.entityType as EntityType,
            entityId: f.entityId,
            locations: f.locations as readonly TagLocation[],
            ...(f.capturedFields !== undefined ? { capturedFields: f.capturedFields } : {})
          })),
          extraTags: input.extraTags,
          ...(auditMeta !== undefined ? { auditMeta } : {})
        });
        return text(
          trackTokens('report_implementation_status', {
            ok: true,
            featureId: result.featureId,
            revision: result.revision,
            updatedAt: result.updatedAt,
            scope: result.scope,
            slug: result.slug,
            missingEntities: result.missingEntities,
            foundEntities: result.foundEntities
          })
        );
      } catch (e) {
        if (e instanceof FeatureNotFoundForReportError) return errorText(e.message);
        if (e instanceof ActionNotFoundForReportError) return errorText(e.message);
        if (e instanceof SurfaceNotFoundForReportError) return errorText(e.message);
        return errorText(`report_implementation_status failed: ${(e as Error).message}`);
      }
    }
  );

  server.registerTool(
    'report_implementation_status_batch',
    {
      description:
        'Sync the full behavioral index into the dashboard in one call. Use after writing (or updating) .unspa.json with the behavioral index. Post one report per action and per surface. Preferred over the single-entity variant for whole-feature syncs. Each item in `reports` carries its own `actionId` xor `surfaceId`. Returns one slim ack per item; per-item failures are reported in-place without aborting the batch.',
      inputSchema: {
        featureId: z.string(),
        reports: z
          .array(
            z.object({
              actionId: z.string().optional(),
              surfaceId: z.string().optional(),
              foundEntities: z.array(foundEntitySchema),
              extraTags: z.array(extraTagSchema).optional()
            })
          )
          .min(1)
      }
    },
    async (input) => {
      const expandedFeatureId = await expandFeatureId(repo, input.featureId);
      const featureId = asFeatureId(expandedFeatureId);
      const exp = await repo.get(featureId);
      const acks: unknown[] = [];

      for (let i = 0; i < input.reports.length; i += 1) {
        const r = input.reports[i]!;
        try {
          if (r.actionId && r.surfaceId) {
            acks.push({ ok: false, index: i, error: 'Pass exactly one of actionId or surfaceId, not both' });
            continue;
          }
          if (!r.actionId && !r.surfaceId) {
            acks.push({ ok: false, index: i, error: 'Each report needs actionId or surfaceId' });
            continue;
          }

          if (r.actionId && exp) r.actionId = expandIdInFeature(exp, r.actionId, 'actionId');
          if (r.surfaceId && exp) r.surfaceId = expandIdInFeature(exp, r.surfaceId, 'surfaceId');

          const batchIndexKey = r.actionId
            ? `action:${r.actionId}`
            : `surface:${r.surfaceId}`;
          const batchAuditMeta = readAuditMeta(repoContext, batchIndexKey);
          const result = await reportImplementationStatus({
            featureId,
            actionId: r.actionId ? asActionId(r.actionId) : undefined,
            surfaceId: r.surfaceId ? asSurfaceId(r.surfaceId) : undefined,
            foundEntities: r.foundEntities.map((f) => ({
              entityType: f.entityType as EntityType,
              entityId: f.entityId,
              locations: f.locations as readonly TagLocation[],
              ...(f.capturedFields !== undefined ? { capturedFields: f.capturedFields } : {})
            })),
            extraTags: r.extraTags,
            ...(batchAuditMeta !== undefined ? { auditMeta: batchAuditMeta } : {})
          });
          acks.push({
            ok: true,
            index: i,
            revision: result.revision,
            updatedAt: result.updatedAt,
            scope: result.scope,
            slug: result.slug,
            missingCount: result.missingEntities.length,
            foundCount: result.foundEntities.length
          });
        } catch (e) {
          if (
            e instanceof FeatureNotFoundForReportError ||
            e instanceof ActionNotFoundForReportError ||
            e instanceof SurfaceNotFoundForReportError
          ) {
            acks.push({ ok: false, index: i, error: e.message });
            continue;
          }
          acks.push({ ok: false, index: i, error: (e as Error).message });
        }
      }

      const successes = acks.filter((a) => (a as { ok: boolean }).ok).length;
      return text(
        trackTokens('report_implementation_status_batch', {
          ok: successes === acks.length,
          featureId,
          batchSize: acks.length,
          successes,
          failures: acks.length - successes,
          acks
        })
      );
    }
  );

  server.registerTool(
    'get_implementation_status',
    {
      description:
        'Read the implementation-status sidecar for a feature. Optionally filter to one action or surface. Returns null when nothing has been reported yet. Useful before editing/extending an implementation: "what entities are already tagged, where in the repo do they live, and what real code was captured there?".',
      inputSchema: {
        featureId: z.string(),
        actionId: z.string().optional(),
        surfaceId: z.string().optional()
      }
    },
    async ({ featureId, actionId, surfaceId }) => {
      try {
        featureId = await expandFeatureId(repo, featureId);
        const exp = await repo.get(asFeatureId(featureId));
        if (actionId && exp) actionId = expandIdInFeature(exp, actionId, 'actionId');
        if (surfaceId && exp) surfaceId = expandIdInFeature(exp, surfaceId, 'surfaceId');
      } catch (e) {
        return errorText((e as Error).message);
      }
      const status = await getImplementationStatus(asFeatureId(featureId));
      if (!status)
        return text(trackTokens('get_implementation_status', { status: null }));
      if (actionId) {
        const cap = status.actions.find((c) => c.actionId === actionId);
        return text(
          trackTokens('get_implementation_status', {
            featureId: status.featureId,
            revision: status.revision,
            updatedAt: status.updatedAt,
            action: cap ?? null
          })
        );
      }
      if (surfaceId) {
        const surf = status.surfaces.find((s) => s.surfaceId === surfaceId);
        return text(
          trackTokens('get_implementation_status', {
            featureId: status.featureId,
            revision: status.revision,
            updatedAt: status.updatedAt,
            surface: surf ?? null
          })
        );
      }
      return text(trackTokens('get_implementation_status', status));
    }
  );

  server.registerTool(
    'sync_from_index',
    {
      description:
        'Read .unspa.json and push a full implementation-status report for every action and surface in one call. No UUIDs or get_feature(verbose:true) needed. Every entity must have its own index entry: an action/surface entry only contributes the top-level row, and each child (event:<name>, rule:<id>, invariant:<id>, transition:<id>, state:<path>, surface_rule:<id>, surface_invariant:<id>) must be indexed separately at the exact line where it lives in code. Children without their own entry are reported missing. There is no fallback to the parent\'s location, because the parent snippet does not describe the child. auditMeta is attached automatically from the index entry fields (auditedAt, gitCommit, kind, etc.). Each location gets a 3-line code slice (line ±1) read from disk as its snippet. Before sync runs, every entry is auto-healed: if the audited signature still exists in the file but at a different line, the index is rewritten in place and persisted back to disk. The response includes a `healed` block listing every entry that moved. The `stale` block then only contains entries whose signature could not be located at all, those need a manual re-audit. Call this after writing or updating .unspa.json to sync the dashboard.',
      inputSchema: {}
    },
    async () => {
      if (!repoContext?.linkPath) {
        return errorText('No .unspa.json found. Cannot sync from index.');
      }

      let rawLink: { projectId?: string; index?: BehavioralIndex };
      try {
        rawLink = JSON.parse(readFileSync(repoContext.linkPath, 'utf8'));
      } catch {
        return errorText(`Could not read ${repoContext.linkPath}`);
      }

      if (!rawLink.projectId) {
        return errorText('.unspa.json is missing projectId. Run `unspa link` first.');
      }

      const project = await projectRepo.get(asProjectId(rawLink.projectId));
      if (!project) return errorText(`Project ${rawLink.projectId} not found`);

      // Walk every feature that belongs to the linked project. The index is
      // a flat keyed map (action:<id>, surface:<id>, ...) — ids are UUIDs
      // unique system-wide, so a single index covers all the project's
      // features without per-feature partitioning.
      const features: Feature[] = [];
      for (const fid of project.featureIds) {
        const f = await repo.get(asFeatureId(String(fid)));
        if (f) features.push(f);
      }
      if (features.length === 0) {
        return errorText(`Project ${rawLink.projectId} has no features. Add one via add_feature_to_project.`);
      }

      const repoRoot = dirname(repoContext.linkPath);
      const fileCache: FileCache = new Map();

      // Auto-heal: rewrite drifted line numbers in-memory, then persist the
      // updated index back to disk before the staleness check below runs.
      // That way callers don't have to hand-edit `.unspa.json` after every
      // refactor that shifts lines. Healed entries are surfaced in the
      // response so the caller can audit what changed.
      const initialIndex: BehavioralIndex = rawLink.index ?? {};
      const { healed, nextIndex } = healIndexLines(initialIndex, repoRoot, fileCache);
      const index: BehavioralIndex = nextIndex;
      if (healed.length > 0) {
        try {
          const nextLink: RepoLink = { ...rawLink, index } as RepoLink;
          writeRepoLink(repoContext.linkPath, nextLink);
        } catch {
          // Persistence is best-effort. Next sync will heal again from the
          // same signatures if the write was blocked (e.g. EPERM on Windows
          // when another process holds the file open).
        }
      }
      /** Per-call drift tally. Surfaced in the ack so re-audit prompts are obvious. */
      const staleEntries: { key: string; file: string; line: number; suggestedLine?: number }[] = [];
      const recordStale = (loc: TagLocation, key: string): void => {
        if (loc.stale) {
          staleEntries.push({
            key,
            file: loc.file,
            line: loc.line ?? 0,
            ...(loc.suggestedLine !== undefined ? { suggestedLine: loc.suggestedLine } : {})
          });
        }
      };
      const acks: unknown[] = [];

      for (const exp of features) {
        const featureId = exp.id;
      for (const surface of exp.surfaces) {
        // ── action-scoped reports ────────────────────────────────
        for (const action of surface.actions) {
          const capKey = `action:${String(action.id)}`;
          const capEntry = index[capKey];
          if (!capEntry) continue;

          const foundEntities: ReportEntityInput[] = [];

          if (capEntry.status !== 'missing') {
            const capLoc = entryToLocation(capEntry, repoRoot, fileCache);
            recordStale(capLoc, capKey);
            foundEntities.push({
              entityType: 'action',
              entityId: String(action.id),
              locations: [capLoc]
            });

            for (const event of action.emittedEvents) {
              const childKey = `event:${String(event)}`;
              const loc = resolveChildLocation(childKey, index, repoRoot, fileCache);
              if (loc) {
                recordStale(loc, childKey);
                foundEntities.push({ entityType: 'event', entityId: String(event), locations: [loc] });
              }
            }
            for (const rule of action.rules) {
              const childKey = `rule:${String(rule.id)}`;
              const loc = resolveChildLocation(childKey, index, repoRoot, fileCache);
              if (loc) {
                recordStale(loc, childKey);
                foundEntities.push({ entityType: 'rule', entityId: String(rule.id), locations: [loc] });
              }
            }
            for (const inv of action.invariants) {
              const childKey = `invariant:${String(inv.id)}`;
              const loc = resolveChildLocation(childKey, index, repoRoot, fileCache);
              if (loc) {
                recordStale(loc, childKey);
                foundEntities.push({ entityType: 'invariant', entityId: String(inv.id), locations: [loc] });
              }
            }
            for (const t of action.transitions) {
              const childKey = `transition:${String(t.id)}`;
              const loc = resolveChildLocation(childKey, index, repoRoot, fileCache);
              if (loc) {
                recordStale(loc, childKey);
                foundEntities.push({ entityType: 'transition', entityId: String(t.id), locations: [loc] });
              }
            }
          }

          const auditMeta = extractAuditMeta(capEntry);
          try {
            const result = await reportImplementationStatus({
              featureId,
              actionId: action.id,
              foundEntities,
              ...(auditMeta !== undefined ? { auditMeta } : {})
            });
            acks.push({
              ok: true,
              scope: 'action',
              slug: result.slug,
              revision: result.revision,
              found: result.foundEntities.length,
              missing: result.missingEntities.length
            });
          } catch (e) {
            acks.push({ ok: false, scope: 'action', id: String(action.id), error: (e as Error).message });
          }
        }

        // ── surface-scoped report ────────────────────────────────────
        const surfKey = `surface:${String(surface.id)}`;
        const surfEntry = index[surfKey];
        if (!surfEntry) continue;

        const surfFoundEntities: ReportEntityInput[] = [];

        if (surfEntry.status === 'implemented') {
          for (const sd of surface.stateDefinitions) {
            const childKey = `state:${String(sd.path)}`;
            const loc = resolveChildLocation(childKey, index, repoRoot, fileCache);
            if (loc) {
              recordStale(loc, childKey);
              surfFoundEntities.push({ entityType: 'state', entityId: String(sd.id), locations: [loc] });
            }
          }
          for (const r of surface.rules) {
            const childKey = `surface_rule:${String(r.id)}`;
            const loc = resolveChildLocation(childKey, index, repoRoot, fileCache);
            if (loc) {
              recordStale(loc, childKey);
              surfFoundEntities.push({ entityType: 'surface_rule', entityId: String(r.id), locations: [loc] });
            }
          }
          for (const inv of surface.invariants) {
            const childKey = `surface_invariant:${String(inv.id)}`;
            const loc = resolveChildLocation(childKey, index, repoRoot, fileCache);
            if (loc) {
              recordStale(loc, childKey);
              surfFoundEntities.push({ entityType: 'surface_invariant', entityId: String(inv.id), locations: [loc] });
            }
          }
        }

        const surfAuditMeta = extractAuditMeta(surfEntry);
        try {
          const result = await reportImplementationStatus({
            featureId,
            surfaceId: surface.id,
            foundEntities: surfFoundEntities,
            ...(surfAuditMeta !== undefined ? { auditMeta: surfAuditMeta } : {})
          });
          acks.push({
            ok: true,
            scope: 'surface',
            slug: result.slug,
            revision: result.revision,
            found: result.foundEntities.length,
            missing: result.missingEntities.length
          });
        } catch (e) {
          acks.push({ ok: false, scope: 'surface', id: String(surface.id), error: (e as Error).message });
        }
      }
      } // end for (const exp of features)

      const successes = acks.filter((a) => (a as { ok: boolean }).ok).length;
      const skipped =
        features.reduce(
          (n, exp) => n + exp.surfaces.reduce((m, s) => m + s.actions.length + 1, 0),
          0
        ) - acks.length;
      const healable = staleEntries.filter((s) => s.suggestedLine !== undefined);
      const unhealable = staleEntries.filter((s) => s.suggestedLine === undefined);

      return text(
        trackTokens('sync_from_index', {
          ok: successes === acks.length,
          projectId: String(project.id),
          featureIds: features.map((f) => String(f.id)),
          synced: acks.length,
          successes,
          failures: acks.length - successes,
          skipped,
          healed: {
            total: healed.length,
            entries: healed
          },
          stale: {
            total: staleEntries.length,
            healable: healable.length,
            unhealable: unhealable.length,
            entries: staleEntries
          },
          acks
        })
      );
    }
  );
};
