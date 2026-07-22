import type { Feature } from '../../entities/Feature';
import { ALL_ACTION_OUTCOME_KINDS } from '../../entities/ActionOutcome';
import { ALL_EFFECT_TYPES } from '../../value-objects/Effect';
import { ALL_OPERATORS, operatorRequiresRightOperand, type Operator } from '../../value-objects/Operator';

/**
 * Deep SHAPE validation for the elements the engine later executes.
 *
 * The reference-integrity pass answers "do the ids and state paths resolve?".
 * This pass answers the question underneath it: "is this thing even a
 * well-formed rule / invariant / effect / assertion?". They are separate
 * because a malformed shape doesn't dangle — it evaluates. An unknown operator
 * falls through the evaluator's comparison switch to `false`, a leaf missing
 * its `right` compares against `undefined`, an `all` node with no `conditions`
 * is vacuously true. Each of those turns a guard the author wrote into a guard
 * that silently never fires (or always fires), which is worse than a crash:
 * `dry_run`/`apply_batch` reported `valid: true` and the spec looked authored.
 *
 * Everything here is checked against the REAL runtime vocabulary
 * (`ALL_OPERATORS`, `KNOWN_EFFECT_TYPES`, the outcome/goal kind enums), not a
 * parallel schema that can drift from it.
 */

const KNOWN_EFFECT_TYPES = new Set<string>(ALL_EFFECT_TYPES);
const effectTypeList = ALL_EFFECT_TYPES.join(', ');

const OPERATOR_SET = new Set<string>(ALL_OPERATORS);

const COMPOSITE_KINDS = new Set<string>(['all', 'any', 'not']);
const QUANTIFIER_KINDS = new Set<string>(['all_match', 'any_match']);

const operatorList = ALL_OPERATORS.join(', ');

/** A non-empty string, the bar every name/path/id slot has to clear. */
const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

/**
 * Validate one operator slot (rule/invariant condition leaf, scenario
 * assertion). `requiresRight` reports whether the operator is binary, so the
 * caller can check the right-hand operand it governs.
 */
const checkOperator = (
  errors: string[],
  label: string,
  raw: unknown
): { readonly valid: boolean; readonly requiresRight: boolean } => {
  if (raw === undefined || raw === null) {
    errors.push(`${label}: missing "operator". One of: ${operatorList}.`);
    return { valid: false, requiresRight: false };
  }
  if (typeof raw !== 'string' || !OPERATOR_SET.has(raw)) {
    errors.push(
      `${label}: unknown operator ${JSON.stringify(raw)}. One of: ${operatorList}.`
    );
    return { valid: false, requiresRight: false };
  }
  return { valid: true, requiresRight: operatorRequiresRightOperand(raw as Operator) };
};

/**
 * Walk a condition tree and reject every node the evaluator would silently
 * mis-handle. Depth-limited: a hand-edited snapshot can hold a cyclic
 * structure, and the walk must not be the thing that hangs the server.
 */
