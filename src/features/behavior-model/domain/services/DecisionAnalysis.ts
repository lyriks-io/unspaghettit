import type { Action } from '../entities/Action';
import type { Rule } from '../entities/Rule';
import type { Effect } from '../value-objects/Effect';
import { isExpression } from '../value-objects/Expression';
import {
  isCompositeCondition,
  isParamLeft,
  isQuantifierCondition,
  type LeafRuleCondition,
  type RuleCondition
} from '../value-objects/RuleCondition';

/**
 * Decision-table analysis for an action's rules: which branches contradict,
 * duplicate, shadow, or can never fire. Every finding is PROVABLE from the
 * spec, never a guess. Full satisfiability of arbitrary conditions is
 * undecidable, so this is deliberately sound-but-incomplete: it reports only
 * defects it can demonstrate (structural equality, a conjunction that requires
 * a state to hold two values at once, an unconditional block that suppresses
 * everything after it), and stays silent where it cannot prove a problem.
 *
 * Kept in the domain layer so maturity, spec-gap diagnostics, and any future
 * decision-coverage view all agree on what counts as a broken decision.
 */
export type DecisionFindingKind =
  | 'dead-rule'
  | 'conflicting-rules'
  | 'redundant-rule'
  | 'shadowed-rule'
  | 'always-blocked';

export type DecisionFinding = {
  readonly kind: DecisionFindingKind;
  readonly severity: 'critical' | 'recommended';
  /** Ordinal positions (1-based) of the rules involved, in author order. */
  readonly rulePositions: readonly number[];
  readonly detail: string;
};

/**
 * Deterministic structural fingerprint. Sorts object keys and drops the given
 * keys (used to ignore an effect's unique `id` and human `description` so two
 * effects that DO the same thing compare equal).
 */
const canonical = (value: unknown, omit: ReadonlySet<string> = new Set()): string => {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') {
      const source = v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(source).sort()) {
        if (omit.has(key)) continue;
        out[key] = norm(source[key]);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(norm(value));
};

const EFFECT_OMIT = new Set(['id', 'description']);

const sameCondition = (a: RuleCondition | undefined, b: RuleCondition | undefined): boolean =>
  canonical(a) === canonical(b);

const sameEffect = (a: Effect, b: Effect): boolean =>
  canonical(a, EFFECT_OMIT) === canonical(b, EFFECT_OMIT);

/**
 * Two effects that would fight if both applied on the same run: the same state
 * path written to different values, or one allowing while the other blocks.
 */
const effectsConflict = (a: Effect, b: Effect): boolean => {
  if (a.type === 'set_state' && b.type === 'set_state' && String(a.path) === String(b.path)) {
    return canonical(a.value) !== canonical(b.value);
  }
  const kinds = new Set([a.type, b.type]);
  return kinds.has('allow_action') && kinds.has('block_action');
};

/**
 * The leaf comparisons a condition requires to ALL hold. Only descends the
 * top-level conjunction (`all`): an `any`/`not`/quantifier subtree is not a
 * plain conjunction, so we conservatively stop there rather than risk an
 * unsound contradiction claim.
 */
const conjunctionLeaves = (condition: RuleCondition | undefined): readonly LeafRuleCondition[] => {
  if (!condition) return [];
  if (isCompositeCondition(condition)) {
    return condition.kind === 'all' ? condition.conditions.flatMap(conjunctionLeaves) : [];
  }
  if (isQuantifierCondition(condition)) return [];
  return [condition];
};

const isLiteralRight = (leaf: LeafRuleCondition): boolean =>
  leaf.right !== undefined && !isExpression(leaf.right);

/**
 * True when a condition can never hold because its conjunction demands a single
 * state path take two incompatible values at once (equals two literals, is both
 * true and false, must equal and must-not-equal the same value, must exist and
 * not exist). Sound: every case is a genuine unsatisfiable requirement.
 */
