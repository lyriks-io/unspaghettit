import { describe, expect, it } from 'vitest';
import {
  bucketForDisposition,
  coverageForCandidates,
  disposeCandidate,
  rollUpCoverage,
  stageCandidate,
  type BehaviorCandidate,
  type CandidateDisposition
} from './Candidates';

const CONTENT = 'line one\nline two\nline three\n';

const stage = (over: Partial<Parameters<typeof stageCandidate>[1]> = {}) => {
  const r = stageCandidate([], {
    id: 'cand-1',
    sourceId: 'src-1',
    sourceContent: CONTENT,
    proposedKind: 'action',
    summary: 'Do the thing',
    startOffset: 0,
    endOffset: 8,
    at: 't0',
    ...over
  });
  if (!r.ok) throw new Error(r.reason);
  return r;
};

describe('stageCandidate', () => {
  it('stages an unreviewed candidate with computed span lines and default confidence', () => {
    const r = stage();
    expect(r.candidate.disposition).toBe('unreviewed');
    expect(r.candidate.confidence).toBe(0.5);
    expect(r.candidate.span.snippet).toBe('line one');
    expect(r.candidate.span.startLine).toBe(1);
    expect(r.candidate.span.endLine).toBe(1);
  });

  it('honors an explicit confidence and disposition', () => {
    const r = stage({ confidence: 0.9, disposition: 'accepted' });
    expect(r.candidate.confidence).toBe(0.9);
    expect(r.candidate.disposition).toBe('accepted');
  });

  it('rejects an empty summary, an inverted/oversized span, and out-of-range confidence', () => {
    expect(stageCandidate([], { ...base(), summary: '  ' }).ok).toBe(false);
    expect(stageCandidate([], { ...base(), startOffset: 8, endOffset: 8 }).ok).toBe(false);
    expect(stageCandidate([], { ...base(), endOffset: 9999 }).ok).toBe(false);
    expect(stageCandidate([], { ...base(), confidence: 1.5 }).ok).toBe(false);
  });

  function base() {
    return {
      id: 'c',
      sourceId: 'src-1',
      sourceContent: CONTENT,
      proposedKind: 'action' as const,
      summary: 'x',
      startOffset: 0,
      endOffset: 8,
      at: 't'
    };
  }
});

describe('disposeCandidate', () => {
  it('accepts a candidate and links it to a modeled element', () => {
    const seeded = stage();
    const r = disposeCandidate(seeded.candidates, {
      id: 'cand-1',
      disposition: 'accepted',
      rationale: 'Modeled as the Click action.',
      elementId: 'act-1',
      at: 't1'
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.candidate.disposition).toBe('accepted');
    expect(r.candidate.elementId).toBe('act-1');
    expect(r.candidate.rationale).toBe('Modeled as the Click action.');
  });

  it('requires an elementId for accepted and merged', () => {
    const seeded = stage();
    expect(disposeCandidate(seeded.candidates, { id: 'cand-1', disposition: 'accepted', at: 't1' }).ok).toBe(
      false
    );
    expect(disposeCandidate(seeded.candidates, { id: 'cand-1', disposition: 'merged', at: 't1' }).ok).toBe(
      false
    );
    // An excluding disposition needs no element.
    expect(
      disposeCandidate(seeded.candidates, { id: 'cand-1', disposition: 'out_of_scope', at: 't1' }).ok
    ).toBe(true);
  });

  it('drops a stale element link when re-disposed to a non-mapping state', () => {
    const seeded = stage();
    const accepted = disposeCandidate(seeded.candidates, {
      id: 'cand-1',
      disposition: 'accepted',
      elementId: 'act-1',
      at: 't1'
    });
    if (!accepted.ok) throw new Error('accept failed');
    const rejected = disposeCandidate(accepted.candidates, {
      id: 'cand-1',
      disposition: 'rejected',
      rationale: 'Actually out of scope.',
      at: 't2'
    });
    expect(rejected.ok).toBe(true);
    if (!rejected.ok) return;
    expect(rejected.candidate.disposition).toBe('rejected');
    expect(rejected.candidate.elementId).toBeUndefined();
  });

  it('rejects an unknown candidate id', () => {
    const seeded = stage();
    expect(disposeCandidate(seeded.candidates, { id: 'nope', disposition: 'rejected', at: 't1' }).ok).toBe(
      false
    );
  });
});

describe('candidate shape', () => {
  it('a staged candidate has no elementId until accepted', () => {
    const r = stage();
    const c: BehaviorCandidate = r.candidate;
    expect(c.elementId).toBeUndefined();
  });
});

describe('source coverage', () => {
  const cand = (
    id: string,
    sourceId: string,
    disposition: CandidateDisposition
  ): BehaviorCandidate => ({
    id,
    span: { sourceId, startOffset: 0, endOffset: 1, startLine: 1, endLine: 1, snippet: 'x' },
    proposedKind: 'action',
    summary: id,
    confidence: 0.5,
    disposition,
    recordedAt: 't',
    updatedAt: 't'
  });

  it('maps every disposition to exactly one bucket', () => {
    expect(bucketForDisposition('accepted')).toBe('modeled');
    expect(bucketForDisposition('merged')).toBe('duplicate');
    expect(bucketForDisposition('rejected')).toBe('excluded');
    expect(bucketForDisposition('out_of_scope')).toBe('excluded');
    expect(bucketForDisposition('unreviewed')).toBe('unresolved');
    expect(bucketForDisposition('conflict')).toBe('unresolved');
  });

  it('reports per-source buckets and shares that sum to the total', () => {
    const cov = coverageForCandidates([
      cand('a', 'src-1', 'accepted'),
      cand('b', 'src-1', 'merged'),
      cand('c', 'src-1', 'rejected'),
      cand('d', 'src-1', 'unreviewed')
    ]);
    expect(cov).toHaveLength(1);
    const s = cov[0]!;
    expect(s.total).toBe(4);
    expect(s.modeled + s.duplicate + s.excluded + s.unresolved).toBe(s.total);
    expect(s.modeledShare).toBe(0.25);
    expect(s.representedShare).toBe(0.5); // modeled + duplicate
    expect(s.unresolvedShare).toBe(0.25);
  });

  it('sorts sources by most unresolved first', () => {
    const cov = coverageForCandidates([
      cand('a', 'clean', 'accepted'),
      cand('b', 'messy', 'unreviewed'),
      cand('c', 'messy', 'unreviewed')
    ]);
    expect(cov.map((s) => s.sourceId)).toEqual(['messy', 'clean']);
  });

  it('rolls per-source coverage up to an analysis-wide total', () => {
    const perSource = coverageForCandidates([
      cand('a', 'src-1', 'accepted'),
      cand('b', 'src-2', 'unreviewed'),
      cand('c', 'src-2', 'accepted')
    ]);
    const overall = rollUpCoverage(perSource);
    expect(overall.total).toBe(3);
    expect(overall.modeled).toBe(2);
    expect(overall.unresolved).toBe(1);
    expect(overall.unresolvedShare).toBeCloseTo(0.33, 2);
  });

  it('is empty for no candidates and 0-shares are safe', () => {
    expect(coverageForCandidates([])).toEqual([]);
    expect(rollUpCoverage([]).modeledShare).toBe(0);
  });
});
