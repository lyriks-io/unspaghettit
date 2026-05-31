import { describe, expect, it } from 'vitest';
import { clampPercent, describeQueueTarget, isEmptyTarget } from './QueueItem';

describe('clampPercent', () => {
  it('clamps and rounds into 0..100', () => {
    expect(clampPercent(-5)).toBe(0);
    expect(clampPercent(150)).toBe(100);
    expect(clampPercent(49.6)).toBe(50);
  });
});

describe('isEmptyTarget', () => {
  it('is empty for undefined and all-empty objects', () => {
    expect(isEmptyTarget(undefined)).toBe(true);
    expect(isEmptyTarget({})).toBe(true);
    expect(isEmptyTarget({ report: false })).toBe(true);
  });

  it('is non-empty when any goal is set (0 counts)', () => {
    expect(isEmptyTarget({ maturity: 0 })).toBe(false);
    expect(isEmptyTarget({ implementation: 50 })).toBe(false);
    expect(isEmptyTarget({ report: true })).toBe(false);
  });
});

describe('describeQueueTarget', () => {
  it('phrases each goal that is set', () => {
    expect(describeQueueTarget({ implementation: 80 })).toContain('80% implementation');
    expect(describeQueueTarget({ maturity: 50 })).toContain('50% maturity');
    expect(describeQueueTarget({ report: true })).toContain('report it exists');
    const all = describeQueueTarget({ maturity: 100, implementation: 60, report: true });
    expect(all).toContain('maturity');
    expect(all).toContain('implementation');
    expect(all).toContain('report');
  });

  it('is empty when no goals are set', () => {
    expect(describeQueueTarget({})).toBe('');
  });
});
