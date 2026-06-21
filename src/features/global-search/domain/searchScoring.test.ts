import { describe, expect, it } from 'vitest';
import type { SearchDoc } from './SearchDoc';
import { rankDocs, scoreDoc, textScore } from './searchScoring';

const doc = (over: Partial<SearchDoc> & Pick<SearchDoc, 'id' | 'kind' | 'title'>): SearchDoc => ({
  haystack: (over.title + ' ' + (over.subtitle ?? '')).toLowerCase(),
  nav: { href: '/' },
  ...over
});

describe('textScore', () => {
  it('ranks exact > prefix > word-prefix > substring > miss', () => {
    expect(textScore('pay', 'pay', 1)).toBe(5);
    expect(textScore('pay', 'payment', 1)).toBe(4);
    expect(textScore('coupon', 'apply coupon now', 1)).toBe(3);
    expect(textScore('upon', 'apply coupon', 1)).toBe(1);
    expect(textScore('zzz', 'apply coupon', 1)).toBe(0);
  });
});

describe('scoreDoc', () => {
  it('returns 0 for an empty query', () => {
    expect(scoreDoc(doc({ id: 'a', kind: 'action', title: 'Apply Coupon' }), '')).toBe(0);
  });

  it('weights a container above a leaf for the same title hit', () => {
    const project = doc({ id: 'p', kind: 'project', title: 'Checkout' });
    const param = doc({ id: 'x', kind: 'parameter', title: 'Checkout' });
    expect(scoreDoc(project, 'checkout')).toBeGreaterThan(scoreDoc(param, 'checkout'));
  });

  it('still scores a haystack-only (e.g. tag) match, below a title match', () => {
    const tagOnly = doc({
      id: 't',
      kind: 'feature',
      title: 'Commerce',
      haystack: 'commerce growth team'
    });
    const titleHit = doc({ id: 'g', kind: 'feature', title: 'Growth board' });
    const tagScore = scoreDoc(tagOnly, 'growth');
    expect(tagScore).toBeGreaterThan(0);
    expect(scoreDoc(titleHit, 'growth')).toBeGreaterThan(tagScore);
  });
});

describe('rankDocs', () => {
  const docs: SearchDoc[] = [
    doc({ id: '1', kind: 'parameter', title: 'couponCode' }),
    doc({ id: '2', kind: 'action', title: 'Apply Coupon' }),
    doc({ id: '3', kind: 'feature', title: 'Unrelated' })
  ];

  it('filters out non-matches and sorts by descending score', () => {
    const ranked = rankDocs(docs, 'coupon');
    // 'couponCode' is a title prefix (×4); 'Apply Coupon' only a word-prefix
    // (×3) — the prefix match outranks the leaf-vs-container weighting here.
    expect(ranked.map((r) => r.doc.id)).toEqual(['1', '2']);
    expect(ranked.every((r) => r.score > 0)).toBe(true);
  });

  it('returns nothing for a blank query', () => {
    expect(rankDocs(docs, '   ')).toEqual([]);
  });

  it('honors the result limit', () => {
    expect(rankDocs(docs, 'coupon', 1)).toHaveLength(1);
  });
});