const checkCondition = (
  errors: string[],
  label: string,
  node: unknown,
  depth = 0
): void => {
  if (node === undefined || node === null) return; // unconditional is legal
  if (typeof node !== 'object') {
    errors.push(
      `${label}: condition must be an object ({ left, operator, right? }, { kind:"all"|"any"|"not", … }, or { kind:"all_match"|"any_match", … }), got ${JSON.stringify(node)}.`
    );
    return;
  }
  if (depth > 32) {
    errors.push(`${label}: condition nests deeper than 32 levels. Flatten it.`);
    return;
  }
  const raw = node as Record<string, unknown>;
  const kind = raw.kind;

  if (typeof kind === 'string' && COMPOSITE_KINDS.has(kind)) {
    if (kind === 'not') {
      if (raw.condition === undefined || raw.condition === null) {
        errors.push(`${label}: { kind:"not" } needs a "condition" to negate.`);
        return;
      }
      checkCondition(errors, `${label} › not`, raw.condition, depth + 1);
      return;
    }
    const children = raw.conditions;
    if (!Array.isArray(children)) {
      errors.push(`${label}: { kind:"${kind}" } needs a "conditions" array.`);
      return;
    }
    if (children.length === 0) {
      // `all: []` is vacuously true and `any: []` vacuously false — either way
      // the author wrote a guard that can never do what they meant.
      errors.push(
        `${label}: { kind:"${kind}", conditions: [] } is empty, so it is constant (${kind === 'all' ? 'always true' : 'always false'}). Add at least one condition or drop the composite.`
      );
      return;
    }
    children.forEach((child, index) =>
      checkCondition(errors, `${label} › ${kind}[${index}]`, child, depth + 1)
    );
    return;
  }

  if (typeof kind === 'string' && QUANTIFIER_KINDS.has(kind)) {
    if (!isText(raw.overPath)) {
      errors.push(
        `${label}: { kind:"${kind}" } needs "overPath" — the array-typed state path to quantify over.`
      );
    }
    if (!isText(raw.as)) {
      errors.push(
        `${label}: { kind:"${kind}" } needs "as" — the name each element is bound to inside "where".`
      );
    }
    if (raw.where === undefined || raw.where === null) {
      errors.push(`${label}: { kind:"${kind}" } needs a "where" condition body.`);
    } else {
      checkCondition(errors, `${label} › ${kind}.where`, raw.where, depth + 1);
    }
    return;
  }

  if (kind !== undefined) {
    // Anything else carrying a `kind` is treated as a LEAF by the flattener,
    // so it would sail past every downstream walker while never evaluating as
    // the combinator the author intended.
    errors.push(
      `${label}: unknown condition kind ${JSON.stringify(kind)}. Composites are "all" / "any" / "not"; quantifiers are "all_match" / "any_match"; a leaf carries no "kind".`
    );
    return;
  }

  // Leaf form. A leaf is { left, operator, right? }; any other key is an author
  // reaching for a neighbouring vocabulary (the builder's { path, op, expected },
  // a scenario assertion's { path, operator, value }) and every consumer would
  // read the real slots as undefined — a dead comparison wearing a valid one's
  // clothes. Name the likely intent, not just the offending key.
  const strayLeafKeys = Object.keys(raw).filter(
    (k) => k !== 'left' && k !== 'operator' && k !== 'right'
  );
  if (strayLeafKeys.length > 0) {
    const hint = strayLeafKeys.includes('op')
      ? ' Did you mean "operator"? ("op" is a host UI\'s visibility vocabulary, not the kernel\'s.)'
      : strayLeafKeys.includes('value') || strayLeafKeys.includes('expected')
        ? ' Did you mean "right"?'
        : '';
    errors.push(
      `${label}: condition leaf has unknown key(s) ${strayLeafKeys.map((k) => `"${k}"`).join(', ')}; a leaf is { left, operator, right? }.${hint}`
    );
  }
  if (raw.left === undefined) {
    errors.push(
      `${label}: condition leaf is missing "left" (a state path string, or { kind:"param", name } inside an action).${
        'path' in raw
          ? ' Received a { path, operator, value } shape — that is the SCENARIO assertion shape; a rule condition uses { left, operator, right }.'
          : ''
      }`
    );
  }
  const { requiresRight } = checkOperator(errors, label, raw.operator);
  if (requiresRight && raw.right === undefined) {
    errors.push(
      `${label}: operator "${String(raw.operator)}" compares two operands but "right" is missing, so the comparison is against undefined and never holds. Provide "right" (a literal or an Expression), or use is_true / is_false / exists / does_not_exist.`
    );
  }
};

/** Per-type required fields. `checkEffect` in referenceIntegrity resolves the
 * references these name; this makes sure the slot is filled at all. */
