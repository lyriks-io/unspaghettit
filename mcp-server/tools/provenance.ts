import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import type { Feature } from '../../src/features/behavior-model/domain/entities/Feature';
import {
  asFeatureId,
  type FeatureId
} from '../../src/features/behavior-model/domain/value-objects/ids';
import {
  buildAdoptionEntries,
  normalizeRepoPath,
  type AdoptionSourceMeta
} from '../../src/features/source-provenance/domain/CodeAdoption';
import {
  ELEMENT_TYPES,
  emptyProvenance,
  finalizeProvenance,
  linkSource,
  recordSpan
} from '../../src/features/source-provenance/domain/Provenance';
import {
  addConflict,
  openConflicts,
  resolveConflict,
  suggestConflictWinner
} from '../../src/features/source-provenance/domain/Conflicts';
import {
  CANDIDATE_DISPOSITIONS,
  coverageForCandidates,
  disposeCandidate,
  rollUpCoverage,
  stageCandidate,
  type BehaviorCandidate
} from '../../src/features/source-provenance/domain/Candidates';
import {
  SOURCE_ARTIFACTS,
  SOURCE_AUTHORITIES,
  classifySource,
  createProjectSource,
  effectiveAuthority,
  toSourceMeta,
  type SourceArtifact,
  type SourceAuthority
} from '../../src/features/source-provenance/domain/ProjectSource';
import { writeRepoLink, type BehavioralIndex, type RepoLink } from '../repo-link';
import {
  enumerateFeatureElements,
  type FeatureElement
} from '../../src/features/source-provenance/domain/FeatureElements';
import type { ProjectRepository } from '../../src/features/projects/application/ports/ProjectRepository';
import { errorText, text, type ToolDeps } from './_shared';
import { expandFeatureId, expandProjectId } from './short-ids';

/** Resolve an element by exact id or unique prefix against the feature's elements. */
const matchElement = (
  elements: readonly FeatureElement[],
  elementId: string
): { readonly el: FeatureElement } | { readonly error: string } => {
  const exact = elements.find((e) => e.id === elementId);
  if (exact) return { el: exact };
  const prefix = elements.filter((e) => e.id.startsWith(elementId));
  if (prefix.length === 1) return { el: prefix[0]! };
  if (prefix.length > 1) {
    return { error: `Ambiguous element id "${elementId}" matches ${prefix.length} elements.` };
  }
  return {
    error: `No element "${elementId}" in this feature. Call get_feature to list element ids.`
  };
};

/** Which project claims this feature, or null when it lives in __unassigned. */
const findOwningProjectId = async (
  projectRepo: ProjectRepository,
  featureId: string
): Promise<string | null> => {
  for (const summary of await projectRepo.list()) {
    const project = await projectRepo.get(summary.id);
    if (project?.featureIds.some((fid) => String(fid) === featureId)) return String(project.id);
  }
  return null;
};

/** Slice of a stored document returned by get_source. Full 1 MiB docs would flood the context. */
const DEFAULT_READ_CHARS = 100_000;

const sourceAuthoritySchema = z
  .enum(SOURCE_AUTHORITIES)
  .describe(
    'How much this source may SETTLE a disagreement: normative (source of truth for intended behavior), supporting (evidences behavior but not the authority on intent), observed (a report of what happens, not a decision), unknown (default). When absent it is derived from `artifact`.'
  );

const sourceArtifactSchema = z
  .enum(SOURCE_ARTIFACTS)
  .describe(
    'What kind of artifact the source is: implementation, test, contract, documentation, or interview. Sets a default authority (contract -> normative; implementation/test/documentation -> supporting; interview -> observed).'
  );

const candidateDispositionSchema = z
  .enum(CANDIDATE_DISPOSITIONS)
  .describe(
    'Review state of a staged behavior: unreviewed (default), accepted (reached the model), merged (folded into another, a duplicate), rejected / out_of_scope (deliberately excluded), or conflict (tied up in an open disagreement).'
  );

const proposedKindSchema = z
  .enum(ELEMENT_TYPES)
  .describe('The element type this candidate proposes to become (surface, action, rule, ...).');

const countUnreviewed = (candidates: readonly BehaviorCandidate[]): number =>
  candidates.filter((c) => c.disposition === 'unreviewed').length;

/**
 * Source Provenance tools (feature 39e57ee0). Documents live in the
 * project-level source store (`<projectFolder>/sources/`), immutable and
 * deduplicated by content hash: pasted in the dashboard's Project Sources
 * panel or attached here. Spans stamp each extracted element with the exact
 * range of the stored document it came from, so the dashboard can render the
 * text with every rule/action highlighted at its source. Guard logic lives in
 * the pure domain helpers; these tools load, resolve ids, call the helper,
 * and persist.
 */
