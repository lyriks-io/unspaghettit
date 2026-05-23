<script lang="ts">
  import type { Rule } from '$features/behavior-model/domain/entities/Rule';
  import type { Effect } from '$features/behavior-model/domain/value-objects/Effect';
  import {
    ALL_OPERATORS,
    operatorLabel,
    operatorRequiresRightOperand,
    type Operator
  } from '$features/behavior-model/domain/value-objects/Operator';
  import {
    ALL_RULE_CATEGORIES,
    ruleCategoryLabel,
    type RuleCategory
  } from '$features/behavior-model/domain/value-objects/RuleCategory';
  import {
    isCompositeCondition,
    type LeafRuleCondition
  } from '$features/behavior-model/domain/value-objects/RuleCondition';
  import {
    isStatePath,
    asStatePath,
    type StatePath
  } from '$features/behavior-model/domain/value-objects/StatePath';
  import EffectEditor from './EffectEditor.svelte';
  import StatePathSelect from './StatePathSelect.svelte';
  import ConditionRightEditor from './ConditionRightEditor.svelte';

  type Props = {
    rule: Rule;
    availablePaths: readonly StatePath[];
    onChange: (next: Rule) => void;
    onRemove: () => void;
  };
  let { rule, availablePaths, onChange, onRemove }: Props = $props();

  // The form fields below speak the leaf {left, operator, right} shape.
  // Composite (`all`/`any`/`not`) and unconditional rules are visible but
  // read-only here, edit them via apply_batch where the structured form
  // is first-class.
  const isLeafEditable = $derived(
    rule.condition !== undefined && !isCompositeCondition(rule.condition)
  );
  const leaf = $derived(
    isLeafEditable ? (rule.condition as LeafRuleCondition) : null
  );

  function patchCondition(patch: Partial<LeafRuleCondition>) {
    if (leaf === null) return;
    const next: Rule = {
      ...rule,
      condition: { ...leaf, ...patch }
    };
    onChange(next);
  }

  function updatePath(value: string) {
    if (!isStatePath(value)) return;
    patchCondition({ left: asStatePath(value) });
  }

  function updateOperator(op: Operator) {
    if (leaf === null) return;
    const requiresRight = operatorRequiresRightOperand(op);
    const next: Rule = {
      ...rule,
      condition: {
        left: leaf.left,
        operator: op,
        ...(requiresRight ? { right: leaf.right ?? '' } : {})
      }
    };
    onChange(next);
  }

  function updateCategory(c: RuleCategory) {
    onChange({ ...rule, category: c });
  }

  function updateEffect(effect: Effect) {
    onChange({ ...rule, effect });
  }

  function updateDescription(value: string) {
    onChange({ ...rule, description: value.trim() || undefined });
  }

  // Toggle between the three shapes of condition the language supports:
  // leaf (the default), unconditional (always fires), composite (all/any/not).
  // Composite gets a JSON editor, full tree authoring with native JSON, since
  // building a recursive visual editor would dwarf the rest of this surface.
  function makeUnconditional() {
    const next: Rule = { ...rule };
    delete (next as { condition?: unknown }).condition;
    onChange(next);
  }

  function addLeafCondition() {
    const fallback = availablePaths[0] ?? asStatePath('state.path');
    onChange({
      ...rule,
      condition: { left: fallback, operator: 'is_true' }
    });
  }

  function startComposite(kind: 'all' | 'any') {
    // Seed with the current leaf (if any) so toggling doesn't lose work.
    const seed = leaf
      ? [{ left: leaf.left, operator: leaf.operator, ...(leaf.right !== undefined ? { right: leaf.right } : {}) }]
      : [];
    onChange({ ...rule, condition: { kind, conditions: seed } });
  }

  let compositeDraft = $state('');
  let compositeError = $state<string | null>(null);
  $effect(() => {
    // Refresh the textarea any time the rule's composite shape changes from
    // outside (e.g. a different rule selected). $effect keeps the draft in
    // step without trapping user keystrokes, we only re-sync when the
    // outer value visibly differs from the parsed draft.
    if (rule.condition !== undefined && isCompositeCondition(rule.condition)) {
      const formatted = JSON.stringify(rule.condition, null, 2);
      if (compositeDraft.trim().length === 0) compositeDraft = formatted;
    }
  });

  function commitComposite() {
    try {
      const parsed = JSON.parse(compositeDraft);
      if (!parsed || typeof parsed !== 'object' || !('kind' in parsed)) {
        compositeError = 'Top-level must be an object with `kind: "all" | "any" | "not"`.';
        return;
      }
      const k = (parsed as { kind?: string }).kind;
      if (k !== 'all' && k !== 'any' && k !== 'not') {
        compositeError = '`kind` must be "all", "any", or "not".';
        return;
      }
      compositeError = null;
      onChange({ ...rule, condition: parsed as typeof rule.condition });
    } catch (e) {
      compositeError = (e as Error).message;
    }
  }
</script>

