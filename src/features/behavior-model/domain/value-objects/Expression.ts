import type { StatePath, StateSnapshot } from './StatePath';
import { readPath } from './StatePath';
import type { StateValue } from './StateValue';
import {
  isCompositeCondition,
  isParamLeft,
  isQuantifierCondition,
  type RuleCondition
} from './RuleCondition';
import type { Operator } from './Operator';

/**
 * Small typed AST for values that need to compute against state and parameters
 * at evaluation time. Used in two places:
 *   - `RuleCondition.right`. So rules can compare state-to-state and
 *     state-to-parameter, not just state-to-literal.
 *   - `SetStateEffect.value`. So a tick can write `vx + ax`, `count + 1`,
 *     `min(health, 100)`, etc., instead of forcing the LLM to encode the
 *     computation in capturedFields prose.
 *
 * Discrimination strategy:
 *   The runtime accepts either an `Expression` or a raw `StateValue` for these
 *   slots. The two are distinguished by structure: an object that has a string
 *   `kind` field matching one of the EXPRESSION_KINDS below is treated as an
 *   Expression. Anything else (primitive, array, plain object without that
 *   shape) is treated as a literal.
 *
 *   Consequence: a literal state value that *happens* to be an object with
 *   `kind: "state"` etc. cannot be stored as a bare literal. Wrap it explicitly
 *   as `{ kind: 'literal', value: <the-object> }`.
 */
export type Expression =
  | { readonly kind: 'literal'; readonly value: StateValue }
  | { readonly kind: 'state'; readonly path: StatePath }
  | { readonly kind: 'param'; readonly name: string }
  | { readonly kind: 'add'; readonly left: Expression; readonly right: Expression }
  | { readonly kind: 'sub'; readonly left: Expression; readonly right: Expression }
  | { readonly kind: 'mul'; readonly left: Expression; readonly right: Expression }
  | { readonly kind: 'div'; readonly left: Expression; readonly right: Expression }
  | { readonly kind: 'mod'; readonly left: Expression; readonly right: Expression }
  | { readonly kind: 'min'; readonly left: Expression; readonly right: Expression }
  | { readonly kind: 'max'; readonly left: Expression; readonly right: Expression }
  | { readonly kind: 'neg'; readonly operand: Expression }
  | { readonly kind: 'not'; readonly operand: Expression }
  | { readonly kind: 'sum'; readonly operand: Expression }
  | { readonly kind: 'count'; readonly operand: Expression }
  | {
      readonly kind: 'sum_pluck';
      readonly operand: Expression;
      readonly field: string;
    }
  | {
      readonly kind: 'count_where';
      readonly operand: Expression;
      readonly field: string;
      readonly equals: Expression;
    }
  | {
      /**
       * Declarative case/branch: picks the FIRST case whose `when` condition
       * evaluates true and returns its `then` Expression; falls through to
       * `default` if no case matches. Designed for "enrolled-if-seats-else-
       * waitlisted" patterns that otherwise require 4 rules with careful
       * ordering. The `when` is a full RuleCondition (composite or leaf).
       */
      readonly kind: 'switch';
      readonly cases: readonly {
        readonly when: RuleCondition;
        readonly then: Expression;
      }[];
      readonly default: Expression;
    };

export const EXPRESSION_KINDS = [
  'literal',
  'state',
  'param',
  'add',
  'sub',
  'mul',
  'div',
  'mod',
  'min',
  'max',
  'neg',
  'not',
  'sum',
  'count',
  'sum_pluck',
  'count_where',
  'switch'
] as const;

const EXPRESSION_KIND_SET = new Set<string>(EXPRESSION_KINDS);

/**
 * Type guard: an object with a string `kind` whose value names a known
 * expression node. Used by the evaluator to decide whether a `right` or
 * `value` slot is an Expression or a literal.
 */
export const isExpression = (v: unknown): v is Expression => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const k = (v as { kind?: unknown }).kind;
  return typeof k === 'string' && EXPRESSION_KIND_SET.has(k);
};

export type EvaluationContext = {
  readonly snapshot: StateSnapshot;
  readonly parameters: { readonly [name: string]: StateValue };
};