const REQUIRED_EFFECT_FIELDS: Readonly<Record<string, readonly string[]>> = {
  set_state: ['path', 'value'],
  show_message: ['message'],
  emit_event: ['event'],
  block_action: ['reason'],
  allow_action: [],
  transition_surface: ['target'],
  append_to_list: ['path', 'item'],
  remove_from_list: ['path'],
  update_list_item: ['path', 'value'],
  advance_time: ['by'],
  // resultPath / resultValue are optional: an invoke_operation with neither is
  // a legitimate fire-and-forget call.
  invoke_operation: ['dependencyId', 'operation']
};

const checkEffect = (errors: string[], label: string, effect: unknown): void => {
  if (!effect || typeof effect !== 'object') {
    errors.push(`${label}: effect must be an object, got ${JSON.stringify(effect)}.`);
    return;
  }
  const raw = effect as Record<string, unknown>;
  const type = raw.type;
  if (!isText(type)) {
    errors.push(
      `${label}: effect is missing "type". Valid: ${effectTypeList}.`
    );
    return;
  }
  if (!KNOWN_EFFECT_TYPES.has(type)) {
    // referenceIntegrity reports this too, for the effects it walks. Repeating
    // it here covers the slots it doesn't reach (outcome effects) and keeps the
    // shape pass self-contained.
    errors.push(
      `${label}: unknown effect.type "${type}". Valid: ${effectTypeList}.`
    );
    return;
  }
  for (const field of REQUIRED_EFFECT_FIELDS[type] ?? []) {
    if (raw[field] === undefined) {
      errors.push(`${label}: effect type "${type}" requires "${field}".`);
    }
  }
};

const checkRule = (errors: string[], label: string, rule: unknown): void => {
  const raw = rule as Record<string, unknown>;
  checkCondition(errors, label, raw.condition);
  checkEffect(errors, label, raw.effect);
};

/**
 * An Invariant is { name, condition, message } — its `condition` is the thing
 * that must ALWAYS hold. Authors reaching for an implication routinely invent
 * a second field for the consequent (`mustHold`, `then`, `implies`), which is
 * silently dropped: the invariant collapses to "the antecedent must always be
 * true" — the exact inversion of the intent, and typically false by default,
 * so it fires on data that is perfectly legal. The MCP builders reject this
 * against the raw input (see buildInvariant); this covers snapshots that were
 * written by an older engine or edited by hand, where the key survived.
 */
const INVARIANT_CONSEQUENT_KEYS = ['mustHold', 'then', 'implies', 'ensure'];

const checkInvariantShape = (errors: string[], label: string, inv: unknown): void => {
  if (!inv || typeof inv !== 'object') return;
  const stray = INVARIANT_CONSEQUENT_KEYS.filter(
    (k) => (inv as Record<string, unknown>)[k] !== undefined
  );
  if (stray.length > 0) {
    errors.push(
      `${label}: invariant has no ${stray.map((k) => `"${k}"`).join('/')} field — an invariant is { name, condition, message }, and its condition must ALWAYS hold. Writing the consequent separately silently inverts the invariant into "the antecedent must always be true". For "A implies B" use condition: { kind: "any", conditions: [{ kind: "not", condition: A }, B] }.`
    );
  }
};

const checkAssertion = (errors: string[], label: string, assertion: unknown): void => {
  if (!assertion || typeof assertion !== 'object') {
    errors.push(
      `${label}: expectedAssertion must be an object { path, operator, value?, description }.`
    );
    return;
  }
  const raw = assertion as Record<string, unknown>;
  // `path` presence is already enforced in featureShape (with its own hint);
  // here we cover the operator half, which nothing checked before.
  const { requiresRight } = checkOperator(errors, label, raw.operator);
  if (requiresRight && raw.value === undefined) {
    errors.push(
      `${label}: operator "${String(raw.operator)}" compares two operands but "value" is missing, so the assertion can never hold.`
    );
  }
};

const EXPECTED_STATUSES = new Set<string>(['success', 'blocked']);

/**
 * The whole shape pass over one feature. Returns a flat error list so the
 * caller can splice it into its own; `validateFeature` does exactly that.
 */
