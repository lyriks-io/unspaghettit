import { describe, expect, it } from 'vitest';
import { CHANGED_SINCE_LIMIT, detectStaleWrite, staleWriteMessage } from './StaleWrite';

const READ_AT = '2026-09-20T10:00:00.000Z';
const BEFORE_READ = '2026-09-20T09:00:00.000Z';
const FIRST_WRITE = '2026-09-20T10:05:00.000Z';
const SECOND_WRITE = '2026-09-20T10:10:00.000Z';

describe('detectStaleWrite', () => {
  it('lets a write through when the feature is the one that was read', () => {
    expect(detectStaleWrite({ updatedAt: READ_AT, elementVersions: {} }, READ_AT)).toBeNull();
  });

  it('reads two spellings of the same instant as the same version', () => {
    const feature = { updatedAt: READ_AT };
    expect(detectStaleWrite(feature, '2026-09-20T10:00:00Z')).toBeNull();
    expect(detectStaleWrite(feature, '2026-09-20T12:00:00.000+02:00')).toBeNull();
  });

  it('names the elements stamped after the read, newest first, and nothing older', () => {
    const conflict = detectStaleWrite(
      {
        updatedAt: SECOND_WRITE,
        elementVersions: {
          'surface:s1': BEFORE_READ,
          'action:a1': FIRST_WRITE,
          'rule:r1': READ_AT,
          'scenario:sc1': SECOND_WRITE,
          'scenario:sc2': FIRST_WRITE
        }
      },
      READ_AT
    );

    expect(conflict).toEqual({
      expectedUpdatedAt: READ_AT,
      currentUpdatedAt: SECOND_WRITE,
      changedSince: ['scenario:sc1', 'action:a1', 'scenario:sc2'],
      changedSinceTotal: 3
    });
  });

  it('caps the list and still says how many moved', () => {
    const elementVersions = Object.fromEntries(
      Array.from({ length: CHANGED_SINCE_LIMIT + 12 }, (_, i) => [`scenario:sc${i}`, FIRST_WRITE])
    );
    const conflict = detectStaleWrite({ updatedAt: FIRST_WRITE, elementVersions }, READ_AT)!;

    expect(conflict.changedSince).toHaveLength(CHANGED_SINCE_LIMIT);
    expect(conflict.changedSinceTotal).toBe(CHANGED_SINCE_LIMIT + 12);
    // Equal stamps keep the order the feature lists them in.
    expect(conflict.changedSince[0]).toBe('scenario:sc0');
  });

  it('still refuses a snapshot without element stamps, with nothing to name', () => {
    expect(detectStaleWrite({ updatedAt: FIRST_WRITE }, READ_AT)).toEqual({
      expectedUpdatedAt: READ_AT,
      currentUpdatedAt: FIRST_WRITE,
      changedSince: [],
      changedSinceTotal: 0
    });
  });

  it('refuses a feature older than the read (a restore), and an unreadable stamp', () => {
    const feature = { updatedAt: READ_AT, elementVersions: { 'action:a1': BEFORE_READ } };
    expect(detectStaleWrite(feature, SECOND_WRITE)).toMatchObject({
      changedSince: [],
      changedSinceTotal: 0
    });
    expect(detectStaleWrite(feature, 'yesterday')).toMatchObject({
      expectedUpdatedAt: 'yesterday',
      changedSince: []
    });
  });

  it('does not touch the feature it reads', () => {
    const elementVersions = Object.freeze({ 'action:a1': FIRST_WRITE, 'scenario:sc1': SECOND_WRITE });
    const feature = Object.freeze({ updatedAt: SECOND_WRITE, elementVersions });
    expect(() => detectStaleWrite(feature, READ_AT)).not.toThrow();
    expect(Object.keys(elementVersions)).toEqual(['action:a1', 'scenario:sc1']);
  });
});

describe('staleWriteMessage', () => {
  it('is one sentence that says to re-read and rebase, and gives the stamp to send next', () => {
    const message = staleWriteMessage(detectStaleWrite({ updatedAt: FIRST_WRITE }, READ_AT)!);
    expect(message).toContain('nothing was applied');
    expect(message).toContain('re-read');
    expect(message).toContain('rebase');
    expect(message).toContain(`expectedUpdatedAt ${FIRST_WRITE}`);
  });
});
