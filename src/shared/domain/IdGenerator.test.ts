import { describe, expect, it } from 'vitest';
import { recordingIdGenerator, replayingIdGenerator, type IdGenerator } from './IdGenerator';

const counter = (prefix: string): IdGenerator => {
  let n = 0;
  return () => `${prefix}-${n++}`;
};

describe('recordingIdGenerator', () => {
  it('passes the live ids through and remembers them in mint order', () => {
    const recorder = recordingIdGenerator(counter('live'));

    expect([recorder.mint(), recorder.mint()]).toEqual(['live-0', 'live-1']);
    expect(recorder.minted).toEqual(['live-0', 'live-1']);
  });
});

describe('replayingIdGenerator', () => {
  it('yields the recorded sequence first, then falls back to the live generator', () => {
    const mint = replayingIdGenerator(['a', 'b'], counter('live'), () => false);

    expect([mint(), mint(), mint(), mint()]).toEqual(['a', 'b', 'live-0', 'live-1']);
  });

  it('gives a taken slot a fresh id and keeps the later slots aligned', () => {
    const mint = replayingIdGenerator(['a', 'b', 'c'], counter('live'), (id) => id === 'b');

    expect([mint(), mint(), mint()]).toEqual(['a', 'live-0', 'c']);
  });
});
