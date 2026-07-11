import { describe, expect, it } from 'vitest';
import {
  addConflict,
  openConflicts,
  resolveConflict,
  suggestConflictWinner,
  type Conflict,
  type ConflictClaim
} from './Conflicts';
import type { SourceAuthority } from './ProjectSource';

const claims: ConflictClaim[] = [
  { sourceId: 'code-1', statement: 'The cart caps at 10 items.' },
  { sourceId: 'prd-1', statement: 'The cart caps at 20 items.' }
];

const seed = (over: Partial<Parameters<typeof addConflict>[1]> = {}) => {
  const r = addConflict([], {
    id: 'conf-1',
    summary: 'Cart item cap disagreement',
    claims,
    affectedElements: ['state-cap'],
    at: 't0',
    ...over
  });
  if (!r.ok) throw new Error(r.reason);
  return r;
};

describe('addConflict', () => {
  it('records an open conflict with its claims and affected elements', () => {
    const r = seed();
    expect(r.conflict.status).toBe('open');
    expect(r.conflict.claims).toHaveLength(2);
    expect(r.conflict.affectedElements).toEqual(['state-cap']);
    expect(r.conflicts).toHaveLength(1);
  });

  it('trims claim statements', () => {
    const r = seed({
      claims: [
        { sourceId: 'a', statement: '  says A  ' },
        { sourceId: 'b', statement: 'says B' }
      ]
    });
    expect(r.conflict.claims[0]?.statement).toBe('says A');
  });

  it('rejects fewer than two claims, an empty summary, empty statements, and duplicate sources', () => {
    expect(addConflict([], { id: 'c', summary: 's', claims: [claims[0]!], affectedElements: [], at: 't' }).ok).toBe(
      false
    );
    expect(addConflict([], { id: 'c', summary: '  ', claims, affectedElements: [], at: 't' }).ok).toBe(false);
    expect(
      addConflict([], {
        id: 'c',
        summary: 's',
        claims: [
          { sourceId: 'a', statement: ' ' },
          { sourceId: 'b', statement: 'x' }
        ],
        affectedElements: [],
        at: 't'
      }).ok
    ).toBe(false);
    expect(
      addConflict([], {
        id: 'c',
        summary: 's',
        claims: [
          { sourceId: 'same', statement: 'x' },
          { sourceId: 'same', statement: 'y' }
        ],
        affectedElements: [],
        at: 't'
      }).ok
    ).toBe(false);
  });
});

describe('resolveConflict', () => {
  it('resolves in favor of a claim source and records the reasoning', () => {
    const seeded = seed();
    const r = resolveConflict(seeded.conflicts, {
      id: 'conf-1',
      status: 'resolved',
      resolution: 'The PRD is the contract; 20 wins.',
      resolvedInFavorOf: 'prd-1',
      at: 't1'
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.conflict.status).toBe('resolved');
    expect(r.conflict.resolvedInFavorOf).toBe('prd-1');
    expect(openConflicts(r.conflicts)).toHaveLength(0);
  });

  it('accepts ambiguity as a first-class outcome', () => {
    const seeded = seed();
    const r = resolveConflict(seeded.conflicts, {
      id: 'conf-1',
      status: 'accepted_ambiguity',
      resolution: 'Both are live in different tiers; left open on purpose.',
      at: 't1'
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.conflict.status).toBe('accepted_ambiguity');
    expect(openConflicts(r.conflicts)).toHaveLength(0);
  });

  it('rejects an unknown id, an empty resolution, and a non-claim winner', () => {
    const seeded = seed();
    expect(
      resolveConflict(seeded.conflicts, { id: 'nope', status: 'resolved', resolution: 'x', at: 't' }).ok
    ).toBe(false);
    expect(
      resolveConflict(seeded.conflicts, { id: 'conf-1', status: 'resolved', resolution: '  ', at: 't' }).ok
    ).toBe(false);
    expect(
      resolveConflict(seeded.conflicts, {
        id: 'conf-1',
        status: 'resolved',
        resolution: 'x',
        resolvedInFavorOf: 'ghost',
        at: 't'
      }).ok
    ).toBe(false);
  });
});

describe('suggestConflictWinner', () => {
  const authorities: Record<string, SourceAuthority> = {
    'code-1': 'supporting',
    'prd-1': 'normative'
  };
  const authorityOf = (id: string): SourceAuthority => authorities[id] ?? 'unknown';

  it('names the strictly-highest-authority source as the winner', () => {
    const s = suggestConflictWinner(claims, authorityOf);
    expect(s.kind).toBe('winner');
    if (s.kind !== 'winner') return;
    expect(s.sourceId).toBe('prd-1');
    expect(s.authority).toBe('normative');
  });

  it('reports ambiguity when the top authority is tied', () => {
    const tied = suggestConflictWinner(
      [
        { sourceId: 'a', statement: 'x' },
        { sourceId: 'b', statement: 'y' }
      ],
      () => 'normative'
    );
    expect(tied.kind).toBe('ambiguous');
    if (tied.kind !== 'ambiguous') return;
    expect(tied.sourceIds).toEqual(['a', 'b']);
  });

  it('treats all-unknown as ambiguous, not a winner', () => {
    const s = suggestConflictWinner(claims, () => 'unknown');
    expect(s.kind).toBe('ambiguous');
  });
});

describe('openConflicts', () => {
  it('counts only conflicts still open', () => {
    const mk = (id: string, status: Conflict['status']): Conflict => ({
      id,
      summary: id,
      claims,
      affectedElements: [],
      status,
      recordedAt: 't',
      updatedAt: 't'
    });
    const all = [mk('a', 'open'), mk('b', 'resolved'), mk('c', 'accepted_ambiguity'), mk('d', 'open')];
    expect(openConflicts(all).map((c) => c.id)).toEqual(['a', 'd']);
  });
});