<div class="space-y-2 rounded-md border border-slate-200 bg-white p-3">
  <div class="flex items-center gap-2">
    <select
      class="rounded-md border border-slate-300 px-2 py-1 text-xs"
      value={rule.category}
      onchange={(e) => updateCategory((e.target as HTMLSelectElement).value as RuleCategory)}
    >
      {#each ALL_RULE_CATEGORIES as c}
        <option value={c}>{ruleCategoryLabel(c)}</option>
      {/each}
    </select>
    <span class="flex-1"></span>
    <button
      type="button"
      class="text-xs text-slate-400 hover:text-red-600"
      onclick={onRemove}
      aria-label="Remove rule"
    >
      Remove
    </button>
  </div>

  <div class="rounded-md bg-slate-50 p-3">
    <!-- Mode picker: leaf (default) / unconditional / composite. -->
    <div class="mb-2 flex flex-wrap items-center gap-1 text-[10px]">
      <span class="text-slate-500">Condition:</span>
      <button
        type="button"
        class="rounded px-1.5 py-0.5 {leaf
          ? 'bg-slate-900 text-white'
          : 'border border-slate-300 text-slate-600 hover:bg-white'}"
        onclick={addLeafCondition}
        disabled={leaf !== null}
        title="One comparison (e.g. count equals 0)"
      >
        Single
      </button>
      <button
        type="button"
        class="rounded px-1.5 py-0.5 {rule.condition !== undefined && isCompositeCondition(rule.condition) && (rule.condition as { kind: string }).kind === 'all'
          ? 'bg-slate-900 text-white'
          : 'border border-slate-300 text-slate-600 hover:bg-white'}"
        onclick={() => startComposite('all')}
        title="ALL conditions must hold (logical AND)"
      >
        All of
      </button>
      <button
        type="button"
        class="rounded px-1.5 py-0.5 {rule.condition !== undefined && isCompositeCondition(rule.condition) && (rule.condition as { kind: string }).kind === 'any'
          ? 'bg-slate-900 text-white'
          : 'border border-slate-300 text-slate-600 hover:bg-white'}"
        onclick={() => startComposite('any')}
        title="ANY condition holds (logical OR)"
      >
        Any of
      </button>
      <button
        type="button"
        class="rounded px-1.5 py-0.5 {rule.condition === undefined
          ? 'bg-slate-900 text-white'
          : 'border border-slate-300 text-slate-600 hover:bg-white'}"
        onclick={makeUnconditional}
        title="Effect always fires when the action runs"
      >
        Always
      </button>
    </div>

    {#if leaf}
      <div class="flex flex-wrap items-start gap-2 text-sm">
        <span class="mt-1.5 font-mono text-xs text-slate-500">IF</span>
        <StatePathSelect
          value={leaf.left}
          {availablePaths}
          onCommit={updatePath}
        />
        <select
          class="mt-0.5 rounded-md border border-slate-300 px-2 py-1 text-xs"
          value={leaf.operator}
          onchange={(e) => updateOperator((e.target as HTMLSelectElement).value as Operator)}
        >
          {#each ALL_OPERATORS as op}
            <option value={op}>{operatorLabel(op)}</option>
          {/each}
        </select>
        {#if operatorRequiresRightOperand(leaf.operator)}
          <ConditionRightEditor
            value={leaf.right}
            {availablePaths}
            onChange={(right) => patchCondition({ right })}
          />
        {/if}
      </div>
    {:else if rule.condition === undefined}
      <div class="rounded-md border border-dashed border-slate-300 bg-white p-2 text-xs italic text-slate-500">
        Unconditional, this rule's effect always fires when the action runs.
      </div>
    {:else}
      <div class="space-y-1">
        <p class="text-[11px] text-slate-500">
          Composite condition (<span class="font-mono">{(rule.condition as { kind: string }).kind}</span>). Edit the tree as JSON.
          Each item may itself be a leaf <span class="mono">{`{left, operator, right}`}</span> or
          another composite <span class="mono">{`{kind, conditions}`}</span>.
        </p>
        <textarea
          class="mono min-h-32 w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
          bind:value={compositeDraft}
          onblur={commitComposite}
        ></textarea>
        {#if compositeError}
          <p class="text-[11px] text-red-600">{compositeError}</p>
        {:else}
          <p class="text-[11px] text-slate-500">
            Saved on blur. Switch back to "Single" to use the visual editor.
          </p>
        {/if}
      </div>
    {/if}
    <div class="mt-2 flex items-start gap-2 text-sm">
      <span class="mt-2 font-mono text-xs text-slate-500">THEN</span>
      <div class="flex-1">
        <EffectEditor effect={rule.effect} {availablePaths} onChange={updateEffect} />
      </div>
    </div>
  </div>

  <input
    type="text"
    placeholder="Optional rationale"
    value={rule.description ?? ''}
    onblur={(e) => updateDescription((e.target as HTMLInputElement).value)}
    class="w-full rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600"
  />
</div>