// ISO 8601 calendar date / datetime / time-of-day, same shape used by
// RuleEvaluator's compare. Inlined here so this module owns full condition
// evaluation (the `switch` Expression's `when` is a RuleCondition, and
// resolving the cycle by keeping evaluation in one place keeps imports flat).
const ISO_DATE_RE_LOCAL =
  /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const isIsoDateStringLocal = (v: unknown): v is string =>
  typeof v === 'string' && ISO_DATE_RE_LOCAL.test(v);

const compareLocal = (
  left: StateValue | undefined,
  operator: Operator,
  right: StateValue | undefined
): boolean => {
  switch (operator) {
    case 'equals':
      return deepEqualValue(left, right);
    case 'not_equals':
      return !deepEqualValue(left, right);
    case 'greater_than':
      if (typeof left === 'number' && typeof right === 'number') return left > right;
      if (isIsoDateStringLocal(left) && isIsoDateStringLocal(right)) return left > right;
      return false;
    case 'greater_or_equal':
      if (typeof left === 'number' && typeof right === 'number') return left >= right;
      if (isIsoDateStringLocal(left) && isIsoDateStringLocal(right)) return left >= right;
      return false;
    case 'lower_than':
      if (typeof left === 'number' && typeof right === 'number') return left < right;
      if (isIsoDateStringLocal(left) && isIsoDateStringLocal(right)) return left < right;
      return false;
    case 'lower_or_equal':
      if (typeof left === 'number' && typeof right === 'number') return left <= right;
      if (isIsoDateStringLocal(left) && isIsoDateStringLocal(right)) return left <= right;
      return false;
    case 'contains':
      if (Array.isArray(left)) return left.some((item) => deepEqualValue(item, right));
      if (typeof left === 'string' && typeof right === 'string') return left.includes(right);
      return false;
    case 'is_true':
      return left === true;
    case 'is_false':
      return left === false;
    case 'exists':
      return left !== undefined && left !== null;
    case 'does_not_exist':
      return left === undefined || left === null;
  }
};

/**
 * Evaluate a RuleCondition into a boolean. Lives here (not RuleEvaluator)
 * so the `switch` Expression's `when` slot can be evaluated without a
 * module cycle. RuleEvaluator re-exports this as `evaluateCondition` for
 * backward compatibility; all existing callers (simulator, invariant
 * checker, scenarios) use the re-export.
 *
 * A `null` / `undefined` condition evaluates to TRUE, supporting the
 * "unconditional rule" pattern. Composite conditions (`all` / `any` /
 * `not`) recurse; empty `all` is vacuously true, empty `any` is
 * vacuously false.
 */
export const evaluateConditionInternal = (
  condition: RuleCondition | undefined | null,
  context: EvaluationContext
): boolean => {
  if (condition === undefined || condition === null) return true;
  if (isQuantifierCondition(condition)) {
    const arr = readPath(context.snapshot, condition.overPath);
    // Missing / non-array source: ∀ is vacuously true, ∃ is false.
    if (!Array.isArray(arr)) return condition.kind === 'all_match';
    for (const element of arr) {
      // Bind the current element under `as` so the body reads `as` (scalars)
      // or `as.field` (objects) while still seeing every outer state path.
      const scoped: StateSnapshot = { ...context.snapshot, [condition.as]: element };
      const held = evaluateConditionInternal(condition.where, {
        ...context,
        snapshot: scoped
      });
      if (condition.kind === 'all_match' && !held) return false;
      if (condition.kind === 'any_match' && held) return true;
    }
    // Walked every element: all held ⇒ all_match true; none held ⇒ any_match false.
    return condition.kind === 'all_match';
  }
  if (isCompositeCondition(condition)) {
    if (condition.kind === 'not') {
      return !evaluateConditionInternal(condition.condition, context);
    }
    if (condition.kind === 'all') {
      for (const c of condition.conditions) {
        if (!evaluateConditionInternal(c, context)) return false;
      }
      return true;
    }
    // 'any'
    for (const c of condition.conditions) {
      if (evaluateConditionInternal(c, context)) return true;
    }
    return false;
  }
  const leftValue = isParamLeft(condition.left)
    ? context.parameters[condition.left.name]
    : readPath(context.snapshot, condition.left as StatePath);
  const rightValue = resolveValueOrExpression(condition.right, context);
  return compareLocal(leftValue, condition.operator, rightValue);
};

