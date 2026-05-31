import type { Brand } from '$shared/domain/Brand';
import type {
  ActionId,
  FeatureId,
  SurfaceId
} from '$features/behavior-model/domain/value-objects/ids';

export type QueueItemId = Brand<string, 'QueueItemId'>;

export const asQueueItemId = (v: string): QueueItemId => v as QueueItemId;

/**
 * Optional implementation goals attached to a queue entry. Each is independent
 * — an item can ask for a maturity %, an implementation (Built) %, a "report
 * it exists in code" presence flag, or any combination. This tells whoever
 * builds the item (the user, or an LLM reading the queue over MCP) how far to
 * take it. An absent / all-empty target means "no specific goal".
 *
 *  - `maturity`        0–100: take the model's maturity score to ~this %.
 *  - `implementation`  0–100: take implementation (Built) coverage to ~this %.
 *  - `report`          true: at minimum, report that it exists somewhere in
 *                      code (presence) — the floor, not a percentage.
 */
export type QueueTargetMetric = 'maturity' | 'implementation';

export type QueueTarget = {
  readonly maturity?: number;
  readonly implementation?: number;
  readonly report?: boolean;
};

/** Clamp a raw number into an integer 0–100 percentage. */
export const clampPercent = (value: number): number =>
  Math.max(0, Math.min(100, Math.round(value)));

/** True when the target carries no actual goal (absent or every field empty). */
export const isEmptyTarget = (target: QueueTarget | undefined): boolean =>
  !target ||
  (target.maturity === undefined && target.implementation === undefined && !target.report);

/** One-line, human/LLM-readable phrasing of the goals on a target. */
export const describeQueueTarget = (target: QueueTarget): string => {
  const parts: string[] = [];
  if (typeof target.maturity === 'number') parts.push(`~${target.maturity}% maturity`);
  if (typeof target.implementation === 'number') {
    parts.push(`~${target.implementation}% implementation coverage`);
  }
  if (target.report) parts.push('report it exists in code');
  return parts.length > 0 ? `aim for ${parts.join(', ')}` : '';
};

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
      readonly target?: QueueTarget;
    }
  | {
      readonly id: QueueItemId;
      readonly kind: 'surface';
      readonly featureId: FeatureId;
      readonly surfaceId: SurfaceId;
      readonly addedAt: string;
      readonly note?: string;
      readonly target?: QueueTarget;
    }
  | {
      readonly id: QueueItemId;
      readonly kind: 'action';
      readonly featureId: FeatureId;
      readonly actionId: ActionId;
      readonly addedAt: string;
      readonly note?: string;
      readonly target?: QueueTarget;
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
