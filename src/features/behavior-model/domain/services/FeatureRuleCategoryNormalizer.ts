import type { Action } from '../entities/Action';
import type { Feature } from '../entities/Feature';
import type { Rule } from '../entities/Rule';
import type { Surface } from '../entities/Surface';
import { ALL_RULE_CATEGORIES, type RuleCategory } from '../value-objects/RuleCategory';

/**
 * Map legacy / typo categories produced by older drafts of the spec onto
 * their canonical RuleCategory. Kept narrow on purpose: only the categories
 * known to appear in real unspa/*.feature.json snapshots from before the
 * canonical vocabulary was published.
 *
 * Wired at IMPORT time only, never on write. New writes go straight to the
 * strict validator so typos like `category: "permission"` (singular) hit a
 * loud "did you mean 'permissions'?" error instead of being silently
 * remapped. That feedback loop is what teaches the LLM the canonical
 * vocabulary; healing silently on write teaches nothing.
 */
export const LEGACY_CATEGORY_MAP: { readonly [legacy: string]: RuleCategory } = {
  // Singular slip, natural English mistake.
  permission: 'permissions',
  // Pre-canonical vocab from earlier drafts.
  behavior: 'business',
  precondition: 'validation',
  rendering: 'ux_feedback',
  ui: 'ux_feedback',
  visibility: 'ux_feedback'
};

const VALID = new Set<string>(ALL_RULE_CATEGORIES);

const normalizeCategory = (category: unknown): RuleCategory | string => {
  const c = String(category);
  if (VALID.has(c)) return c as RuleCategory;
  if (c in LEGACY_CATEGORY_MAP) return LEGACY_CATEGORY_MAP[c]!;
  return c; // Unknown and not in the legacy map, let the validator reject.
};

const normalizeRule = (rule: Rule): Rule => {
  const next = normalizeCategory(rule.category);
  return next === rule.category ? rule : { ...rule, category: next as RuleCategory };
};

const normalizeAction = (action: Action): Action => {
  let touched = false;
  const rules = action.rules.map((r) => {
    const next = normalizeRule(r);
    if (next !== r) touched = true;
    return next;
  });
  return touched ? { ...action, rules } : action;
};

const normalizeSurface = (surface: Surface): Surface => {
  let touched = false;
  const rules = surface.rules.map((r) => {
    const next = normalizeRule(r);
    if (next !== r) touched = true;
    return next;
  });
  const actions = surface.actions.map((a) => {
    const next = normalizeAction(a);
    if (next !== a) touched = true;
    return next;
  });
  return touched ? { ...surface, rules, actions } : surface;
};

/**
 * Rewrite legacy rule categories to their canonical RuleCategory. Pure;
 * idempotent. Unknown categories pass through unchanged so the validator
 * can surface them with a precise error.
 */
export const normalizeFeatureRuleCategories = (feature: Feature): Feature => ({
  ...feature,
  surfaces: feature.surfaces.map(normalizeSurface)
});
