import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { type BehavioralIndex } from '../repo-link';
import { errorText, text, type ToolDeps } from './_shared';
import { asFeatureId } from '../../src/features/behavior-model/domain/value-objects/ids';
import { expandFeatureId } from './short-ids';

const readCurrentLink = (linkPath: string) => {
  try {
    return JSON.parse(readFileSync(linkPath, 'utf8'));
  } catch {
    throw new Error(`Could not read ${linkPath}`);
  }
};

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
        'Returns entries from the behavioral index in .unspa.json. The index maps every spec entity (action, surface, state, rule, event, transition, invariant, surface_rule, surface_invariant) to its resolved file + line + signature in the codebase. Defaults to a paginated slice of entries plus stats so the response never exceeds an LLM-friendly size; pass filters to narrow scope. Filter params: `key` (exact match, e.g. "action:abc-123"); `entityTypes` (subset of [action, surface, state, rule, event, transition, invariant, surface_rule, surface_invariant]); `status` (implemented | partial | missing). Pagination: `offset` + `limit` (default 50, max 200). Set `statsOnly: true` to return just the implemented/partial/missing tallies.',
      inputSchema: {
        key: z.string().optional(),
        entityTypes: z.array(z.string()).optional(),
        status: z.enum(['implemented', 'partial', 'missing']).optional(),
        offset: z.number().int().nonnegative().optional(),
        limit: z.number().int().positive().max(HARD_INDEX_CAP).optional(),
        statsOnly: z.boolean().optional()
      }
    },
    async ({ key, entityTypes, status, offset, limit, statsOnly }) => {
      if (!repoContext?.linkPath) {
        return errorText(
          'No .unspa.json found. The human must create it (via `unspa link`) to bind this folder to a project.'
        );
      }
      const link = readCurrentLink(repoContext.linkPath);
      const index: BehavioralIndex = link.index ?? {};
      const stats = indexStats(index);

      // Exact key lookup short-circuits filters + pagination.
      if (key) {
        const entry = index[key];
        return text({
          projectId: link.projectId,
          stats,
          key,
          entry: entry ?? null
        });
      }

      if (statsOnly) {
        return text({ projectId: link.projectId, stats });
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
        projectId: link.projectId,
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
        'Cross-references the behavioral index (.unspa.json) against the feature spec to show which entities are missing from the index, which are partial, and which are fully implemented. Use after get_behavioral_index to know exactly what still needs to be located in the codebase.',
      inputSchema: { featureId: z.string() }
    },
    async ({ featureId }) => {
      if (!repoContext?.linkPath) {
        return errorText('No .unspa.json found. Cannot compute implementation gaps.');
      }
      try {
        featureId = await expandFeatureId(repo, featureId);
      } catch (e) {
        return errorText((e as Error).message);
      }
      const exp = await repo.get(asFeatureId(featureId));
      if (!exp) return errorText(`Feature ${featureId} not found`);

      const link = readCurrentLink(repoContext.linkPath);
      const index: BehavioralIndex = link.index ?? {};

      type EntityRef = { key: string; type: string; name: string };
      const all: EntityRef[] = [];

      for (const surface of exp.surfaces) {
        all.push({ key: `surface:${surface.id}`, type: 'surface', name: surface.name });
        for (const cap of surface.actions) {
          all.push({ key: `action:${cap.id}`, type: 'action', name: cap.name });
        }
        for (const state of surface.stateDefinitions) {
          all.push({ key: `state:${state.path}`, type: 'state', name: String(state.path) });
        }
      }
      for (const event of exp.events ?? []) {
        all.push({ key: `event:${event.name}`, type: 'event', name: String(event.name) });
      }

      const missing = all.filter((e) => !(e.key in index));
      const partial = all.filter((e) => index[e.key]?.status === 'partial');
      const implemented = all.filter((e) => index[e.key]?.status === 'implemented');

      return text({
        stats: { total: all.length, implemented: implemented.length, partial: partial.length, missing: missing.length },
        missing,
        partial,
        implemented
      });
    }
  );
};
