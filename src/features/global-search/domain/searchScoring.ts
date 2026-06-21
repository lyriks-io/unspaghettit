import type { SearchDoc, SearchEntityKind } from './SearchDoc';

/**
 * Relevance of `value` to `query`, scaled by `weight`. Same ladder the Builder
 * view uses (builderModeStore.textScore): exact match dominates, then a prefix,
 * then a word-prefix, then a loose substring. 0 when there's no hit.
 */
export const textScore = (query: string, value: string, weight: number): number => {
  if (!value) return 0;
  const text = value.toLowerCase();
  if (!text.includes(query)) return 0;
  if (text === query) return weight * 5;
  if (text.startsWith(query)) return weight * 4;
  if (text.split(/\s+/).some((word) => word.startsWith(query))) return weight * 3;
  return weight;
};

/**
 * Per-kind multiplier so that, all else equal, a matching container outranks a
 * matching leaf (you more often want the Action than one of its parameters).
 * Defaults to 1 for kinds not listed.
 */
const KIND_WEIGHT: Partial<Record<SearchEntityKind, number>> = {
  project: 1.3,
  domain: 1.2,
  feature: 1.25,
  surface: 1.15,
  action: 1.1,
  state: 1.05,
  entity: 1.05,
  event: 1.0,
  parameter: 0.95,
  rule: 0.95,
  invariant: 0.95,
  effect: 0.9,
  transition: 0.9,
  'entity-field': 0.9,
  'value-set': 0.95,
  resource: 0.95,
  persona: 1.0,
  scenario: 0.95
};

/**
 * Score one doc against a pre-normalized (trimmed, lowercased) query. The title
 * carries the most weight, the subtitle less, and a bare haystack hit is the
 * floor — so a tag/breadcrumb-only match still ranks, below any title match.
 * Returns 0 for "no match".
 */
export const scoreDoc = (doc: SearchDoc, normalizedQuery: string): number => {
  if (!normalizedQuery) return 0;
  const titleScore = textScore(normalizedQuery, doc.title, 100);
  const subtitleScore = doc.subtitle ? textScore(normalizedQuery, doc.subtitle, 25) : 0;
  const haystackScore = doc.haystack.includes(normalizedQuery) ? 10 : 0;
  const raw = Math.max(titleScore, subtitleScore, haystackScore);
  if (raw === 0) return 0;
  return raw * (KIND_WEIGHT[doc.kind] ?? 1);
};

export type ScoredDoc = { readonly doc: SearchDoc; readonly score: number };

/**
 * Filter to matching docs and sort by descending score. Ties break by the
 * original index so ordering is stable and deterministic (mirrors the Builder
 * view's `byRelevance`). `limit` caps the returned list.
 */
export const rankDocs = (
  docs: readonly SearchDoc[],
  rawQuery: string,
  limit = 40
): readonly ScoredDoc[] => {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return [];
  const scored: Array<ScoredDoc & { index: number }> = [];
  docs.forEach((doc, index) => {
    const score = scoreDoc(doc, query);
    if (score > 0) scored.push({ doc, score, index });
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.slice(0, limit).map(({ doc, score }) => ({ doc, score }));
};
