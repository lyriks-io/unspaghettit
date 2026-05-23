import { queueItemKey, type QueueItem, type QueueItemId } from '../entities/QueueItem';

/**
 * Pure ordered-list operations on a Project's implementation queue. Every
 * function returns a new array; the input is never mutated. The use cases
 * compose these helpers and persist the result via ProjectRepository.save,
 * so the persistence-vs-domain split stays clean.
 */

const indexById = (
  queue: readonly QueueItem[],
  id: QueueItemId
): number => queue.findIndex((q) => q.id === id);

const indexByKey = (queue: readonly QueueItem[], key: string): number =>
  queue.findIndex((q) => queueItemKey(q) === key);

/**
 * Append `item` to the end of the queue unless an entry with the same
 * (kind, featureId, actionId?) key already exists, in which case the
 * existing entry is returned untouched. Idempotent so "queue this action"
 * called twice from a fast double-click doesn't produce two rows.
 */
export const enqueue = (
  queue: readonly QueueItem[],
  item: QueueItem
): readonly QueueItem[] => {
  if (indexByKey(queue, queueItemKey(item)) >= 0) return queue;
  return [...queue, item];
};

/** Remove a queue entry by its opaque QueueItemId. No-op when not found. */
export const dequeue = (
  queue: readonly QueueItem[],
  id: QueueItemId
): readonly QueueItem[] => {
  const idx = indexById(queue, id);
  if (idx < 0) return queue;
  return [...queue.slice(0, idx), ...queue.slice(idx + 1)];
};

/**
 * Move an entry to an arbitrary index (drag-and-drop in the UI). The
 * target index is clamped into [0, queue.length-1] so an over-drag at
 * the bottom of the list becomes "place last" instead of an error. No-op
 * when the entry is not found.
 */
export const moveTo = (
  queue: readonly QueueItem[],
  id: QueueItemId,
  targetIndex: number
): readonly QueueItem[] => {
  const idx = indexById(queue, id);
  if (idx < 0) return queue;
  const clamped = Math.max(0, Math.min(queue.length - 1, targetIndex));
  if (clamped === idx) return queue;
  const next = queue.slice();
  const [removed] = next.splice(idx, 1);
  next.splice(clamped, 0, removed!);
  return next;
};

/**
 * Reorder by relative direction. Matches the MoveFeatureInProject and
 * move_action ergonomics so the MCP surface is consistent ("up" / "down")
 * even though the UI uses absolute drag positions.
 */
export const moveBy = (
  queue: readonly QueueItem[],
  id: QueueItemId,
  direction: 'up' | 'down'
): readonly QueueItem[] => {
  const idx = indexById(queue, id);
  if (idx < 0) return queue;
  const target = direction === 'up' ? idx - 1 : idx + 1;
  return moveTo(queue, id, target);
};

/** True when the queue already holds an entry for this target. */
export const isQueued = (
  queue: readonly QueueItem[],
  key: string
): boolean => indexByKey(queue, key) >= 0;
