import { describe, expect, it } from 'vitest';
import {
  asActionId,
  asFeatureId,
  asSurfaceId
} from '$features/behavior-model/domain/value-objects/ids';
import { asQueueItemId, queueItemKey, type QueueItem } from '../entities/QueueItem';
import { dequeue, enqueue, isQueued, moveBy, moveTo, setTarget } from './QueueOperations';

const featureItem = (id: string, featureId: string): QueueItem => ({
  id: asQueueItemId(id),
  kind: 'feature',
  featureId: asFeatureId(featureId),
  addedAt: '2026-05-22T00:00:00.000Z'
});

const surfaceItem = (id: string, featureId: string, surfaceId: string): QueueItem => ({
  id: asQueueItemId(id),
  kind: 'surface',
  featureId: asFeatureId(featureId),
  surfaceId: asSurfaceId(surfaceId),
  addedAt: '2026-05-22T00:00:00.000Z'
});

const actionItem = (id: string, featureId: string, actionId: string): QueueItem => ({
  id: asQueueItemId(id),
  kind: 'action',
  featureId: asFeatureId(featureId),
  actionId: asActionId(actionId),
  addedAt: '2026-05-22T00:00:00.000Z'
});

describe('queueItemKey', () => {
  it('separates feature, surface, and action targets', () => {
    expect(queueItemKey(featureItem('q1', 'f1'))).toBe('feature:f1');
    expect(queueItemKey(surfaceItem('q2', 'f1', 's1'))).toBe('surface:f1:s1');
    expect(queueItemKey(actionItem('q3', 'f1', 'a1'))).toBe('action:f1:a1');
  });

  it('treats feature, surface, and action targets as distinct under dedupe', () => {
    const initial: QueueItem[] = [featureItem('q1', 'f1')];
    const afterSurface = enqueue(initial, surfaceItem('q2', 'f1', 's1'));
    const afterAction = enqueue(afterSurface, actionItem('q3', 'f1', 'a1'));
    expect(afterAction).toHaveLength(3);
  });
});

describe('enqueue', () => {
  it('appends to the end when the target is new', () => {
    const result = enqueue([featureItem('q1', 'f1')], actionItem('q2', 'f1', 'a1'));
    expect(result).toHaveLength(2);
    expect(result[1]!.id).toBe(asQueueItemId('q2'));
  });

  it('is a no-op when the same (kind, ids) tuple is already queued', () => {
    const initial = [actionItem('q1', 'f1', 'a1')];
    const result = enqueue(initial, actionItem('q-dup', 'f1', 'a1'));
    expect(result).toBe(initial);
  });

  it('treats feature and action targets as distinct keys', () => {
    const initial = [featureItem('q1', 'f1')];
    const result = enqueue(initial, actionItem('q2', 'f1', 'a1'));
    expect(result).toHaveLength(2);
  });
});

describe('dequeue', () => {
  it('removes the matching id', () => {
    const result = dequeue(
      [featureItem('q1', 'f1'), actionItem('q2', 'f1', 'a1')],
      asQueueItemId('q1')
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe(asQueueItemId('q2'));
  });

  it('is a no-op when the id is unknown', () => {
    const initial = [featureItem('q1', 'f1')];
    const result = dequeue(initial, asQueueItemId('ghost'));
    expect(result).toBe(initial);
  });
});

describe('moveTo', () => {
  const a = featureItem('a', 'f1');
  const b = featureItem('b', 'f2');
  const c = featureItem('c', 'f3');

  it('moves an entry to an arbitrary index', () => {
    const result = moveTo([a, b, c], asQueueItemId('c'), 0);
    expect(result.map((q) => q.id)).toEqual(['c', 'a', 'b']);
  });

  it('clamps target index into range so over-drag becomes place-last', () => {
    const result = moveTo([a, b, c], asQueueItemId('a'), 99);
    expect(result.map((q) => q.id)).toEqual(['b', 'c', 'a']);
  });

  it('returns the same array reference when target index equals current', () => {
    const initial = [a, b, c];
    const result = moveTo(initial, asQueueItemId('b'), 1);
    expect(result).toBe(initial);
  });

  it('is a no-op when the id is unknown', () => {
    const initial = [a, b, c];
    const result = moveTo(initial, asQueueItemId('ghost'), 0);
    expect(result).toBe(initial);
  });
});

describe('moveBy', () => {
  const a = featureItem('a', 'f1');
  const b = featureItem('b', 'f2');
  const c = featureItem('c', 'f3');

  it('moves up swaps with previous neighbor', () => {
    const result = moveBy([a, b, c], asQueueItemId('c'), 'up');
    expect(result.map((q) => q.id)).toEqual(['a', 'c', 'b']);
  });

  it('moves down swaps with next neighbor', () => {
    const result = moveBy([a, b, c], asQueueItemId('a'), 'down');
    expect(result.map((q) => q.id)).toEqual(['b', 'a', 'c']);
  });

  it('is a no-op at the edge', () => {
    const initial = [a, b, c];
    expect(moveBy(initial, asQueueItemId('a'), 'up')).toBe(initial);
    expect(moveBy(initial, asQueueItemId('c'), 'down')).toBe(initial);
  });
});

describe('isQueued', () => {
  it('matches by key, not by opaque id', () => {
    const queue = [actionItem('synthetic-id', 'f1', 'a1')];
    expect(isQueued(queue, 'action:f1:a1')).toBe(true);
    expect(isQueued(queue, 'action:f1:a2')).toBe(false);
  });
});

describe('setTarget', () => {
  it('attaches a goal to the matching item', () => {
    const result = setTarget([featureItem('a', 'f1')], asQueueItemId('a'), { implementation: 80 });
    expect(result[0]!.target).toEqual({ implementation: 80 });
  });

  it('clears with undefined', () => {
    const withGoal = setTarget([featureItem('a', 'f1')], asQueueItemId('a'), { maturity: 50 });
    const cleared = setTarget(withGoal, asQueueItemId('a'), undefined);
    expect(cleared[0]!.target).toBeUndefined();
  });

  it('treats an all-empty goal object as a clear', () => {
    const withGoal = setTarget([featureItem('a', 'f1')], asQueueItemId('a'), { report: true });
    const cleared = setTarget(withGoal, asQueueItemId('a'), {});
    expect(cleared[0]!.target).toBeUndefined();
  });

  it('is a no-op (same ref) when the id is not found', () => {
    const initial = [featureItem('a', 'f1')];
    expect(setTarget(initial, asQueueItemId('missing'), { report: true })).toBe(initial);
  });
});
