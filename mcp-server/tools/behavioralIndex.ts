import { z } from 'zod';
import { type BehavioralIndex } from '../repo-link';
import { errorText, text, type ToolDeps } from './_shared';
import { inlineIndexSchema, isIndexSourceError, resolveIndexSource } from './_index-source';
import { asFeatureId } from '../../src/features/behavior-model/domain/value-objects/ids';
import { expandFeatureId } from './short-ids';

const indexStats = (index: BehavioralIndex) => {
  const entries = Object.values(index);
  return {
    total: entries.length,
    implemented: entries.filter((e) => e.status === 'implemented').length,
    partial: entries.filter((e) => e.status === 'partial').length,
    missing: entries.filter((e) => e.status === 'missing').length
  };
};

export { indexStats };

export const registerBehavioralIndexTools = ({ server, repo, repoContext }: ToolDeps): void => {
  const DEFAULT_INDEX_LIMIT = 50;
  const HARD_INDEX_CAP = 200;

  server.registerTool(
    'get_behavioral_index',
    {
      description:
        'Returns entries from the behavioral index. The index maps every spec entity (action, surface, state, rule, event, transition, invariant, surface_rule, surface_invariant, entity) to its resolved file + line + signature in the codebase. Read from .unspa.json by default; pass `index` + `projectId` to query an index the caller holds instead (for hosts that run this server without access to the checkout). Defaults to a paginated slice of entries plus stats so the response never exceeds an LLM-friendly size; pass filters to narrow scope. Filter params: `key` (exact match, e.g. "action:abc-123"); `entityTypes` (subset of [action, surface, state, rule, event, transition, invariant, surface_rule, surface_invariant]); `status` (implemented | partial | missing). Pagination: `offset` + `limit` (default 50, max 200). Set `statsOnly: true` to return just the implemented/partial/missing tallies.',
      inputSchema: {
        key: z.string().optional(),
        entityTypes: z.array(z.string()).optional(),
        status: z.enum(['implemented', 'partial', 'missing']).optional(),
        offset: z.number().int().nonnegative().optional(),
        limit: z.number().int().positive().max(HARD_INDEX_CAP).optional(),
        statsOnly: z.boolean().optional(),
        ...inlineIndexSchema
      }
    },
    async ({ key, entityTypes, status, offset, limit, statsOnly, index: inlineIndex, projectId }) => {
      const source = resolveIndexSource(repoContext, { index: inlineIndex, projectId });
      if (isIndexSourceError(source)) return errorText(source.error);
      const index = source.index;
      const stats = indexStats(index);

      // Exact key lookup short-circuits filters + pagination.
      if (key) {
        const entry = index[key];
        return text({
          projectId: source.projectId,
          stats,
          key,
          entry: entry ?? null
        });
      }

      if (statsOnly) {
        return text({ projectId: source.projectId, stats });
      }

      const typeSet = entityTypes && entityTypes.length > 0 ? new Set(entityTypes) : null;
      const entries = Object.entries(index).filter(([entryKey, entry]) => {
        if (status && entry.status !== status) return false;
        if (typeSet) {
          const colonIdx = entryKey.indexOf(':');
          const t = colonIdx >= 0 ? entryKey.slice(0, colonIdx) : entryKey;
          if (!typeSet.has(t)) return false;
        }
        return true;
      });

      const off = offset ?? 0;
      const lim = Math.min(limit ?? DEFAULT_INDEX_LIMIT, HARD_INDEX_CAP);
      const page = entries.slice(off, off + lim);
      const nextOffset = off + page.length < entries.length ? off + page.length : undefined;

      return text({
        projectId: source.projectId,
        stats,
        filteredCount: entries.length,
        offset: off,
        limit: lim,
        nextOffset,
        truncated: nextOffset !== undefined,
        entries: Object.fromEntries(page)
      });
    }
  );

  server.registerTool(
    'get_implementation_gaps',
    {
      description:
        'Cross-references the behavioral index against the feature spec to show which entities are missing from the index, which are partial, and which are fully implemented. Read from .unspa.json by default; pass `index` + `projectId` to cross-reference an index the caller holds instead. Use after get_behavioral_index to know exactly what still needs to be located in the codebase. Each entry carries both the `key` used in .unspa.json (e.g. `state:cart.itemCount`) and the canonical `entityId` accepted by report_implementation_status — for states that\'s the 8-char hex id, distinct from the path. The response includes a `hints[]` block pointing at follow-up tools relevant to what was returned.',
      inputSchema: { featureId: z.string(), ...inlineIndexSchema }
    },
    async ({ featureId, index: inlineIndex, projectId }) => {
      const source = resolveIndexSource(repoContext, { index: inlineIndex, projectId });
      if (isIndexSourceError(source)) return errorText(source.error);
      try {
        featureId = await expandFeatureId(repo, featureId);
      } catch (e) {
        return errorText((e as Error).message);
      }
      const exp = await repo.get(asFeatureId(featureId));
      if (!exp) return errorText(`Feature ${featureId} not found`);

      const index = source.index;

      type EntityRef = {
        key: string;
        type: string;
        name: string;
        /**
         * Canonical id for the report_implementation_status entityId field.
         * For most types this is the same as the suffix of `key`; for states
         * it's the hex id (distinct from the path-shaped key).
         */
        entityId: string;
      };
      const all: EntityRef[] = [];

      for (const surface of exp.surfaces) {
        all.push({
          key: `surface:${surface.id}`,
          type: 'surface',
          name: surface.name,
          entityId: String(surface.id)
        });
        for (const cap of surface.actions) {
          all.push({
            key: `action:${cap.id}`,
            type: 'action',
            name: cap.name,
            entityId: String(cap.id)
          });
        }
        for (const state of surface.stateDefinitions) {
          all.push({
            key: `state:${state.path}`,
            type: 'state',
            name: String(state.path),
            entityId: String(state.id)
          });
        }
      }
      for (const event of exp.events ?? []) {
        all.push({
          key: `event:${event.name}`,
          type: 'event',
          name: String(event.name),
          entityId: String(event.name)
        });
      }

      const missing = all.filter((e) => !(e.key in index));
      const partial = all.filter((e) => index[e.key]?.status === 'partial');
      const implemented = all.filter((e) => index[e.key]?.status === 'implemented');

      const hints: string[] = [];
      if (missing.length > 0 || partial.length > 0) {
        hints.push(
          'Use `get_neighborhood({ featureId, entityKey })` to see the rules / invariants / events / transitions related to a missing entity — useful for batching co-located implementation work.'
        );
      }
      if (missing.some((e) => e.type === 'state')) {
        hints.push(
          'For state entities, `report_implementation_status` accepts EITHER the path (e.g. `cart.itemCount`) or the hex id in the `entityId` field. Both work.'
        );
      }

      return text({
        stats: { total: all.length, implemented: implemented.length, partial: partial.length, missing: missing.length },
        missing,
        partial,
        implemented,
        hints
      });
    }
  );
};