// Structural equality for two StateValue-shaped values. Inlined here (not
// imported from RuleEvaluator) so this module stays an evaluator with no
// upward dependency. Exported so collection-mutation effects (remove/update by
// match) compare element fields with the exact same semantics conditions use.
export const deepEqualValue = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEqualValue(item, b[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  const bk = Object.keys(bo);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => deepEqualValue(ao[k], bo[k]));
};

/**
 * Evaluate an Expression into a concrete StateValue. Numeric operators short-
 * circuit to `undefined` (treated as "no value", which condition operators
 * already handle) when an operand is non-numeric or division by zero would
 * otherwise produce a NaN/Infinity. Keeping the result outside the
 * `number` range would silently break comparisons downstream.
 */
export const evaluateExpression = (
  expression: Expression,
  context: EvaluationContext
): StateValue | undefined => {
  // Defensive: legacy snapshots can hold malformed Expression children
  // (e.g. `right: 1` instead of `{kind:"literal",value:1}`). The normalizer
  // rewrites them on write/import, but we guard here too so callers that
  // recurse into children never see a TypeError. Treat such inputs as
  // literals so `add(state, 1)` still computes correctly.
  if (!isExpression(expression)) {
    return expression as unknown as StateValue;
  }
  switch (expression.kind) {
    case 'literal':
      return expression.value;
    case 'state':
      return readPath(context.snapshot, expression.path);
    case 'param':
      return context.parameters[expression.name];
    case 'neg': {
      const v = evaluateExpression(expression.operand, context);
      return typeof v === 'number' ? -v : undefined;
    }
    case 'not': {
      // Boolean inversion. The "toggle pattern" lives here: write a single
      // set_state with value:{kind:'not', operand:{kind:'state', path:...}}
      // instead of two rules that re-trigger on the value they just wrote.
      // Coerce truthy/falsy values to their boolean before flipping so callers
      // can negate any state slot without an extra equals/not_equals check.
      const v = evaluateExpression(expression.operand, context);
      if (v === undefined) return undefined;
      return !v;
    }
    case 'sum': {
      // Σ over a numeric array. Non-array / non-numeric elements short-
      // circuit to undefined (NOT zero) so the caller doesn't conflate
      // "missing data" with "empty array of zeros". Use with state paths
      // typed `array` whose elements are numbers, e.g. expense.shareAmounts.
      const v = evaluateExpression(expression.operand, context);
      if (!Array.isArray(v)) return undefined;
      let total = 0;
      for (const item of v) {
        if (typeof item !== 'number') return undefined;
        total += item;
      }
      return total;
    }
    case 'count': {
      // Length of an array. Non-array operand returns undefined so authors
      // get a clear "couldn't evaluate" instead of a sneaky 0.
      const v = evaluateExpression(expression.operand, context);
      if (!Array.isArray(v)) return undefined;
      return v.length;
    }
    case 'sum_pluck': {
      // Σ of `field` plucked from each object in an array. The intended use
      // is "sum of share.amount over the shares[] array", array of objects
      // case that `sum` alone (which expects array-of-numbers) can't reach.
      // Non-array operand, non-object elements, or non-numeric fields all
      // short-circuit to undefined so a silent zero never masks a typo.
      const v = evaluateExpression(expression.operand, context);
      if (!Array.isArray(v)) return undefined;
      let total = 0;
      for (const item of v) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
        const raw = (item as Record<string, unknown>)[expression.field];
        if (typeof raw !== 'number') return undefined;
        total += raw;
      }
      return total;
    }
    case 'count_where': {
      // Cardinality of an array filtered by `elem[field] === <equals>`.
      // The "count enrolled across cohorts" / "count items where status=X"
      // pattern. Non-array operand returns undefined. Per-element field is
      // compared via deep-equals so the `equals` Expression can yield any
      // StateValue, not just primitives.
      const arr = evaluateExpression(expression.operand, context);
      if (!Array.isArray(arr)) return undefined;
      const target = evaluateExpression(expression.equals, context);
      let n = 0;
      for (const item of arr) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const raw = (item as Record<string, unknown>)[expression.field];
        if (deepEqualValue(raw, target)) n += 1;
      }
      return n;
    }
    case 'switch': {
      // First case whose `when` condition holds wins. Falls through to
      // `default` when no case matches. Use for "enroll if seats available
      // else waitlist" patterns, collapses 4 rules + careful ordering
      // into one set_state with a declarative value.
      for (const c of expression.cases) {
        if (evaluateConditionInternal(c.when, context)) {
          return evaluateExpression(c.then, context);
        }
      }
      return evaluateExpression(expression.default, context);
    }
    case 'add':
    case 'sub':
    case 'mul':
    case 'div':
    case 'mod':
    case 'min':
    case 'max': {
      const l = evaluateExpression(expression.left, context);
      const r = evaluateExpression(expression.right, context);
      if (typeof l !== 'number' || typeof r !== 'number') return undefined;
      switch (expression.kind) {
        case 'add':
          return l + r;
        case 'sub':
          return l - r;
        case 'mul':
          return l * r;
        case 'div':
          return r === 0 ? undefined : l / r;
        case 'mod':
          return r === 0 ? undefined : l % r;
        case 'min':
          return Math.min(l, r);
        case 'max':
          return Math.max(l, r);
      }
    }
  }
};