export const registerProvenanceTools = (deps: ToolDeps): void => {
  const { server, repo, projectRepo, provenanceRepo, sourceRepo, clock, ids, repoContext } = deps;

  /**
   * Shared core of the two attach tools: refuse a finalized analysis, dedupe
   * against the project store (path-aware for code sources, so identical
   * content at two paths stays two sources and a pasted document never
   * swallows a code attach), persist, and link the source to the analysis.
   * `extra` is merged into the ack for tool-specific fields.
   */
  const storeAndLinkSource = async (args: {
    readonly fid: FeatureId;
    readonly feature: Feature;
    readonly name: string;
    readonly kind: 'file' | 'code';
    readonly authority?: SourceAuthority;
    readonly artifact?: SourceArtifact;
    readonly content: string;
    readonly maxBytes?: number;
    readonly extra?: Record<string, unknown>;
  }) => {
    const current = (await provenanceRepo.get(args.fid)) ?? emptyProvenance(args.fid, clock());
    if (current.finalized) {
      return errorText('This analysis is finalized; reset_analysis before attaching another source.');
    }

    const projectId = await findOwningProjectId(projectRepo, String(args.fid));
    const existing = await sourceRepo.listForProject(projectId);
    const dedupePool =
      args.kind === 'code'
        ? existing.filter((s) => s.kind === 'code' && s.name === args.name)
        : existing.filter((s) => s.kind !== 'code');
    const created = createProjectSource(
      {
        id: ids(),
        projectId,
        name: args.name,
        kind: args.kind,
        ...(args.authority !== undefined ? { authority: args.authority } : {}),
        ...(args.artifact !== undefined ? { artifact: args.artifact } : {}),
        content: args.content,
        attachedAt: clock(),
        ...(args.maxBytes !== undefined ? { maxBytes: args.maxBytes } : {})
      },
      dedupePool
    );
    if (!created.ok) return errorText(created.reason);
    if (!created.deduped) await sourceRepo.save(created.source);

    const linked = linkSource(current, created.source.id, clock());
    if (!linked.ok) return errorText(linked.reason);
    await provenanceRepo.save(linked.provenance);

    return text({
      ok: true,
      featureId: String(args.fid),
      sourceId: created.source.id,
      fileName: created.source.name,
      kind: created.source.kind,
      ...(created.source.artifact !== undefined ? { artifact: created.source.artifact } : {}),
      authority: effectiveAuthority(created.source),
      byteLength: created.source.byteLength,
      contentHash: created.source.contentHash,
      deduped: created.deduped,
      // A dedupe kept the STORED source's classification, not this call's — say so.
      ...(created.deduped &&
      (args.authority !== undefined || args.artifact !== undefined) &&
      (created.source.authority !== args.authority || created.source.artifact !== args.artifact)
        ? {
            classificationIgnored:
              'Deduped onto an existing source; its classification was kept. Use classify_source to re-tag it.'
          }
        : {}),
      elementCount: enumerateFeatureElements(args.feature).length,
      spanCount: linked.provenance.spans.length,
      ...(args.extra ?? {})
    });
  };

  server.registerTool(
    'attach_source_file',
    {
      description:
        "Store the document you analyzed as a project-level source (in the owning project's sources/ folder) and link it to this feature's analysis. Identical content is deduplicated: re-attaching the same text links the existing source instead of storing a copy. Prefer pulling a source the user already pasted in the dashboard (list_sources + get_source) over pushing content here. Pass kind:'code' when the source is a source-code file you are adopting into the model; fileName must then be the file's repo-relative path (e.g. src/lib/cart.ts), because spans recorded against a code source can be turned into .unspa.json implementation entries by seed_index_from_analysis. Set `authority` and/or `artifact` to rank the source, so a later contradiction resolves by authority rather than by which document was ingested last. Blocked if the analysis is finalized or the content exceeds the storage cap (default 1 MiB).",
      inputSchema: {
        featureId: z.string(),
        fileName: z.string().min(1),
        content: z.string(),
        kind: z.enum(['file', 'code']).optional(),
        authority: sourceAuthoritySchema.optional(),
        artifact: sourceArtifactSchema.optional(),
        maxBytes: z.number().int().positive().optional()
      }
    },
    async ({ featureId, fileName, content, kind, authority, artifact, maxBytes }) => {
      try {
        const fid = asFeatureId(await expandFeatureId(repo, featureId));
        const feature = await repo.get(fid);
        if (!feature) return errorText(`Feature ${String(fid)} not found`);

        // A code source's name doubles as its implementation path in
        // `.unspa.json`, so it must be a clean repo-relative path.
        let sourceName = fileName;
        if (kind === 'code') {
          const normalized = normalizeRepoPath(fileName);
          if (!normalized.ok) return errorText(normalized.reason);
          sourceName = normalized.path;
        }

        return await storeAndLinkSource({
          fid,
          feature,
          name: sourceName,
          kind: kind ?? 'file',
          ...(authority !== undefined ? { authority } : {}),
          ...(artifact !== undefined ? { artifact } : {}),
          content,
          ...(maxBytes !== undefined ? { maxBytes } : {})
        });
      } catch (e) {
        return errorText(`attach_source_file failed: ${(e as Error).message}`);
      }
    }
  );

  server.registerTool(
    'attach_source_path',
    {
      description:
        "Token-saving attach for codebase adoption: pass a repo-relative path and the server reads the file from disk itself, so the content never has to be re-emitted through the conversation (roughly halves the cost of adopting a file). This is the one deliberate, opt-in exception to 'the MCP never reads source files': the path is validated (repo-relative only, no absolute paths or dot-walks), resolved against the linked repo root (the .unspa.json folder; the server's working directory when not linked yet), and size-capped. CRLF line endings are normalized to LF so span offsets are OS-independent (line numbers unchanged); the ack's contentHash + totalChars let you verify the stored text against the version you read. Defaults to kind:'code'; pass kind:'file' for a document that happens to live in the repo. Set `authority`/`artifact` to rank the source (a code file defaults to artifact:'implementation' semantics; pass artifact:'test' for a spec/test file so a later contradiction resolves by authority). Blocked if the analysis is finalized.",
      inputSchema: {
        featureId: z.string(),
        path: z.string().min(1),
        kind: z.enum(['file', 'code']).optional(),
        authority: sourceAuthoritySchema.optional(),
        artifact: sourceArtifactSchema.optional(),
        maxBytes: z.number().int().positive().optional()
      }
    },
    async ({ featureId, path, kind, authority, artifact, maxBytes }) => {
      try {
        const fid = asFeatureId(await expandFeatureId(repo, featureId));
        const feature = await repo.get(fid);
        if (!feature) return errorText(`Feature ${String(fid)} not found`);

        const normalized = normalizeRepoPath(path);
        if (!normalized.ok) return errorText(normalized.reason);

        const repoRoot = repoContext?.linkPath ? dirname(repoContext.linkPath) : repoContext?.cwd;
        if (!repoRoot) {
          return errorText(
            'No repo context available to resolve the path against; pass the content via attach_source_file instead.'
          );
        }
        const abs = resolve(repoRoot, normalized.path);
        if (!existsSync(abs)) {
          return errorText(`No file at ${normalized.path} (resolved against ${repoRoot}).`);
        }
        let content: string;
        try {
          content = readFileSync(abs, 'utf8');
        } catch (e) {
          return errorText(`Could not read ${normalized.path}: ${(e as Error).message}`);
        }
        const normalizedEol = content.includes('\r\n');
        if (normalizedEol) content = content.replace(/\r\n/g, '\n');

        return await storeAndLinkSource({
          fid,
          feature,
          name: normalized.path,
          kind: kind ?? 'code',
          ...(authority !== undefined ? { authority } : {}),
          ...(artifact !== undefined ? { artifact } : {}),
          content,
          ...(maxBytes !== undefined ? { maxBytes } : {}),
          extra: { totalChars: content.length, normalizedEol }
        });
      } catch (e) {
        return errorText(`attach_source_path failed: ${(e as Error).message}`);
      }
    }
  );

  server.registerTool(
    'record_element_span',
    {
      description:
        'Stamp one extracted element (surface/action/rule/invariant/transition/state/event/entity) with the exact span of the stored source it was derived from. `startOffset`/`endOffset` are character offsets into the source content (end exclusive). Pass `sourceId` when several sources are linked to the analysis; with a single linked source it can be omitted. The element type is resolved from the feature, so pass only its id (full or unique prefix). Blocked if no source is stored, the analysis is finalized, the span is empty/inverted, the span runs past the document, or the element already has a span.',
      inputSchema: {
        featureId: z.string(),
        elementId: z.string().min(1),
        startOffset: z.number().int().nonnegative(),
        endOffset: z.number().int().positive(),
        sourceId: z.string().optional()
      }
    },
    async ({ featureId, elementId, startOffset, endOffset, sourceId }) => {
      try {
        const fid = asFeatureId(await expandFeatureId(repo, featureId));
        const feature = await repo.get(fid);
        if (!feature) return errorText(`Feature ${String(fid)} not found`);

        const elements = enumerateFeatureElements(feature);
        const match = matchElement(elements, elementId);
        if ('error' in match) return errorText(match.error);

        const current = (await provenanceRepo.get(fid)) ?? emptyProvenance(fid, clock());

        // Resolve the document the offsets point into: an explicit sourceId,
        // the single linked source, or the legacy embedded file.
        let source: { readonly id: string; readonly content: string } | undefined;
        if (sourceId) {
          const found = await sourceRepo.find(sourceId);
          if (!found) return errorText(`No stored source "${sourceId}". Call list_sources.`);
          source = { id: found.id, content: found.content };
        } else if (!current.file) {
          if (current.sourceIds.length === 0) {
            return errorText(
              'No source stored for this analysis. Call attach_source_file (or paste one in the dashboard) first.'
            );
          }
          if (current.sourceIds.length > 1) {
            return errorText(
              `Several sources are linked (${current.sourceIds.join(', ')}); pass sourceId to say which one this span points into.`
            );
          }
          const found = await sourceRepo.find(current.sourceIds[0]!);
          if (!found) {
            return errorText(`Linked source "${current.sourceIds[0]}" is missing from the store.`);
          }
          source = { id: found.id, content: found.content };
        }

        const result = recordSpan(current, {
          id: ids(),
          elementId: match.el.id,
          elementType: match.el.type,
          startOffset,
          endOffset,
          recordedAt: clock(),
          ...(source ? { source } : {})
        });
        if (!result.ok) return errorText(result.reason);
        await provenanceRepo.save(result.provenance);

        const spanCount = result.provenance.spans.length;
        return text({
          ok: true,
          featureId: String(fid),
          elementId: match.el.id,
          elementType: match.el.type,
          label: match.el.label,
          ...(source ? { sourceId: source.id } : {}),
          spanCount,
          remaining: elements.length - spanCount
        });
      } catch (e) {
        return errorText(`record_element_span failed: ${(e as Error).message}`);
      }
    }
  );

  server.registerTool(
    'finalize_analysis',
    {
      description:
        'Lock the provenance analysis once every extracted element has a recorded span. Blocked if no source is stored, the analysis is already finalized, or any element is still untraced (call get_provenance to see which).',
      inputSchema: { featureId: z.string() }
    },
    async ({ featureId }) => {
      try {
        const fid = asFeatureId(await expandFeatureId(repo, featureId));
        const feature = await repo.get(fid);
        if (!feature) return errorText(`Feature ${String(fid)} not found`);

        const elementCount = enumerateFeatureElements(feature).length;
        const current = (await provenanceRepo.get(fid)) ?? emptyProvenance(fid, clock());
        const result = finalizeProvenance(current, elementCount, clock());
        if (!result.ok) return errorText(result.reason);
        await provenanceRepo.save(result.provenance);

        const stillOpen = openConflicts(result.provenance.conflicts).length;
        return text({
          ok: true,
          featureId: String(fid),
          finalized: true,
          elementCount,
          spanCount: result.provenance.spans.length,
          // Tracing is complete; an open conflict means a behavior is still
          // undecided. Advisory (finalize is not blocked), but surfaced so a
          // completeness claim can account for it.
          openConflictCount: stillOpen,
          ...(stillOpen > 0
            ? { note: `${stillOpen} source conflict(s) still open; the extraction is traced but not settled.` }
            : {})
        });
      } catch (e) {
        return errorText(`finalize_analysis failed: ${(e as Error).message}`);
      }
    }
  );

  server.registerTool(
    'record_element_spans',
    {
      description:
        'Batch form of record_element_span: stamp MANY extracted elements with their source spans in one call (one load, one save), cutting the per-span round-trip cost that dominates codebase adoption. Each item: { elementId, startOffset, endOffset, sourceId? }. A call-level sourceId is the default for items that omit their own; with a single linked source both can be omitted. Items are applied in order; a failing item is reported in `results` with its reason and does NOT abort the rest. Nothing is persisted when every item fails. Same validation as the single tool: offsets are character offsets into the stored source (end exclusive), one span per element.',
      inputSchema: {
        featureId: z.string(),
        sourceId: z.string().optional(),
        spans: z
          .array(
            z.object({
              elementId: z.string().min(1),
              startOffset: z.number().int().nonnegative(),
              endOffset: z.number().int().positive(),
              sourceId: z.string().optional()
            })
          )
          .min(1)
      }
    },
    async ({ featureId, sourceId, spans }) => {
      try {
        const fid = asFeatureId(await expandFeatureId(repo, featureId));
        const feature = await repo.get(fid);
        if (!feature) return errorText(`Feature ${String(fid)} not found`);

        const elements = enumerateFeatureElements(feature);
        let current = (await provenanceRepo.get(fid)) ?? emptyProvenance(fid, clock());

        const sourceCache = new Map<string, { readonly id: string; readonly content: string }>();
        const loadSource = async (id: string) => {
          const cached = sourceCache.get(id);
          if (cached) return cached;
          const found = await sourceRepo.find(id);
          if (!found) return undefined;
          const slim = { id: found.id, content: found.content };
          sourceCache.set(id, slim);
          return slim;
        };

        const results: Array<Record<string, unknown>> = [];
        let recorded = 0;

        for (const item of spans) {
          const match = matchElement(elements, item.elementId);
          if ('error' in match) {
            results.push({ elementId: item.elementId, ok: false, error: match.error });
            continue;
          }

          // Resolve the document this item's offsets point into: its own
          // sourceId, the call-level default, the single linked source, or
          // the legacy embedded file (source stays undefined).
          let source: { readonly id: string; readonly content: string } | undefined;
          const wanted = item.sourceId ?? sourceId;
          if (wanted) {
            source = await loadSource(wanted);
            if (!source) {
              results.push({
                elementId: match.el.id,
                ok: false,
                error: `No stored source "${wanted}". Call list_sources.`
              });
              continue;
            }
          } else if (!current.file) {
            if (current.sourceIds.length === 0) {
              results.push({
                elementId: match.el.id,
                ok: false,
                error: 'No source stored for this analysis. Attach one first.'
              });
              continue;
            }
            if (current.sourceIds.length > 1) {
              results.push({
                elementId: match.el.id,
                ok: false,
                error: `Several sources are linked (${current.sourceIds.join(', ')}); pass sourceId on the item or the call.`
              });
              continue;
            }
            source = await loadSource(current.sourceIds[0]!);
            if (!source) {
              results.push({
                elementId: match.el.id,
                ok: false,
                error: `Linked source "${current.sourceIds[0]}" is missing from the store.`
              });
              continue;
            }
          }

          const result = recordSpan(current, {
            id: ids(),
            elementId: match.el.id,
            elementType: match.el.type,
            startOffset: item.startOffset,
            endOffset: item.endOffset,
            recordedAt: clock(),
            ...(source ? { source } : {})
          });
          if (!result.ok) {
            results.push({ elementId: match.el.id, ok: false, error: result.reason });
            continue;
          }
          current = result.provenance;
          recorded += 1;
          results.push({ elementId: match.el.id, elementType: match.el.type, ok: true });
        }

        if (recorded > 0) await provenanceRepo.save(current);

        const failed = results.filter((r) => r.ok !== true).length;
        return text({
          ok: failed === 0,
          featureId: String(fid),
          recorded,
          failed,
          results,
          spanCount: current.spans.length,
          remaining: elements.length - current.spans.length
        });
      } catch (e) {
        return errorText(`record_element_spans failed: ${(e as Error).message}`);
      }
    }
  );

  server.registerTool(
    'seed_index_from_analysis',
    {
      description:
        "Turn a codebase-adoption analysis into implementation coverage: every span recorded against a kind:'code' source becomes a .unspa.json behavioral-index entry ({file, line, signature}, status implemented, specVersion stamped so drift detection starts armed). This is the code-to-spec bridge: one analysis pass yields the model, its provenance, AND the spec-to-code mapping. Every traced element is seeded, including entities, feature-level invariants, surface-declared transitions, and declared events; those kinds don't appear in the per-action coverage report but they document the location and arm drift detection. Existing index entries are never overwritten unless overwrite:true. Spans against pasted/file sources are counted but not seeded; only elements that no longer resolve in the feature land in `skipped`, with the reason. Writing needs the repo to be linked (.unspa.json via `unspa link`); dryRun:true works without a link and returns the same `entries` map for you to merge into your own .unspa.json — that is the path for a host running this server away from the checkout. Run sync_from_index afterwards to push the coverage report to the dashboard.",
      inputSchema: {
        featureId: z.string(),
        overwrite: z.boolean().optional(),
        dryRun: z.boolean().optional()
      }
    },
    async ({ featureId, overwrite, dryRun }) => {
      try {
        // A link is needed to WRITE the index, not to compute it. Requiring one
        // up front made the preview impossible for a host that runs this server
        // away from the checkout — which is precisely the caller that needs the
        // entries handed back so it can write them itself.
        if (!repoContext?.linkPath && dryRun !== true) {
          return errorText(
            'No .unspa.json found. Run `unspa link` first so there is a behavioral index to seed, or pass dryRun:true to receive the entries and write them yourself.'
          );
        }
        const fid = asFeatureId(await expandFeatureId(repo, featureId));
        const feature = await repo.get(fid);
        if (!feature) return errorText(`Feature ${String(fid)} not found`);

        const prov = await provenanceRepo.get(fid);
        if (!prov || prov.spans.length === 0) {
          return errorText(
            'No spans recorded for this feature. Attach code sources (attach_source_file kind:"code") and record_element_span first.'
          );
        }

        const sources = new Map<string, AdoptionSourceMeta>();
        for (const id of prov.sourceIds) {
          const source = await sourceRepo.find(id);
          if (source) sources.set(id, { kind: source.kind, name: source.name });
        }

        const built = buildAdoptionEntries({
          feature,
          spans: prov.spans,
          sources,
          auditedAt: clock(),
          specVersion: feature.updatedAt
        });
        if (built.entries.length === 0) {
          return errorText(
            `No seedable spans: ${built.nonCodeSpanCount} span(s) trace to non-code sources and ${built.skipped.length} element(s) have no coverage slot. Attach the source files with kind:'code' if this analysis came from a codebase.`
          );
        }

        // Unlinked previews start from an empty index: there is no file to merge
        // with, so every built entry is new and the caller merges on its side.
        let rawLink: RepoLink | null = null;
        if (repoContext?.linkPath) {
          try {
            rawLink = JSON.parse(readFileSync(repoContext.linkPath, 'utf8')) as RepoLink;
          } catch {
            return errorText(`Could not read ${repoContext.linkPath}`);
          }
        }

        const repoRoot = repoContext?.linkPath ? dirname(repoContext.linkPath) : null;
        const index: BehavioralIndex = { ...(rawLink?.index ?? {}) };
        const written: string[] = [];
        const kept: string[] = [];
        const missingFiles = new Set<string>();
        for (const e of built.entries) {
          if (index[e.key] && overwrite !== true) {
            kept.push(e.key);
            continue;
          }
          // Only checkable against a checkout we can see; skipped when unlinked.
          if (repoRoot !== null && !existsSync(resolve(repoRoot, e.entry.file))) {
            missingFiles.add(e.entry.file);
          }
          index[e.key] = e.entry;
          written.push(e.key);
        }

        if (dryRun !== true && written.length > 0 && repoContext?.linkPath && rawLink) {
          writeRepoLink(repoContext.linkPath, { ...rawLink, index });
        }

        return text({
          ok: true,
          featureId: String(fid),
          dryRun: dryRun === true,
          written: written.length,
          writtenKeys: written,
          // The entries themselves, keyed as they belong under `index` in
          // .unspa.json. Keys alone are not actionable for a caller that has to
          // persist the index itself — it needs the {file, line, signature,
          // specVersion} values, which are the whole point of seeding.
          entries: Object.fromEntries(built.entries.map((e) => [e.key, e.entry])),
          keptExisting: kept,
          skipped: built.skipped,
          nonCodeSpans: built.nonCodeSpanCount,
          // Files referenced by seeded entries that don't exist on disk here:
          // usually means the analysis ran against another checkout or paths
          // were recorded wrong. The entries are still written.
          missingFiles: [...missingFiles],
          hint:
            written.length > 0
              ? 'Call sync_from_index to auto-heal lines and push the coverage report to the dashboard.'
              : 'Nothing written; pass overwrite:true to replace existing entries.'
        });
      } catch (e) {
        return errorText(`seed_index_from_analysis failed: ${(e as Error).message}`);
      }
    }
  );

  server.registerTool(
    'reset_analysis',
    {
      description:
        "Discard a feature's provenance analysis (its recorded spans, source links, finalized flag) so a fresh one can start, e.g. after attaching the wrong document or when the spec has changed shape. Stored project sources are NOT touched; use remove_source for that. Requires confirm:true.",
      inputSchema: { featureId: z.string(), confirm: z.boolean() }
    },
    async ({ featureId, confirm }) => {
      try {
        if (!confirm) {
          return errorText(
            'Resetting deletes every recorded span for this feature. Pass confirm:true to proceed.'
          );
        }
        const fid = asFeatureId(await expandFeatureId(repo, featureId));
        const current = await provenanceRepo.get(fid);
        if (!current) return errorText(`No provenance analysis stored for feature ${String(fid)}.`);
        await provenanceRepo.delete(fid);
        return text({ ok: true, featureId: String(fid), discardedSpans: current.spans.length });
      } catch (e) {
        return errorText(`reset_analysis failed: ${(e as Error).message}`);
      }
    }
  );

  server.registerTool(
    'get_provenance',
    {
      description:
        'Read the linked source documents, recorded spans, and tracing progress for a feature. Returns the untraced elements (those still missing a span) so you know what to record before finalizing. `sources` lists the linked documents (metadata only; use get_source for content).',
      inputSchema: { featureId: z.string() }
    },
    async ({ featureId }) => {
      try {
        const fid = asFeatureId(await expandFeatureId(repo, featureId));
        const feature = await repo.get(fid);
        if (!feature) return errorText(`Feature ${String(fid)} not found`);

        const elements = enumerateFeatureElements(feature);
        const prov = await provenanceRepo.get(fid);
        const spannedIds = new Set((prov?.spans ?? []).map((s) => s.elementId));
        const untraced = elements
          .filter((e) => !spannedIds.has(e.id))
          .slice(0, 100)
          .map((e) => ({ id: e.id, type: e.type, label: e.label }));

        const sources = [];
        for (const id of prov?.sourceIds ?? []) {
          const source = await sourceRepo.find(id);
          if (source) sources.push({ ...toSourceMeta(source), authority: effectiveAuthority(source) });
        }

        return text({
          featureId: String(fid),
          // Legacy embedded document (pre source-store sidecars only).
          file: prov?.file
            ? {
                fileName: prov.file.fileName,
                byteLength: prov.file.byteLength,
                contentHash: prov.file.contentHash
              }
            : null,
          sources,
          finalized: prov?.finalized ?? false,
          elementCount: elements.length,
          spanCount: prov?.spans.length ?? 0,
          untracedCount: elements.length - spannedIds.size,
          untraced,
          spans: (prov?.spans ?? []).map((s) => ({
            elementId: s.elementId,
            elementType: s.elementType,
            ...(s.sourceId ? { sourceId: s.sourceId } : {}),
            startLine: s.startLine,
            endLine: s.endLine
          })),
          openConflictCount: openConflicts(prov?.conflicts ?? []).length,
          conflicts: (prov?.conflicts ?? []).map((c) => ({
            id: c.id,
            summary: c.summary,
            status: c.status,
            claims: c.claims,
            affectedElements: c.affectedElements,
            ...(c.resolution !== undefined ? { resolution: c.resolution } : {}),
            ...(c.resolvedInFavorOf !== undefined ? { resolvedInFavorOf: c.resolvedInFavorOf } : {})
          })),
          candidateCount: prov?.candidates.length ?? 0,
          unreviewedCandidateCount: (prov?.candidates ?? []).filter(
            (c) => c.disposition === 'unreviewed'
          ).length,
          candidates: (prov?.candidates ?? []).map((c) => ({
            id: c.id,
            proposedKind: c.proposedKind,
            summary: c.summary,
            disposition: c.disposition,
            sourceId: c.span.sourceId,
            startLine: c.span.startLine,
            endLine: c.span.endLine,
            ...(c.elementId !== undefined ? { elementId: c.elementId } : {})
          }))
        });
      } catch (e) {
        return errorText(`get_provenance failed: ${(e as Error).message}`);
      }
    }
  );

  server.registerTool(
    'list_sources',
    {
      description:
        "List the source documents stored in a project's sources/ folder (pasted in the dashboard or attached by an agent): id, name, kind, size, content hash, date. Use get_source to read one. This is how you find the text the user pasted for analysis.",
      inputSchema: { projectId: z.string() }
    },
    async ({ projectId }) => {
      try {
        const pid = await expandProjectId(projectRepo, projectId);
        const sources = await sourceRepo.listForProject(pid);
        return text({
          projectId: pid,
          count: sources.length,
          sources: sources.map((s) => ({
            ...toSourceMeta(s),
            authority: effectiveAuthority(s)
          }))
        });
      } catch (e) {
        return errorText(`list_sources failed: ${(e as Error).message}`);
      }
    }
  );

  server.registerTool(
    'get_source',
    {
      description:
        'Read one stored source document. Returns a slice of the content (default first 100k chars) plus totalChars; page with offset/maxChars when the document is bigger. Character offsets in record_element_span index into this exact content.',
      inputSchema: {
        sourceId: z.string().min(1),
        offset: z.number().int().nonnegative().optional(),
        maxChars: z.number().int().positive().optional()
      }
    },
    async ({ sourceId, offset, maxChars }) => {
      try {
        const source = await sourceRepo.find(sourceId);
        if (!source) return errorText(`No stored source "${sourceId}". Call list_sources.`);
        const start = Math.min(offset ?? 0, source.content.length);
        const end = Math.min(start + (maxChars ?? DEFAULT_READ_CHARS), source.content.length);
        return text({
          ...toSourceMeta(source),
          authority: effectiveAuthority(source),
          totalChars: source.content.length,
          offset: start,
          endOffset: end,
          truncated: end < source.content.length,
          content: source.content.slice(start, end)
        });
      } catch (e) {
        return errorText(`get_source failed: ${(e as Error).message}`);
      }
    }
  );

  server.registerTool(
    'classify_source',
    {
      description:
        "Rank an already-stored source by setting its `authority` (how much it may settle a disagreement) and/or `artifact` (what kind of artifact it is). Metadata only: the document text, its hash and id are untouched, so spans stay valid. This is how you re-tag a source that was deduped onto (a re-attach keeps the STORED source's classification, not the new call's) or one attached before it was classified. Pass at least one of authority/artifact. Returns the source's effective authority (explicit, else derived from artifact, else 'unknown').",
      inputSchema: {
        sourceId: z.string().min(1),
        authority: sourceAuthoritySchema.optional(),
        artifact: sourceArtifactSchema.optional()
      }
    },
    async ({ sourceId, authority, artifact }) => {
      try {
        if (authority === undefined && artifact === undefined) {
          return errorText('Pass authority and/or artifact to classify the source.');
        }
        const source = await sourceRepo.find(sourceId);
        if (!source) return errorText(`No stored source "${sourceId}". Call list_sources.`);
        const reclassified = classifySource(source, {
          ...(authority !== undefined ? { authority } : {}),
          ...(artifact !== undefined ? { artifact } : {})
        });
        await sourceRepo.save(reclassified);
        return text({
          ok: true,
          ...toSourceMeta(reclassified),
          authority: effectiveAuthority(reclassified)
        });
      } catch (e) {
        return errorText(`classify_source failed: ${(e as Error).message}`);
      }
    }
  );

  server.registerTool(
    'remove_source',
    {
      description:
        'Delete a stored source document from its project folder. Destructive: spans recorded from it keep only their snippet text (the viewer can no longer show the full document). Requires confirm:true.',
      inputSchema: { sourceId: z.string().min(1), confirm: z.boolean() }
    },
    async ({ sourceId, confirm }) => {
      try {
        if (!confirm) {
          return errorText(
            'Confirm removal: spans recorded from this source keep only their snippet once it is gone. Pass confirm:true.'
          );
        }
        const source = await sourceRepo.find(sourceId);
        if (!source) return errorText(`No stored source "${sourceId}". Call list_sources.`);
        await sourceRepo.delete(sourceId);
        return text({ ok: true, sourceId, name: source.name });
      } catch (e) {
        return errorText(`remove_source failed: ${(e as Error).message}`);
      }
    }
  );

  server.registerTool(
    'flag_conflict',
    {
      description:
        "Record that two or more linked sources DISAGREE about the same behavior (code vs docs, a test vs the implementation, two specs), instead of silently modeling whichever you read last. Each claim is one source's position in plain language; pass at least two claims from distinct sources, and optionally the ids of the model elements the disagreement bears on (full id or unique prefix). The conflict starts `open` — a hole in the analysis's completeness, distinct from an untraced element. The ack returns a suggested resolution derived from source authority: when one claim's source outranks the rest it is named as the winner; when the top authority is tied it is flagged ambiguous for a human to settle. Resolve it later with resolve_conflict.",
      inputSchema: {
        featureId: z.string(),
        summary: z.string().min(1),
        claims: z
          .array(
            z.object({
              sourceId: z.string().min(1),
              statement: z.string().min(1)
            })
          )
          .min(2),
        affectedElements: z.array(z.string().min(1)).optional()
      }
    },
    async ({ featureId, summary, claims, affectedElements }) => {
      try {
        const fid = asFeatureId(await expandFeatureId(repo, featureId));
        const feature = await repo.get(fid);
        if (!feature) return errorText(`Feature ${String(fid)} not found`);

        // Each claim must name a source that exists; collect its effective
        // authority so the ack can suggest a winner.
        const authorityBySource = new Map<string, SourceAuthority>();
        for (const c of claims) {
          const src = await sourceRepo.find(c.sourceId);
          if (!src) return errorText(`No stored source "${c.sourceId}". Call list_sources.`);
          authorityBySource.set(c.sourceId, effectiveAuthority(src));
        }

        // Resolve affected element ids (full or unique prefix) to canonical ids.
        const elements = enumerateFeatureElements(feature);
        const resolvedElements: string[] = [];
        for (const raw of affectedElements ?? []) {
          const match = matchElement(elements, raw);
          if ('error' in match) return errorText(match.error);
          resolvedElements.push(match.el.id);
        }

        const current = (await provenanceRepo.get(fid)) ?? emptyProvenance(fid, clock());
        const result = addConflict(current.conflicts, {
          id: ids(),
          summary,
          claims,
          affectedElements: resolvedElements,
          at: clock()
        });
        if (!result.ok) return errorText(result.reason);
        await provenanceRepo.save({
          ...current,
          conflicts: result.conflicts,
          updatedAt: clock()
        });

        const suggestion = suggestConflictWinner(
          result.conflict.claims,
          (id) => authorityBySource.get(id) ?? 'unknown'
        );
        return text({
          ok: true,
          featureId: String(fid),
          conflictId: result.conflict.id,
          status: result.conflict.status,
          openConflictCount: openConflicts(result.conflicts).length,
          suggestedResolution: suggestion,
          ...(suggestion.kind === 'ambiguous'
            ? {
                hint: 'Authority cannot break this tie (the top sources rank equally); resolve manually or accept the ambiguity.'
              }
            : {
                hint: `Higher-authority source ${suggestion.sourceId} (${suggestion.authority}) is the suggested winner; confirm with resolve_conflict.`
              })
        });
      } catch (e) {
        return errorText(`flag_conflict failed: ${(e as Error).message}`);
      }
    }
  );

  server.registerTool(
    'resolve_conflict',
    {
      description:
        "Settle a conflict flagged with flag_conflict. `resolved` means one reading won (say which in `resolution`, and name the winning source in `resolvedInFavorOf` when it was authority-based); `accepted_ambiguity` means the disagreement is real and left open on purpose (say why in `resolution`). Either way a written resolution is required, so a closed conflict always records the reasoning. Resolving takes a conflict off the analysis's open-conflict count.",
      inputSchema: {
        featureId: z.string(),
        conflictId: z.string().min(1),
        status: z.enum(['resolved', 'accepted_ambiguity']),
        resolution: z.string().min(1),
        resolvedInFavorOf: z.string().optional()
      }
    },
    async ({ featureId, conflictId, status, resolution, resolvedInFavorOf }) => {
      try {
        const fid = asFeatureId(await expandFeatureId(repo, featureId));
        const current = await provenanceRepo.get(fid);
        if (!current || current.conflicts.length === 0) {
          return errorText(`No conflicts recorded for feature ${String(fid)}.`);
        }
        const result = resolveConflict(current.conflicts, {
          id: conflictId,
          status,
          resolution,
          ...(resolvedInFavorOf !== undefined ? { resolvedInFavorOf } : {}),
          at: clock()
        });
        if (!result.ok) return errorText(result.reason);
        await provenanceRepo.save({
          ...current,
          conflicts: result.conflicts,
          updatedAt: clock()
        });
        return text({
          ok: true,
          featureId: String(fid),
          conflictId: result.conflict.id,
          status: result.conflict.status,
          openConflictCount: openConflicts(result.conflicts).length
        });
      } catch (e) {
        return errorText(`resolve_conflict failed: ${(e as Error).message}`);
      }
    }
  );

  server.registerTool(
    'stage_candidate',
    {
      description:
        "Stage one behavior you read from a source BEFORE committing it to the model, so a reviewed behavior is distinguishable from an unreviewed guess and nothing a source describes goes silently unaccounted. This is the dual of record_element_span: a span points from a modeled element back to its source; a candidate points from a source range forward to a proposed behavior. Give the source range, the element type it would become (`proposedKind`), a plain-language `summary`, and an optional `confidence` (0..1). It starts `unreviewed`; move it to accepted / rejected / merged / out_of_scope / conflict with dispose_candidate. Feeds source coverage (get_source_coverage): the share of a source's behavior that actually reached the model.",
      inputSchema: {
        featureId: z.string(),
        sourceId: z.string().min(1),
        startOffset: z.number().int().nonnegative(),
        endOffset: z.number().int().positive(),
        proposedKind: proposedKindSchema,
        summary: z.string().min(1),
        confidence: z.number().min(0).max(1).optional(),
        disposition: candidateDispositionSchema.optional()
      }
    },
    async ({
      featureId,
      sourceId,
      startOffset,
      endOffset,
      proposedKind,
      summary,
      confidence,
      disposition
    }) => {
      try {
        const fid = asFeatureId(await expandFeatureId(repo, featureId));
        const feature = await repo.get(fid);
        if (!feature) return errorText(`Feature ${String(fid)} not found`);
        const src = await sourceRepo.find(sourceId);
        if (!src) return errorText(`No stored source "${sourceId}". Call list_sources.`);

        const current = (await provenanceRepo.get(fid)) ?? emptyProvenance(fid, clock());
        const result = stageCandidate(current.candidates, {
          id: ids(),
          sourceId,
          sourceContent: src.content,
          proposedKind,
          summary,
          ...(confidence !== undefined ? { confidence } : {}),
          startOffset,
          endOffset,
          ...(disposition ? { disposition } : {}),
          at: clock()
        });
        if (!result.ok) return errorText(result.reason);
        await provenanceRepo.save({
          ...current,
          candidates: result.candidates,
          updatedAt: clock()
        });
        return text({
          ok: true,
          featureId: String(fid),
          candidateId: result.candidate.id,
          disposition: result.candidate.disposition,
          startLine: result.candidate.span.startLine,
          endLine: result.candidate.span.endLine,
          candidateCount: result.candidates.length,
          unreviewedCount: countUnreviewed(result.candidates)
        });
      } catch (e) {
        return errorText(`stage_candidate failed: ${(e as Error).message}`);
      }
    }
  );

  server.registerTool(
    'stage_candidates',
    {
      description:
        'Batch form of stage_candidate: stage MANY behaviors read from one or more sources in a single call (one load, one save), so "account for every source span" is affordable at adoption scale. Each item: { sourceId?, startOffset, endOffset, proposedKind, summary, confidence?, disposition? }. A call-level sourceId is the default for items that omit their own. Items are applied in order; a failing item is reported in `results` with its reason and does NOT abort the rest. Nothing is persisted when every item fails.',
      inputSchema: {
        featureId: z.string(),
        sourceId: z.string().optional(),
        candidates: z
          .array(
            z.object({
              sourceId: z.string().optional(),
              startOffset: z.number().int().nonnegative(),
              endOffset: z.number().int().positive(),
              proposedKind: proposedKindSchema,
              summary: z.string().min(1),
              confidence: z.number().min(0).max(1).optional(),
              disposition: candidateDispositionSchema.optional()
            })
          )
          .min(1)
      }
    },
    async ({ featureId, sourceId, candidates }) => {
      try {
        const fid = asFeatureId(await expandFeatureId(repo, featureId));
        const feature = await repo.get(fid);
        if (!feature) return errorText(`Feature ${String(fid)} not found`);

        let current = (await provenanceRepo.get(fid)) ?? emptyProvenance(fid, clock());
        const contentCache = new Map<string, string | null>();
        const loadContent = async (id: string): Promise<string | null> => {
          if (contentCache.has(id)) return contentCache.get(id) ?? null;
          const found = await sourceRepo.find(id);
          const content = found ? found.content : null;
          contentCache.set(id, content);
          return content;
        };

        const results: Array<Record<string, unknown>> = [];
        let staged = 0;
        for (const item of candidates) {
          const wanted = item.sourceId ?? sourceId;
          if (!wanted) {
            results.push({ ok: false, error: 'No sourceId on the item or the call.', summary: item.summary });
            continue;
          }
          const content = await loadContent(wanted);
          if (content === null) {
            results.push({ ok: false, error: `No stored source "${wanted}".`, summary: item.summary });
            continue;
          }
          const result = stageCandidate(current.candidates, {
            id: ids(),
            sourceId: wanted,
            sourceContent: content,
            proposedKind: item.proposedKind,
            summary: item.summary,
            ...(item.confidence !== undefined ? { confidence: item.confidence } : {}),
            startOffset: item.startOffset,
            endOffset: item.endOffset,
            ...(item.disposition ? { disposition: item.disposition } : {}),
            at: clock()
          });
          if (!result.ok) {
            results.push({ ok: false, error: result.reason, summary: item.summary });
            continue;
          }
          current = { ...current, candidates: result.candidates };
          staged += 1;
          results.push({ ok: true, candidateId: result.candidate.id, proposedKind: item.proposedKind });
        }

        if (staged > 0) await provenanceRepo.save({ ...current, updatedAt: clock() });

        const failed = results.filter((r) => r.ok !== true).length;
        return text({
          ok: failed === 0,
          featureId: String(fid),
          staged,
          failed,
          results,
          candidateCount: current.candidates.length,
          unreviewedCount: countUnreviewed(current.candidates)
        });
      } catch (e) {
        return errorText(`stage_candidates failed: ${(e as Error).message}`);
      }
    }
  );

  server.registerTool(
    'dispose_candidate',
    {
      description:
        "Review a staged candidate: move it from `unreviewed` to a decision. `accepted` (it reached the model) and `merged` (it folded into another element, a duplicate) MUST name the modeled `elementId` they map to (full id or unique prefix), so acceptance is traceable to a real element; `rejected` / `out_of_scope` exclude it; `conflict` marks it tied up in an open disagreement. A `rationale` narrates the decision. This is what turns a source's staged behaviors into an honest coverage picture.",
      inputSchema: {
        featureId: z.string(),
        candidateId: z.string().min(1),
        disposition: candidateDispositionSchema,
        rationale: z.string().optional(),
        elementId: z.string().optional()
      }
    },
    async ({ featureId, candidateId, disposition, rationale, elementId }) => {
      try {
        const fid = asFeatureId(await expandFeatureId(repo, featureId));
        const feature = await repo.get(fid);
        if (!feature) return errorText(`Feature ${String(fid)} not found`);
        const current = await provenanceRepo.get(fid);
        if (!current || current.candidates.length === 0) {
          return errorText(`No candidates staged for feature ${String(fid)}.`);
        }

        // accepted/merged link to a modeled element: resolve it to a canonical id.
        let resolvedElementId = elementId;
        if ((disposition === 'accepted' || disposition === 'merged') && elementId !== undefined) {
          const match = matchElement(enumerateFeatureElements(feature), elementId);
          if ('error' in match) return errorText(match.error);
          resolvedElementId = match.el.id;
        }

        const result = disposeCandidate(current.candidates, {
          id: candidateId,
          disposition,
          ...(rationale !== undefined ? { rationale } : {}),
          ...(resolvedElementId !== undefined ? { elementId: resolvedElementId } : {}),
          at: clock()
        });
        if (!result.ok) return errorText(result.reason);
        await provenanceRepo.save({
          ...current,
          candidates: result.candidates,
          updatedAt: clock()
        });
        return text({
          ok: true,
          featureId: String(fid),
          candidateId: result.candidate.id,
          disposition: result.candidate.disposition,
          ...(result.candidate.elementId !== undefined
            ? { elementId: result.candidate.elementId }
            : {}),
          unreviewedCount: countUnreviewed(result.candidates)
        });
      } catch (e) {
        return errorText(`dispose_candidate failed: ${(e as Error).message}`);
      }
    }
  );

  server.registerTool(
    'get_source_coverage',
    {
      description:
        "Bidirectional source coverage: the reverse of the finalize gate. Finalize asks whether every MODEL element traces to a source; this asks whether every staged SOURCE behavior has a disposition, and reports the share of each source's behavior that reached the model (`modeled`), was already there (`duplicate`), was deliberately left out (`excluded`), or is still undecided (`unresolved`). The unresolved share is the answer to \"what might we be missing?\". Requires candidates staged with stage_candidate; a source with none has nothing to account for. Pass `sourceId` to scope to one source. Returns the still-unresolved candidates so you know exactly what to review.",
      inputSchema: {
        featureId: z.string(),
        sourceId: z.string().optional()
      }
    },
    async ({ featureId, sourceId }) => {
      try {
        const fid = asFeatureId(await expandFeatureId(repo, featureId));
        const feature = await repo.get(fid);
        if (!feature) return errorText(`Feature ${String(fid)} not found`);

        const prov = await provenanceRepo.get(fid);
        const candidates = (prov?.candidates ?? []).filter(
          (c) => sourceId === undefined || c.span.sourceId === sourceId
        );
        if (candidates.length === 0) {
          return text({
            ok: true,
            featureId: String(fid),
            candidateCount: 0,
            sources: [],
            hint: 'No candidates staged for this scope; stage_candidate to account for a source’s behavior.'
          });
        }

        const perSource = coverageForCandidates(candidates);
        const nameById = new Map<string, string>();
        for (const cov of perSource) {
          const src = await sourceRepo.find(cov.sourceId);
          if (src) nameById.set(cov.sourceId, src.name);
        }

        const unresolved = candidates
          .filter((c) => c.disposition === 'unreviewed' || c.disposition === 'conflict')
          .slice(0, 50)
          .map((c) => ({
            id: c.id,
            summary: c.summary,
            proposedKind: c.proposedKind,
            disposition: c.disposition,
            sourceId: c.span.sourceId,
            startLine: c.span.startLine
          }));

        return text({
          ok: true,
          featureId: String(fid),
          candidateCount: candidates.length,
          overall: rollUpCoverage(perSource),
          sources: perSource.map((cov) => ({
            ...cov,
            ...(nameById.has(cov.sourceId) ? { name: nameById.get(cov.sourceId) } : {})
          })),
          unresolved
        });
      } catch (e) {
        return errorText(`get_source_coverage failed: ${(e as Error).message}`);
      }
    }
  );
};
