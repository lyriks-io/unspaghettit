/**
 * Developer context attached to an Feature. When set, the MCP server
 * injects implementation guidance into focused action reads so the LLM
 * writing the prototype produces code that matches the team's stack and
 * conventions, and tags emitted events for later audit.
 *
 * `mode: "auto"`   → the MCP server fills in an Unspaghettit default preset
 *                    (DDD + hexagonal + clean code + dependency inversion).
 * `mode: "custom"` → the user-supplied stack/conventions are returned as-is.
 */
export type DevContextMode = 'auto' | 'custom';

export type DevContext = {
  readonly mode: DevContextMode;
  /** Free-form stack description, e.g. "TypeScript / SvelteKit / Vitest". */
  readonly stack?: string;
  /** Architecture/code conventions, e.g. ["DDD", "hexagonal", "clean code"]. */
  readonly conventions?: readonly string[];
  /** Free-form project notes the LLM should know. */
  readonly notes?: string;
};

export const UNSPA_AUTO_PRESET: Readonly<{
  conventions: readonly string[];
  notes: string;
}> = {
  conventions: [
    'DDD (domain-driven design)',
    'hexagonal architecture (ports & adapters)',
    'dependency inversion at every boundary',
    'clean code: small functions, intention-revealing names, no premature abstraction'
  ],
  notes:
    'Even for prototypes: keep the domain pure, push IO to adapters, and let the use-case layer orchestrate. The product will evolve. Modular shapes pay off later.'
};

/**
 * Resolve a DevContext to its effective shape. When `mode: "auto"`, fill in
 * the Unspaghettit preset for any field the user did not override. Returns `null`
 * when no devContext is set on the feature.
 */
export const resolveDevContext = (ctx: DevContext | undefined): DevContext | null => {
  if (!ctx) return null;
  if (ctx.mode === 'custom') return ctx;
  return {
    mode: 'auto',
    stack: ctx.stack,
    conventions: ctx.conventions ?? UNSPA_AUTO_PRESET.conventions,
    notes: ctx.notes ?? UNSPA_AUTO_PRESET.notes
  };
};