/**
 * Resolve either a literal StateValue or an Expression to a concrete value
 * (or undefined when the expression couldn't be computed). This is the
 * single entry point conditions and effects use so callers don't have to
 * branch on `isExpression` themselves.
 */
export const resolveValueOrExpression = (
  v: StateValue | Expression | undefined,
  context: EvaluationContext
): StateValue | undefined => {
  if (v === undefined) return undefined;
  if (isExpression(v)) return evaluateExpression(v, context);
  return v;
};

/**
 * Recursively normalize an Expression tree so every internal child is itself
 * a well-formed Expression node. Slots that accept `StateValue | Expression`
 * pass raw literals untouched, but the *children* of arithmetic nodes are
 * typed as Expression and must carry a `kind`. A JSON payload like
 * `{ kind: "add", left: { kind: "state", path: "x" }, right: 1 }` is a common
 * authoring mistake: the top-level slot would accept `1` as a literal, but
 * here `1` is buried in `right` where consumers (evaluator, scorer) recurse
 * unconditionally and either silently return undefined or crash.
 *
 * This normalizer wraps any non-Expression child as `{ kind: "literal",
 * value }` so every downstream walker can recurse without guarding. It is
 * idempotent and a no-op for already-well-formed trees.
 *
 * Top-level non-Expression input is returned as-is (it's a valid literal at
 * the outer slot).
 */
export const normalizeExpression = (
  value: StateValue | Expression | undefined
): StateValue | Expression | undefined => {
  if (value === undefined) return undefined;
  if (!isExpression(value)) return value;
  switch (value.kind) {
    case 'literal':
    case 'state':
    case 'param':
      return value;
    case 'neg':
      return { kind: 'neg', operand: normalizeExpressionChild(value.operand) };
    case 'not':
      return { kind: 'not', operand: normalizeExpressionChild(value.operand) };
    case 'sum':
      return { kind: 'sum', operand: normalizeExpressionChild(value.operand) };
    case 'count':
      return { kind: 'count', operand: normalizeExpressionChild(value.operand) };
    case 'sum_pluck':
      return {
        kind: 'sum_pluck',
        operand: normalizeExpressionChild(value.operand),
        field: value.field
      };
    case 'count_where':
      return {
        kind: 'count_where',
        operand: normalizeExpressionChild(value.operand),
        field: value.field,
        equals: normalizeExpressionChild(value.equals)
      };
    case 'switch':
      // Conditions can stay as-is (RuleCondition has its own normalizer path
      // via the feature normalizer's normalizeCondition); only the `then`
      // and `default` Expression slots need recursive normalization here.
      return {
        kind: 'switch',
        cases: value.cases.map((c) => ({
          when: c.when,
          then: normalizeExpressionChild(c.then)
        })),
        default: normalizeExpressionChild(value.default)
      };
    case 'add':
    case 'sub':
    case 'mul':
    case 'div':
    case 'mod':
    case 'min':
    case 'max':
      return {
        kind: value.kind,
        left: normalizeExpressionChild(value.left),
        right: normalizeExpressionChild(value.right)
      };
  }
};

const normalizeExpressionChild = (child: unknown): Expression => {
  if (!isExpression(child)) {
    return { kind: 'literal', value: child as StateValue };
  }
  // Already an Expression: recurse to normalize its own descendants.
  return normalizeExpression(child) as Expression;
};
