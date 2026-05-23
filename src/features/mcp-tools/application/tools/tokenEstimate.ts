/**
 * Rough character-based token estimate. Real tokenization depends on the
 * model, but ~4 chars per token is the standard ballpark for English JSON
 * and is more than precise enough for relative comparisons (focused query
 * vs full-blob baseline). Which is the only thing the thesis demo needs.
 */
export const estimateTokens = (value: unknown): number => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (!text) return 0;
  return Math.ceil(text.length / 4);
};
