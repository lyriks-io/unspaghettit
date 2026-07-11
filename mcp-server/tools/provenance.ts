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
  emptyProvenance,
  finalizeProvenance,
  linkSource,
  recordSpan
} from '../../src/features/source-provenance/domain/Provenance';
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

        return text({
          ok: true,
          featureId: String(fid),
          finalized: true,
          elementCount,
          spanCount: result.provenance.spans.length
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
        "Turn a codebase-adoption analysis into implementation coverage: every span recorded against a kind:'code' source becomes a .unspa.json behavioral-index entry ({file, line, signature}, status implemented, specVersion stamped so drift detection starts armed). This is the code-to-spec bridge: one analysis pass yields the model, its provenance, AND the spec-to-code mapping. Every traced element is seeded, including entities, feature-level invariants, surface-declared transitions, and declared events; those kinds don't appear in the per-action coverage report but they document the location and arm drift detection. Existing index entries are never overwritten unless overwrite:true. Spans against pasted/file sources are counted but not seeded; only elements that no longer resolve in the feature land in `skipped`, with the reason. Requires the repo to be linked (.unspa.json via `unspa link`). Run sync_from_index afterwards to push the coverage report to the dashboard. Pass dryRun:true to preview without writing.",
      inputSchema: {
        featureId: z.string(),
        overwrite: z.boolean().optional(),
        dryRun: z.boolean().optional()
      }
    },
    async ({ featureId, overwrite, dryRun }) => {
      try {
        if (!repoContext?.linkPath) {
          return errorText(
            'No .unspa.json found. Run `unspa link` first so there is a behavioral index to seed.'
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

        let rawLink: RepoLink;
        try {
          rawLink = JSON.parse(readFileSync(repoContext.linkPath, 'utf8')) as RepoLink;
        } catch {
          return errorText(`Could not read ${repoContext.linkPath}`);
        }

        const repoRoot = dirname(repoContext.linkPath);
        const index: BehavioralIndex = { ...(rawLink.index ?? {}) };
        const written: string[] = [];
        const kept: string[] = [];
        const missingFiles = new Set<string>();
        for (const e of built.entries) {
          if (index[e.key] && overwrite !== true) {
            kept.push(e.key);
            continue;
          }
          if (!existsSync(resolve(repoRoot, e.entry.file))) missingFiles.add(e.entry.file);
          index[e.key] = e.entry;
          written.push(e.key);
        }

        if (dryRun !== true && written.length > 0) {
          writeRepoLink(repoContext.linkPath, { ...rawLink, index });
        }

        return text({
          ok: true,
          featureId: String(fid),
          dryRun: dryRun === true,
          written: written.length,
          writtenKeys: written,
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
};
