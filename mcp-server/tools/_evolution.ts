import { z } from 'zod';
import {
  ALL_EVOLUTION_CATEGORIES,
  type Evolution
} from '../../src/features/behavior-model/domain/entities/Action';

/**
 * Shared zod shape + normalizer for the `evolution` marker accepted by
 * add_action / update_action / propose_evolution and the matching apply_batch
 * ops. Centralised so the wire contract can't drift between the granular tools
 * and the batch path.
 */
export const evolutionInputSchema = z.object({
  rationale: z
    .string()
    .min(1)
    .describe('Why this is worth doing — the "because…" shown to the user.'),
  category: z
    .enum(ALL_EVOLUTION_CATEGORIES as unknown as [string, ...string[]])
    .optional()
    .describe('Kind of improvement: security | competitor | ux | accessibility | scale | compliance | other.'),
  source: z
    .string()
    .min(1)
    .optional()
    .describe('Optional provenance, e.g. "competitors", "OWASP ASVS", "WCAG 2.2".')
});

export type EvolutionInput = z.infer<typeof evolutionInputSchema>;

/** Build a clean Evolution domain object, dropping absent optional fields. */
export const normalizeEvolution = (input: EvolutionInput): Evolution => ({
  rationale: input.rationale,
  ...(input.category ? { category: input.category as Evolution['category'] } : {}),
  ...(input.source ? { source: input.source } : {})
});

/**
 * Coerce a loosely-typed `op.evolution` value (from apply_batch) into an
 * Evolution, or undefined when absent/blank. Throws via zod when the shape is
 * present but invalid so a malformed batch op fails loudly.
 */
export const normalizeEvolutionLoose = (raw: unknown): Evolution | undefined => {
  if (raw === undefined || raw === null) return undefined;
  return normalizeEvolution(evolutionInputSchema.parse(raw));
};
