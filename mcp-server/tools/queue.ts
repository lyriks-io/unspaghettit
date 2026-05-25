import { readFileSync } from 'node:fs';
import { z } from 'zod';
import {
  asActionId,
  asFeatureId,
  asSurfaceId
} from '../../src/features/behavior-model/domain/value-objects/ids';
import {
  asQueueItemId,
  type QueueItem
} from '../../src/features/implementation-queue/domain/entities/QueueItem';
import {
  ActionNotInFeatureError,
  enqueueQueueItemUseCase,
  FeatureNotInProjectError,
  ProjectNotFoundForQueueError,
  SurfaceNotInFeatureError
} from '../../src/features/implementation-queue/application/use-cases/EnqueueQueueItem';
import { dequeueQueueItemUseCase } from '../../src/features/implementation-queue/application/use-cases/DequeueQueueItem';
import { moveQueueItemUseCase } from '../../src/features/implementation-queue/application/use-cases/MoveQueueItem';
import { listQueueUseCase, type QueueView } from '../../src/features/implementation-queue/application/use-cases/ListQueue';
import { getNextQueuedUseCase } from '../../src/features/implementation-queue/application/use-cases/GetNextQueued';
import { asProjectId } from '../../src/features/projects/domain/value-objects/ids';
import { saveProjectUseCase } from '../../src/features/projects/application/use-cases/SaveProject';
import { cryptoIdGenerator } from '../../src/shared/domain/IdGenerator';
import type { BehavioralIndex, RepoLink } from '../repo-link';
import { errorText, text, type ToolDeps } from './_shared';
import { trackTokens } from '../metrics';
import { expandFeatureId, expandProjectId } from './short-ids';

/**
 * Project resolution order for tools that accept an optional projectId:
 *   1. Caller-supplied projectId wins.
 *   2. Otherwise fall back to the linked project from `.unspa.json` (set
 *      by `unspa link`). This is the common case: the dev runs the MCP
 *      inside a linked repo and just says "implement next" without
 *      specifying which project, because there's only ever one bound.
 *   3. Hard fail when neither is available, with a hint pointing at the
 *      missing piece.
 */
const resolveProjectId = async (
  deps: ToolDeps,
  explicit: string | undefined
): Promise<string> => {
  if (explicit) return await expandProjectId(deps.projectRepo, explicit);
  const linked = deps.repoContext?.link?.projectId;
  if (linked) return linked;
  throw new Error(
    'No projectId provided and no linked project in .unspa.json. Pass projectId explicitly or run `unspa link`.'
  );
};

/**
 * Build the auto-prune predicate from the behavioral index in
 * `.unspa.json`. A queue entry is considered "done" when:
 *   - kind:action  → the matching `action:<id>` index entry exists and
 *                    is `status: 'implemented'`.
 *   - kind:feature → every action under the feature AND every surface
 *                    has an `implemented` index entry. Partial coverage
 *                    keeps the feature on the queue so a half-built
 *                    feature isn't silently skipped.
 *
 * When no `.unspa.json` is reachable, the predicate returns false for
 * everything; the queue degrades gracefully to "nothing is ever done"
 * instead of erroring. The user can still mutate the queue.
 */
const buildDonePredicate = (
  deps: ToolDeps
): ((view: QueueView) => Promise<boolean>) => {
  const linkPath = deps.repoContext?.linkPath;
  if (!linkPath) return async () => false;

  let cached: BehavioralIndex | null | undefined;
  const readIndex = (): BehavioralIndex | null => {
    if (cached !== undefined) return cached;
    try {
      const raw = JSON.parse(readFileSync(linkPath, 'utf8')) as RepoLink;
      cached = raw.index ?? {};
    } catch {
      cached = null;
    }
    return cached;
  };

  return async (view) => {
    const index = readIndex();
    if (!index) return false;
    if (view.item.kind === 'action') {
      const entry = index[`action:${String(view.item.actionId)}`];
      return entry?.status === 'implemented';
    }
    if (view.item.kind === 'surface') {
      // Mirror the action heuristic for consistency: a surface is "done"
      // when its own index entry says so. We do NOT recurse into the
      // surface's children (state, rules, invariants) — that would make
      // the surface flicker between queued and not-queued depending on
      // which child was audited last. Authors who want the stricter
      // semantics queue each action individually.
      const entry = index[`surface:${String(view.item.surfaceId)}`];
      return entry?.status === 'implemented';
    }
    // Feature done = full coverage. Re-read the spec for action/surface ids.
    const feature = await deps.repo.get(view.item.featureId);
    if (!feature) return false;
    for (const surface of feature.surfaces) {
      const surfEntry = index[`surface:${String(surface.id)}`];
      if (surfEntry?.status !== 'implemented') return false;
      for (const action of surface.actions) {
        const actEntry = index[`action:${String(action.id)}`];
        if (actEntry?.status !== 'implemented') return false;
      }
    }
    return true;
  };
};

