import { z } from 'zod';
import { asFeatureId } from '../../src/features/behavior-model/domain/value-objects/ids';
import {
  attachSourceFile,
  emptyProvenance,
  finalizeProvenance,
  recordSpan
} from '../../src/features/source-provenance/domain/Provenance';
import {
  enumerateFeatureElements,
  type FeatureElement
} from '../../src/features/source-provenance/domain/FeatureElements';
import { errorText, text, type ToolDeps } from './_shared';
import { expandFeatureId } from './short-ids';

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

/**
 * Source Provenance tools (feature 39e57ee0). They let an AI agent store the
 * file it analyzed and stamp each extracted element with the span it came from,
 * so the dashboard can show the file with every rule/action highlighted at its
 * source. The guard logic lives in the pure domain helpers; these tools only
 * load the feature, resolve ids, call the helper, and persist the sidecar.
 */
export const registerProvenanceTools = (deps: ToolDeps): void => {
  const { server, repo, provenanceRepo, clock, ids } = deps;

  server.registerTool(
    'attach_source_file',
    {
      description:
        'Store the local file you analyzed alongside a feature, so extracted elements can point back into it. Call this first, before record_element_span. One file per analysis: a second attach is blocked until the analysis is reset. Blocked if the analysis is already finalized or the content exceeds the storage cap (default 1 MiB).',
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
        const result = attachSourceFile(current, {
          id: ids(),
          fileName,
          content,
          attachedAt: clock(),
          ...(maxBytes !== undefined ? { maxBytes } : {})
        });
        if (!result.ok) return errorText(result.reason);
        await provenanceRepo.save(result.provenance);

        const file = result.provenance.file!;
        return text({
          ok: true,
          featureId: String(fid),
          fileName: file.fileName,
          byteLength: file.byteLength,
          contentHash: file.contentHash,
          elementCount: enumerateFeatureElements(feature).length,
          spanCount: result.provenance.spans.length
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
        'Stamp one extracted element (surface/action/rule/invariant/transition/state/event/entity) with the exact span of the stored file it was derived from. `startOffset`/`endOffset` are character offsets into the stored content (end exclusive). The element type is resolved from the feature, so pass only its id (full or unique prefix). Blocked if no file is stored, the analysis is finalized, the span is empty/inverted, the span runs past the file, or the element already has a span.',
      inputSchema: {
        featureId: z.string(),
        elementId: z.string().min(1),
        startOffset: z.number().int().nonnegative(),
        endOffset: z.number().int().positive()
      }
    },
    async ({ featureId, elementId, startOffset, endOffset }) => {
      try {
        const fid = asFeatureId(await expandFeatureId(repo, featureId));
        const feature = await repo.get(fid);
        if (!feature) return errorText(`Feature ${String(fid)} not found`);

        const elements = enumerateFeatureElements(feature);
        const match = matchElement(elements, elementId);
        if ('error' in match) return errorText(match.error);

        const current = (await provenanceRepo.get(fid)) ?? emptyProvenance(fid, clock());
        const result = recordSpan(current, {
          id: ids(),
          elementId: match.el.id,
          elementType: match.el.type,
          startOffset,
          endOffset,
          recordedAt: clock()
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
        'Lock the provenance analysis once every extracted element has a recorded span. Blocked if no file is stored, the analysis is already finalized, or any element is still untraced (call get_provenance to see which).',
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
    'get_provenance',
    {
      description:
        'Read the stored source file, recorded spans, and tracing progress for a feature. Returns the untraced elements (those still missing a span) so you know what to record before finalizing. Returns null file when nothing has been attached yet.',
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

        return text({
          featureId: String(fid),
          file: prov?.file
            ? {
                fileName: prov.file.fileName,
                byteLength: prov.file.byteLength,
                contentHash: prov.file.contentHash
              }
            : null,
          finalized: prov?.finalized ?? false,
          elementCount: elements.length,
          spanCount: prov?.spans.length ?? 0,
          untracedCount: elements.length - spannedIds.size,
          untraced,
          spans: (prov?.spans ?? []).map((s) => ({
            elementId: s.elementId,
            elementType: s.elementType,
            startLine: s.startLine,
            endLine: s.endLine
          }))
        });
      } catch (e) {
        return errorText(`get_provenance failed: ${(e as Error).message}`);
      }
    }
  );
};