export const validateElementShapes = (feature: Feature): readonly string[] => {
  const errors: string[] = [];

  for (const inv of feature.featureInvariants ?? []) {
    checkInvariantShape(errors, `Feature invariant ${inv.id}`, inv);
    checkCondition(errors, `Feature invariant ${inv.id}`, inv.condition);
  }
  for (const goal of feature.reachabilityGoals ?? []) {
    checkCondition(errors, `Reachability goal ${goal.id}`, goal.condition);
  }

  for (const surface of feature.surfaces) {
    for (const rule of surface.rules) {
      checkRule(errors, `Surface rule ${rule.id} in surface ${surface.id}`, rule);
    }
    for (const inv of surface.invariants) {
      checkInvariantShape(errors, `Surface invariant ${inv.id} in surface ${surface.id}`, inv);
      checkCondition(errors, `Surface invariant ${inv.id} in surface ${surface.id}`, inv.condition);
    }

    for (const action of surface.actions) {
      for (const rule of action.rules) {
        checkRule(errors, `Rule ${rule.id} in action ${action.id}`, rule);
      }
      for (const inv of action.invariants) {
        checkInvariantShape(errors, `Invariant ${inv.id} in action ${action.id}`, inv);
        checkCondition(errors, `Invariant ${inv.id} in action ${action.id}`, inv.condition);
      }
      for (const effect of action.effects) {
        checkEffect(errors, `Effect ${effect.id} in action ${action.id}`, effect);
      }
      for (const effect of action.onBlockedEffects ?? []) {
        checkEffect(errors, `onBlockedEffect ${effect.id} in action ${action.id}`, effect);
      }
      for (const outcome of action.outcomes ?? []) {
        const label = `Outcome ${outcome.id} in action ${action.id}`;
        if (!ALL_ACTION_OUTCOME_KINDS.includes(outcome.kind)) {
          errors.push(
            `${label}: unknown outcome kind ${JSON.stringify(outcome.kind)}. One of: ${ALL_ACTION_OUTCOME_KINDS.join(', ')}.`
          );
        }
        // A condition-less outcome is the legal catch-all default.
        checkCondition(errors, label, outcome.condition);
        for (const effect of outcome.effects ?? []) {
          checkEffect(errors, `${label} effect ${effect.id}`, effect);
        }
      }

      for (const scenario of action.scenarios ?? []) {
        const label = `Scenario ${scenario.id} in action ${action.id}`;
        if (
          scenario.expectedStatus !== undefined &&
          !EXPECTED_STATUSES.has(String(scenario.expectedStatus))
        ) {
          errors.push(
            `${label}: expectedStatus must be "success" or "blocked" (got ${JSON.stringify(scenario.expectedStatus)}).`
          );
        }
        for (const [index, assertion] of (scenario.expectedAssertions ?? []).entries()) {
          checkAssertion(errors, `${label} expectedAssertions[${index}]`, assertion);
        }
        for (const [index, override] of (scenario.stateOverrides ?? []).entries()) {
          if (!isText((override as { readonly path?: unknown }).path)) {
            errors.push(
              `${label}: stateOverrides[${index}] is missing a "path". Items are { path, value }.`
            );
          }
        }
        for (const [stepIndex, step] of (scenario.steps ?? []).entries()) {
          const stepLabel = `${label} step ${stepIndex}`;
          if (
            step.expectedStatus !== undefined &&
            !EXPECTED_STATUSES.has(String(step.expectedStatus))
          ) {
            errors.push(
              `${stepLabel}: expectedStatus must be "success" or "blocked" (got ${JSON.stringify(step.expectedStatus)}).`
            );
          }
          for (const [index, assertion] of (step.expectedAssertions ?? []).entries()) {
            checkAssertion(errors, `${stepLabel} expectedAssertions[${index}]`, assertion);
          }
        }
      }
    }
  }

  return errors;
};
