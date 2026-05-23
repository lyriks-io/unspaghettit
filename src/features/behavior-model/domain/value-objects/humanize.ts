import type { StatePath } from './StatePath';

/**
 * Convert a dotted, camelCase or snake_case state path into a human-readable
 * label. Pure, stateless. Safe to call from any layer.
 *
 * Examples:
 *   "search.query"             → "Search query"
 *   "cart.itemCount"           → "Cart item count"
 *   "user.emailVerified"       → "User email verified"
 *   "audit.vulnerabilityCount" → "Audit vulnerability count"
 *   "quota.leadsThisMonth"     → "Quota leads this month"
 */
export const humanizeStatePath = (path: StatePath | string): string => {
  const raw = String(path).trim();
  if (raw.length === 0) return '';
  const words: string[] = [];
  for (const segment of raw.split('.')) {
    const subwords = segment
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/_+/g, ' ')
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 0);
    words.push(...subwords);
  }
  if (words.length === 0) return raw;
  const first = words[0] as string;
  const rest = words.slice(1);
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(' ');
};

/**
 * Inverse of `humanizeStatePath`. Convert a friendly name into a canonical
 * dot-path. The first word becomes the namespace, the rest become a single
 * camelCased identifier. Matches the conventions used in seed data.
 *
 * Examples:
 *   "Selection count"             → "selection.count"
 *   "Cart item count"             → "cart.itemCount"
 *   "User email verified"         → "user.emailVerified"
 *   "Audit vulnerability count"   → "audit.vulnerabilityCount"
 *   "Cart"                        → "cart"
 *
 * Already-dotted input is returned unchanged so power users can type the
 * canonical form directly.
 */
export const statePathFromName = (name: string): string => {
  const trimmed = name.trim();
  if (trimmed.length === 0) return '';
  // Already-canonical multi-segment dot-path → pass through unchanged.
  if (
    trimmed.includes('.') &&
    /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$/.test(trimmed)
  ) {
    return trimmed;
  }
  // Single bare identifier (no spaces, no dots, no punctuation): preserve
  // internal casing but lowercase the first letter. "Cart" → "cart",
  // "cartItemCount" → "cartItemCount".
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) {
    return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
  }
  const words = trimmed
    .replace(/[^a-zA-Z0-9\s_]+/g, ' ')
    .toLowerCase()
    .split(/[\s_]+/)
    .filter((w) => w.length > 0);
  if (words.length === 0) return '';
  if (words.length === 1) return words[0] as string;
  const ns = words[0] as string;
  const rest = words.slice(1);
  const camel = rest
    .map((w, i) => (i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join('');
  return `${ns}.${camel}`;
};
