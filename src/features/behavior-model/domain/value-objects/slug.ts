/**
 * Convert a free-form name into a stable kebab-case slug suitable for use
 * inside source-code tags. Pure, lossy by design: two names that collide on
 * slug should be disambiguated upstream (the audit tool surfaces the raw
 * name + slug so the LLM can pick a uniqueness suffix if needed).
 *
 * Examples:
 *   "Add to cart"           → "add-to-cart"
 *   "Sign in / sign up"     → "sign-in-sign-up"
 *   "  Multi   spaces  "    → "multi-spaces"
 */
export const toSlug = (name: string): string => {
  const trimmed = name.trim().toLowerCase();
  if (trimmed.length === 0) return '';
  return trimmed
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
};
