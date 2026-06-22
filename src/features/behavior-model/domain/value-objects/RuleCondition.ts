import type { Expression } from './Expression';
import type { Operator } from './Operator';
import type { StatePath } from './StatePath';
import type { StateValue } from './StateValue';

/**
 * A RuleCondition is either a single comparison (the leaf form) or a
 * boolean composition of other conditions (the composite form). The
 * composite form is the answer to "this rule must trigger when A AND B
 * but not C", previously authors had to flatten this into N separate
 * rules sharing an effect, which both bloated the spec and lost the
 * intent.
 *
 * Discrimination strategy: composite nodes carry a `kind` field whose
 * value names a known boolean combinator (`all` / `any` / `not`). Leaf
 * nodes have `left` + `operator`. A guard function (`isCompositeCondition`)
 * does the runtime check so callers stay one-line. Existing leaf-shaped
 * data carries no `kind` field and stays legal forever.
 *
 * The `not` kind here NEGATES a condition's boolean. It is distinct from
 * Expression's `not` (which negates a value). The two never appear at the
 * same nesting level: Expression nodes live inside `LeafRuleCondition.right`,
 * conditions never live inside Expressions. The dispatcher decides which
 * evaluator to use based on whether it's walking a condition tree or an
 * Expression tree.
 *
 * Implication is expressible: `if A then B` ≡ `any: [not(A), B]`.
 */
/**
 * What the rule's left-hand operand reads from.
 *   - `string`: a `StatePath` into the surface's state snapshot. The
 *     legacy/default shape; every existing condition uses this.
 *   - `{ kind: 'param', name }`: the value of one of the parent
 *     action's parameters. Lets rules fork on caller input without
 *     forcing the user to set up a `bindToStatePath` intermediate.
 *     Only valid on **action** rules (surface rules have no parameters
 *     in scope) — the validator rejects param-left on surface rules.
 */
export type LeftOperand =
  | StatePath
  | { readonly kind: 'param'; readonly name: string };

/**
 * Runtime guard: a `{ kind: 'param', name: string }` left operand.
 * Anything else (string state path, malformed input) is treated as a
 * state path by the evaluator.
 */
export const isParamLeft = (
  l: unknown
): l is { kind: 'param'; name: string } => {
  if (!l || typeof l !== 'object') return false;
  const o = l as { kind?: unknown; name?: unknown };
  return o.kind === 'param' && typeof o.name === 'string';
};

export type LeafRuleCondition = {
  readonly left: LeftOperand;
  readonly operator: Operator;
  readonly right?: StateValue | Expression;
};

export type AllCondition = {
  readonly kind: 'all';
  readonly conditions: readonly RuleCondition[];
};

export type AnyCondition = {
  readonly kind: 'any';
  readonly conditions: readonly RuleCondition[];
};

export type NotCondition = {
  readonly kind: 'not';
  readonly condition: RuleCondition;
};

export type CompositeRuleCondition = AllCondition | AnyCondition | NotCondition;

/**
 * Quantifier over the elements of an array-typed state path. `all_match` holds
 * when EVERY element satisfies `where`; `any_match` holds when AT LEAST ONE
 * does. This is the per-element guarantee that `count_where` (a count) and the
 * boolean combinators (over sibling conditions, not elements) could never
 * express — e.g. the invariant "every order line has qty > 0".
 *
 * Evaluation binds each element into the snapshot under the `as` name, then
 * evaluates `where` as an ordinary condition. So with `as: "item"` over an
 * array of objects, the body reads `item.qty`; over an array of scalars it
 * reads `item` directly. The body may also reference outer state paths
 * (e.g. compare `item.qty` to a threshold elsewhere in state).
 *
 * Vacuous truth: `all_match` over a missing/empty array is TRUE, `any_match`
 * is FALSE — the standard ∀/∃ semantics.
 */
export type QuantifierCondition = {
  readonly kind: 'all_match' | 'any_match';
  readonly overPath: StatePath;
  readonly as: string;
  readonly where: RuleCondition;
};

export type RuleCondition =
  | LeafRuleCondition
  | CompositeRuleCondition
  | QuantifierCondition;

/**
 * Runtime guard: a composite condition carries a `kind` matching one of
 * the boolean combinators. Anything else (raw leaf, malformed input,
 * undefined) is treated as a leaf for backward compatibility.
 */
export const isCompositeCondition = (
  c: unknown
): c is CompositeRuleCondition => {
  if (!c || typeof c !== 'object') return false;
  const k = (c as { kind?: unknown }).kind;
  return k === 'all' || k === 'any' || k === 'not';
};

/**
 * Runtime guard: a quantifier condition (`all_match` / `any_match`). Kept
 * separate from `isCompositeCondition` because quantifiers introduce a scoped
 * element binding and so are evaluated/walked differently from the plain
 * boolean combinators.
 */
export const isQuantifierCondition = (
  c: unknown
): c is QuantifierCondition => {
  if (!c || typeof c !== 'object') return false;
  const k = (c as { kind?: unknown }).kind;
  return k === 'all_match' || k === 'any_match';
};

/**
 * Walks a condition tree and yields every leaf comparison it contains.
 * Use when a consumer (path collector, graph builder, indexer) needs to
 * see every `{left, operator, right}` triple regardless of whether the
 * author wrote a single leaf or composed several with `all` / `any` / `not`.
 *
 * Returns an empty list for `undefined` (unconditional rule) so callers
 * can iterate without guarding.
 */
export const flattenLeafConditions = (
  c: RuleCondition | undefined | null
): readonly LeafRuleCondition[] => {
  if (!c) return [];
  const out: LeafRuleCondition[] = [];
  const walk = (node: RuleCondition): void => {
    if (isCompositeCondition(node)) {
      if (node.kind === 'not') walk(node.condition);
      else for (const sub of node.conditions) walk(sub);
      return;
    }
    if (isQuantifierCondition(node)) {
      // Surface the array source as a synthetic `exists` leaf so every
      // path-validator / collector that walks leaves sees the quantified
      // array reference and keeps working unchanged. The body is NOT
      // descended into: its leaves reference the scoped element binding
      // (`as`), which isn't a declared outer state path and would be a false
      // "unknown path" to those consumers. Body evaluation is handled
      // directly by the condition evaluator, which understands the binding.
      out.push({ left: node.overPath, operator: 'exists' });
      return;
    }
    out.push(node);
  };
  walk(c);
  return out;
};