const queueItemSummary = (view: QueueView) => ({
  id: String(view.item.id),
  kind: view.item.kind,
  featureId: String(view.item.featureId),
  featureName: view.featureName,
  ...(view.item.kind === 'surface'
    ? { surfaceId: String(view.item.surfaceId), surfaceName: view.surfaceName }
    : {}),
  ...(view.item.kind === 'action'
    ? { actionId: String(view.item.actionId), actionName: view.actionName }
    : {}),
  ...(view.item.note ? { note: view.item.note } : {}),
  addedAt: view.item.addedAt,
  orphaned: view.orphaned
});

export const registerQueueTools = (deps: ToolDeps): void => {
  const { server, repo, projectRepo, clock, ids } = deps;
  const saveProject = saveProjectUseCase({ repository: projectRepo, clock });
  void saveProject; // imported for symmetry with other tool modules; use cases below own persistence

  const enqueueItem = enqueueQueueItemUseCase({
    projects: projectRepo,
    features: repo,
    clock,
    ids: ids ?? cryptoIdGenerator
  });
  const dequeueItem = dequeueQueueItemUseCase({ projects: projectRepo, clock });
  const moveItem = moveQueueItemUseCase({ projects: projectRepo, clock });
  const listQueue = listQueueUseCase({ projects: projectRepo, features: repo });
  const getNextQueued = getNextQueuedUseCase({
    projects: projectRepo,
    features: repo
  });

  server.registerTool(
    'enqueue',
    {
      description:
        'Add a Feature, Surface, or Action to a Project\'s "implement next" queue. Idempotent: re-queuing the same target is a no-op (returns the existing entry with alreadyQueued:true). Pass kind:"feature" with featureId, kind:"surface" with featureId+surfaceId, OR kind:"action" with featureId+actionId. Optional `note` lets you stash a one-line hint ("after the auth refactor"). projectId is optional when running inside a linked repo (.unspa.json).',
      inputSchema: {
        projectId: z.string().optional(),
        kind: z.enum(['feature', 'surface', 'action']),
        featureId: z.string(),
        surfaceId: z.string().optional(),
        actionId: z.string().optional(),
        note: z.string().max(280).optional()
      }
    },
    async ({ projectId, kind, featureId, surfaceId, actionId, note }) => {
      try {
        const resolvedProjectId = await resolveProjectId(deps, projectId);
        const resolvedFeatureId = await expandFeatureId(repo, featureId);
        if (kind === 'surface' && !surfaceId) {
          return errorText('enqueue: surfaceId is required when kind="surface"');
        }
        if (kind === 'action' && !actionId) {
          return errorText('enqueue: actionId is required when kind="action"');
        }
        const input =
          kind === 'feature'
            ? {
                kind: 'feature' as const,
                featureId: asFeatureId(resolvedFeatureId),
                ...(note ? { note } : {})
              }
            : kind === 'surface'
              ? {
                  kind: 'surface' as const,
                  featureId: asFeatureId(resolvedFeatureId),
                  surfaceId: asSurfaceId(surfaceId!),
                  ...(note ? { note } : {})
                }
              : {
                  kind: 'action' as const,
                  featureId: asFeatureId(resolvedFeatureId),
                  actionId: asActionId(actionId!),
                  ...(note ? { note } : {})
                };
        const result = await enqueueItem(asProjectId(resolvedProjectId), input);
        return text(
          trackTokens('enqueue', {
            ok: true,
            projectId: String(result.project.id),
            itemId: String(result.item.id),
            alreadyQueued: result.alreadyQueued,
            queueLength: (result.project.implementationQueue ?? []).length
          })
        );
      } catch (e) {
        if (
          e instanceof ProjectNotFoundForQueueError ||
          e instanceof FeatureNotInProjectError ||
          e instanceof SurfaceNotInFeatureError ||
          e instanceof ActionNotInFeatureError
        ) {
          return errorText(e.message);
        }
        return errorText(`enqueue failed: ${(e as Error).message}`);
      }
    }
  );

  server.registerTool(
    'dequeue',
    {
      description:
        'Remove an entry from the queue by its opaque QueueItemId (from list_queue). Idempotent: removing an id that no longer exists is a no-op. Does NOT delete the underlying Feature or Action.',
      inputSchema: {
        projectId: z.string().optional(),
        queueItemId: z.string()
      }
    },
    async ({ projectId, queueItemId }) => {
      try {
        const resolvedProjectId = await resolveProjectId(deps, projectId);
        const next = await dequeueItem(
          asProjectId(resolvedProjectId),
          asQueueItemId(queueItemId)
        );
        return text(
          trackTokens('dequeue', {
            ok: true,
            projectId: String(next.id),
            queueLength: (next.implementationQueue ?? []).length
          })
        );
      } catch (e) {
        if (e instanceof ProjectNotFoundForQueueError) return errorText(e.message);
        return errorText(`dequeue failed: ${(e as Error).message}`);
      }
    }
  );

  server.registerTool(
    'reorder_queue',
    {
      description:
        'Reorder one queue entry. Pass either `direction` ("up"/"down" — swap with neighbor, idempotent at edges) OR `targetIndex` (absolute drop position, clamped into range). Mirrors how the dashboard drag-and-drop persists.',
      inputSchema: {
        projectId: z.string().optional(),
        queueItemId: z.string(),
        direction: z.enum(['up', 'down']).optional(),
        targetIndex: z.number().int().nonnegative().optional()
      }
    },
    async ({ projectId, queueItemId, direction, targetIndex }) => {
      try {
        if (direction === undefined && targetIndex === undefined) {
          return errorText('reorder_queue: pass either direction or targetIndex');
        }
        if (direction !== undefined && targetIndex !== undefined) {
          return errorText('reorder_queue: pass exactly one of direction / targetIndex, not both');
        }
        const resolvedProjectId = await resolveProjectId(deps, projectId);
        const next = await moveItem(
          asProjectId(resolvedProjectId),
          asQueueItemId(queueItemId),
          targetIndex !== undefined
            ? { kind: 'to', targetIndex }
            : { kind: 'by', direction: direction! }
        );
        return text(
          trackTokens('reorder_queue', {
            ok: true,
            projectId: String(next.id),
            order: (next.implementationQueue ?? []).map((q) => String(q.id))
          })
        );
      } catch (e) {
        if (e instanceof ProjectNotFoundForQueueError) return errorText(e.message);
        return errorText(`reorder_queue failed: ${(e as Error).message}`);
      }
    }
  );

  server.registerTool(
    'list_queue',
    {
      description:
        'List the project\'s implement-next queue in order. Each entry carries id, kind, featureId/actionId, human labels (featureName/actionName), and a `done` flag computed from the behavioral index in .unspa.json. Orphan entries (target deleted from the spec) are returned with orphaned:true so the caller can prompt the user to dequeue them. projectId optional when running inside a linked repo.',
      inputSchema: {
        projectId: z.string().optional(),
        includeDone: z
          .boolean()
          .optional()
          .describe('When false (default), filters out entries the behavioral index marks implemented. Set true to see the full raw queue.')
      }
    },
    async ({ projectId, includeDone }) => {
      try {
        const resolvedProjectId = await resolveProjectId(deps, projectId);
        const views = await listQueue(asProjectId(resolvedProjectId));
        const isDone = buildDonePredicate(deps);
        const augmented = await Promise.all(
          views.map(async (v) => ({
            ...queueItemSummary(v),
            done: await isDone(v)
          }))
        );
        const filtered = includeDone === true ? augmented : augmented.filter((q) => !q.done);
        return text(
          trackTokens('list_queue', {
            projectId: resolvedProjectId,
            total: augmented.length,
            shown: filtered.length,
            queue: filtered
          })
        );
      } catch (e) {
        if (e instanceof ProjectNotFoundForQueueError) return errorText(e.message);
        return errorText(`list_queue failed: ${(e as Error).message}`);
      }
    }
  );

  server.registerTool(
    'get_next_queued',
    {
      description:
        'Peek the next live queue entry the dev should implement. Skips orphans and anything the behavioral index marks implemented. Returns null when the queue is empty or fully done. Pure peek — call dequeue or update the index to remove it. projectId optional when running inside a linked repo.',
      inputSchema: { projectId: z.string().optional() }
    },
    async ({ projectId }) => {
      try {
        const resolvedProjectId = await resolveProjectId(deps, projectId);
        const isDone = buildDonePredicate(deps);
        const view = await getNextQueued(asProjectId(resolvedProjectId), isDone);
        if (!view) {
          return text(trackTokens('get_next_queued', { next: null }));
        }
        return text(
          trackTokens('get_next_queued', {
            next: queueItemSummary(view)
          })
        );
      } catch (e) {
        if (e instanceof ProjectNotFoundForQueueError) return errorText(e.message);
        return errorText(`get_next_queued failed: ${(e as Error).message}`);
      }
    }
  );
};

// Re-export so test suites can construct items without reaching deep.
export type { QueueItem };
