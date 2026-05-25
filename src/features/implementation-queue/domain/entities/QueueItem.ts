import type { Brand } from '$shared/domain/Brand';
import type {
  ActionId,
  FeatureId,
  SurfaceId
} from '$features/behavior-model/domain/value-objects/ids';

export type QueueItemId = Brand<string, 'QueueItemId'>;

export const asQueueItemId = (v: string): QueueItemId => v as QueueItemId;

/**
 * One entry on a Project's "implement next" list. A queue item points at
 * a whole Feature ('feature'), a whole Surface ('surface'), or a single
 * Action ('action'). The id is opaque and project-local: it lets the UI
 * key on it during reorder without leaking the underlying
 * featureId/surfaceId/actionId tuple, which is not unique on its own
 * (two items could legitimately target the same action twice if the
 * dedupe rules change — current behavior dedupes, see
 * queueOperations.enqueue).
 */
export type QueueItem =
  | {
      readonly id: QueueItemId;
      readonly kind: 'feature';
      readonly featureId: FeatureId;
      readonly addedAt: string;
      readonly note?: string;
    }
  | {
      readonly id: QueueItemId;
      readonly kind: 'surface';
      readonly featureId: FeatureId;
      readonly surfaceId: SurfaceId;
      readonly addedAt: string;
      readonly note?: string;
    }
  | {
      readonly id: QueueItemId;
      readonly kind: 'action';
      readonly featureId: FeatureId;
      readonly actionId: ActionId;
      readonly addedAt: string;
      readonly note?: string;
    };

/**
 * Stable identity key for dedupe. Two items are the same queue entry when
 * they target the same (kind, featureId, surfaceId?/actionId?) tuple. We
 * keep the tuple separate from the opaque id because the human-meaningful
 * identity of a queued task is "this action of this feature", not the
 * synthesized QueueItemId.
 */
export const queueItemKey = (item: QueueItem): string => {
  switch (item.kind) {
    case 'feature':
      return `feature:${String(item.featureId)}`;
    case 'surface':
      return `surface:${String(item.featureId)}:${String(item.surfaceId)}`;
    case 'action':
      return `action:${String(item.featureId)}:${String(item.actionId)}`;
  }
};
