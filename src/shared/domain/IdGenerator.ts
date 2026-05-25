export type IdGenerator = () => string;

/**
 * 8-char hex IDs. Short enough that tool payloads stay cheap, long enough
 * that collisions across a single feature are vanishingly rare (2^32 = 4B
 * combos; a feature with ~1k entities has ~1e-7 collision odds).
 *
 * Legacy snapshots may still hold 36-char v4 UUIDs minted before this
 * switch. Both shapes coexist, IDs are opaque strings end-to-end, and the
 * input expander resolves short prefixes against the loaded feature so an
 * 8-char prefix matches a 36-char stored ID by prefix.
 */
export const cryptoIdGenerator: IdGenerator = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(4);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
};
