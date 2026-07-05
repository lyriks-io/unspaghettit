import { z } from 'zod';
import { asFeatureId } from '../../src/features/behavior-model/domain/value-objects/ids';
import {
  emptyProvenance,
  finalizeProvenance,
  linkSource,
  recordSpan
} from '../../src/features/source-provenance/domain/Provenance';
import {
  createProjectSource,
  toSourceMeta
} from '../../src/features/source-provenance/domain/ProjectSource';
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
  const { server, repo, projectRepo, provenanceRepo, sourceRepo, clock, ids } = deps;

  server.registerTool(
    'attach_source_file',
    {
      description:
        "Store the document you analyzed as a project-level source (in the owning project's sources/ folder) and link it to this feature's analysis. Identical content is deduplicated: re-attaching the same text links the existing source instead of storing a copy. Prefer pulling a source the user already pasted in the dashboard (list_sources + get_source) over pushing content here. Blocked if the analysis is finalized or the content exceeds the storage cap (default 1 MiB).",
      inputSchema: {
        featureId: z.string(),
        fileName: z.string().min(1),
        content: z.string(),
        maxBytes: z.number().int().positive().optional()
      }
    },
    async ({ featureId, fileName, content, maxBytes }) => {
      try {
        const fid = asFeatureId(await expandFeatureId(repo, featureId));
        const feature = await repo.get(fid);
        if (!feature) return errorText(`Feature ${String(fid)} not found`);

        const current = (await provenanceRepo.get(fid)) ?? emptyProvenance(fid, clock());
        if (current.finalized) {
          return errorText(
            'This analysis is finalized; reset_analysis before attaching another source.'
          );
        }

        const projectId = await findOwningProjectId(projectRepo, String(fid));
        const existing = await sourceRepo.listForProject(projectId);
        const created = createProjectSource(
          {
            id: ids(),
            projectId,
            name: fileName,
            kind: 'file',
            content,
            attachedAt: clock(),
            ...(maxBytes !== undefined ? { maxBytes } : {})
          },
          existing
        );
        if (!created.ok) return errorText(created.reason);
        if (!created.deduped) await sourceRepo.save(created.source);

        const linked = linkSource(current, created.source.id, clock());
        if (!linked.ok) return errorText(linked.reason);
        await provenanceRepo.save(linked.provenance);

        return text({
          ok: true,
          featureId: String(fid),
          sourceId: created.source.id,
          fileName: created.source.name,
          byteLength: created.source.byteLength,
          contentHash: created.source.contentHash,
          deduped: created.deduped,
          elementCount: enumerateFeatureElements(feature).length,
          spanCount: linked.provenance.spans.length
        });
      } catch (e) {
        return errorText(`attach_source_file failed: ${(e as Error).message}`);
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
          if (source) sources.push(toSourceMeta(source));
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
          sources: sources.map(toSourceMeta)
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
