/**
 * Input-side id expansion. New entities are minted with 8-char hex IDs by
 * the id generator; legacy snapshots may still hold 36-char v4 UUIDs. Both
 * shapes coexist as opaque strings, and the expanders here let an LLM type
 * an 8-char prefix against a longer stored id by scanning the loaded
 * context for a unique startsWith match.
 *
 * Pure pass-through when the input matches an existing id exactly.
 */
import type { Feature } from '../../src/features/behavior-model/domain/entities/Feature';
import type { FeatureRepository } from '../../src/features/behavior-model/application/ports/FeatureRepository';
import type { ProjectRepository } from '../../src/features/projects/application/ports/ProjectRepository';

// Only hex characters (plus dashes inside legacy UUIDs) are eligible for
// prefix expansion. Anything else (typos, legacy "id_xxx" strings) is
// passed through so the downstream not-found error fires with its own
// wording.
const SHORT_PREFIX_RE = /^[0-9a-f-]{1,35}$/;

/**
 * Resolve an id against a known set of candidates. Returns:
 * - the input unchanged when it's an exact match OR length ≥ 36 (full UUID)
 *   OR isn't hex-shaped (let the downstream not-found error fire)
 * - the unique candidate when the input is a prefix of exactly one
 * - throws on ambiguity (2+ candidates share the prefix)
 */
export const expandShortId = (
  input: string,
  candidates: Iterable<string>,
  label: string
): string => {
  if (!input) throw new Error(`Empty ${label}`);
  if (input.length >= 36) return input;
  if (!SHORT_PREFIX_RE.test(input)) return input;
  const matches: string[] = [];
  for (const candidate of candidates) {
    if (candidate === input) return candidate;
    if (candidate.startsWith(input)) matches.push(candidate);
  }
  if (matches.length === 1) return matches[0]!;
  if (matches.length === 0) return input;
  throw new Error(
    `Ambiguous ${label} prefix ${input}: matches ${matches.length} ids (${matches
      .slice(0, 3)
      .map((m) => m.slice(0, 12))
      .join(', ')}…)`
  );
};

/**
 * Walk a loaded feature and collect every entity id (surface, action, rule,
 * effect, invariant, state, parameter, transition, scenario, persona,
 * resource, entity, event). Feeds the prefix-match in `expandIdInFeature`.
 */
export const collectFeatureEntityIds = (feature: Feature): Set<string> => {
  const ids = new Set<string>();
  ids.add(String(feature.id));
  for (const s of feature.surfaces) {
    ids.add(String(s.id));
    for (const sd of s.stateDefinitions) ids.add(String(sd.id));
    for (const r of s.rules) ids.add(String(r.id));
    for (const inv of s.invariants) ids.add(String(inv.id));
    for (const t of s.transitions) ids.add(String(t.id));
    for (const a of s.actions) {
      ids.add(String(a.id));
      for (const r of a.rules) ids.add(String(r.id));
      for (const inv of a.invariants) ids.add(String(inv.id));
      for (const e of a.effects) ids.add(String(e.id));
      for (const p of a.parameters) ids.add(String(p.id));
      for (const sc of a.scenarios ?? []) ids.add(String(sc.id));
    }
  }
  for (const inv of feature.featureInvariants ?? []) ids.add(String(inv.id));
  for (const ev of feature.events ?? []) ids.add(String(ev.id));
  for (const p of feature.personas) ids.add(String(p.id));
  for (const r of feature.resources) ids.add(String(r.id));
  for (const e of feature.entities) ids.add(String(e.id));
  return ids;
};

export const expandIdInFeature = (
  feature: Feature,
  idOrShort: string,
  label = 'id'
): string => expandShortId(idOrShort, collectFeatureEntityIds(feature), label);

export const expandFeatureId = async (
  repo: FeatureRepository,
  idOrShort: string
): Promise<string> => {
  const summaries = await repo.list();
  return expandShortId(idOrShort, summaries.map((s) => String(s.id)), 'featureId');
};

export const expandProjectId = async (
  projectRepo: ProjectRepository,
  idOrShort: string
): Promise<string> => {
  const summaries = await projectRepo.list();
  return expandShortId(idOrShort, summaries.map((s) => String(s.id)), 'projectId');
};