const isSelfContradictory = (condition: RuleCondition | undefined): boolean => {
  const byPath = new Map<
    string,
    { mustEqual: Set<string>; mustNotEqual: Set<string>; exists: boolean; absent: boolean }
  >();
  for (const leaf of conjunctionLeaves(condition)) {
    if (isParamLeft(leaf.left)) continue;
    const key = String(leaf.left);
    const slot =
      byPath.get(key) ??
      { mustEqual: new Set<string>(), mustNotEqual: new Set<string>(), exists: false, absent: false };
    switch (leaf.operator) {
      case 'is_true':
        slot.mustEqual.add('true');
        slot.exists = true;
        break;
      case 'is_false':
        slot.mustEqual.add('false');
        slot.exists = true;
        break;
      case 'exists':
        slot.exists = true;
        break;
      case 'does_not_exist':
        slot.absent = true;
        break;
      case 'equals':
        if (isLiteralRight(leaf)) slot.mustEqual.add(canonical(leaf.right));
        slot.exists = true;
        break;
      case 'not_equals':
        if (isLiteralRight(leaf)) slot.mustNotEqual.add(canonical(leaf.right));
        break;
      default:
        break;
    }
    byPath.set(key, slot);
  }
  for (const slot of byPath.values()) {
    if (slot.mustEqual.size > 1) return true;
    for (const value of slot.mustEqual) if (slot.mustNotEqual.has(value)) return true;
    if (slot.exists && slot.absent) return true;
    if (slot.absent && slot.mustEqual.size > 0) return true;
  }
  return false;
};

const ruleLabel = (rule: Rule, position: number): string =>
  rule.description?.trim() ? `"${rule.description.trim()}"` : `#${position} (${rule.category})`;

/**
 * Analyse one action's rule set for decision-table defects. Order matters:
 * rules apply top-to-bottom and a `block_action` suppresses every later effect,
 * so an unconditional block makes everything after it inert.
 */
export const analyzeActionDecisions = (action: Action): readonly DecisionFinding[] => {
  const rules = action.rules;
  const findings: DecisionFinding[] = [];
  const inert = new Set<number>();

  rules.forEach((rule, index) => {
    if (isSelfContradictory(rule.condition)) {
      inert.add(index);
      findings.push({
        kind: 'dead-rule',
        severity: 'critical',
        rulePositions: [index + 1],
        detail: `Rule ${ruleLabel(rule, index + 1)} can never fire: its condition requires a state to hold two incompatible values at once.`
      });
    }
  });

  const blockIndex = rules.findIndex(
    (rule) => rule.condition === undefined && rule.effect.type === 'block_action'
  );
  if (blockIndex >= 0) {
    const blockRule = rules[blockIndex]!;
    findings.push({
      kind: 'always-blocked',
      severity: 'recommended',
      rulePositions: [blockIndex + 1],
      detail: `Rule ${ruleLabel(blockRule, blockIndex + 1)} blocks unconditionally, so this action can never succeed and its success effects never run.`
    });
    for (let after = blockIndex + 1; after < rules.length; after++) {
      inert.add(after);
      findings.push({
        kind: 'shadowed-rule',
        severity: 'recommended',
        rulePositions: [after + 1],
        detail: `Rule ${ruleLabel(rules[after]!, after + 1)} runs after an unconditional block, so its effect is always suppressed.`
      });
    }
  }

  for (let i = 0; i < rules.length; i++) {
    if (inert.has(i)) continue;
    const left = rules[i]!;
    for (let j = i + 1; j < rules.length; j++) {
      if (inert.has(j)) continue;
      const right = rules[j]!;
      if (!sameCondition(left.condition, right.condition)) continue;
      if (sameEffect(left.effect, right.effect)) {
        findings.push({
          kind: 'redundant-rule',
          severity: 'recommended',
          rulePositions: [i + 1, j + 1],
          detail: `Rules #${i + 1} and #${j + 1} share the same condition and the same effect; one is redundant.`
        });
      } else if (effectsConflict(left.effect, right.effect)) {
        findings.push({
          kind: 'conflicting-rules',
          severity: 'critical',
          rulePositions: [i + 1, j + 1],
          detail: `Rules #${i + 1} and #${j + 1} fire on the same condition but their effects disagree, so the outcome depends on rule order rather than intent.`
        });
      }
    }
  }

  return findings;
};
