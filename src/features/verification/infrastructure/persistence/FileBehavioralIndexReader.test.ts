import { describe, expect, it } from 'vitest';
import { toIndexedImplementations } from './FileBehavioralIndexReader';

describe('toIndexedImplementations', () => {
  it('reads a code entry without a valid status as missing, as it always did', () => {
    const [entry] = toIndexedImplementations({ 'action:a1': { specVersion: '2026-06-05T00:00:00.000Z' } });
    expect(entry).toEqual({
      key: 'action:a1',
      status: 'missing',
      auditedSpecVersion: '2026-06-05T00:00:00.000Z'
    });
  });

  it('reads a criterion entry without a status as implemented, so drift can judge it', () => {
    const [entry] = toIndexedImplementations({
      'criterion:c1': { specVersion: '2026-06-05T00:00:00.000Z' }
    });
    expect(entry!.status).toBe('implemented');
  });

  it('keeps the status an author wrote on a criterion entry', () => {
    const [entry] = toIndexedImplementations({ 'criterion:c1': { status: 'missing' } });
    expect(entry!.status).toBe('missing');
  });
});
