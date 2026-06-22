<script lang="ts">
  import {
    ALL_REACHABILITY_GOAL_KINDS,
    type ReachabilityGoal,
    type ReachabilityGoalKind
  } from '$features/behavior-model/domain/entities/ReachabilityGoal';
  import {
    ALL_OPERATORS,
    operatorLabel,
    operatorRequiresRightOperand,
    type Operator
  } from '$features/behavior-model/domain/value-objects/Operator';
  import {
    isCompositeCondition,
    type LeafRuleCondition
  } from '$features/behavior-model/domain/value-objects/RuleCondition';
  import {
    isStatePath,
    asStatePath,
    type StatePath
  } from '$features/behavior-model/domain/value-objects/StatePath';
  import StatePathSelect from './StatePathSelect.svelte';
  import ConditionRightEditor from './ConditionRightEditor.svelte';

  type Props = {
    goal: ReachabilityGoal;
    availablePaths: readonly StatePath[];
    onChange: (next: ReachabilityGoal) => void;
    onRemove: () => void;
  };
  let { goal, availablePaths, onChange, onRemove }: Props = $props();

  const KIND_LABEL: Record<ReachabilityGoalKind, string> = {
    reachable: 'Reachable (the target can be reached at all)',
    always_reachable: 'Always reachable (stays reachable from every state)'
  };

  // Composite conditions are edited as JSON here, same as InvariantEditor.
  const leaf = $derived(
    isCompositeCondition(goal.condition) ? null : (goal.condition as LeafRuleCondition)
  );

  function patchCondition(patch: Partial<LeafRuleCondition>) {
    if (leaf === null) return;
    onChange({ ...goal, condition: { ...leaf, ...patch } });
  }

  function updatePath(value: string) {
    if (!isStatePath(value)) return;
    patchCondition({ left: asStatePath(value) });
  }

  function updateOperator(op: Operator) {
    if (leaf === null) return;
    const requiresRight = operatorRequiresRightOperand(op);
    onChange({
      ...goal,
      condition: {
        left: leaf.left,
        operator: op,
        ...(requiresRight ? { right: leaf.right ?? '' } : {})
      }
    });
  }

  function backToLeaf() {
    const fallback = availablePaths[0] ?? asStatePath('state.path');
    onChange({ ...goal, condition: { left: fallback, operator: 'is_true' } });
  }

  function startComposite(kind: 'all' | 'any') {
    const seed = leaf
      ? [{ left: leaf.left, operator: leaf.operator, ...(leaf.right !== undefined ? { right: leaf.right } : {}) }]
      : [];
    onChange({ ...goal, condition: { kind, conditions: seed } });
  }

  let compositeDraft = $state('');
  let compositeError = $state<string | null>(null);
  $effect(() => {
    if (isCompositeCondition(goal.condition)) {
      const formatted = JSON.stringify(goal.condition, null, 2);
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
      onChange({ ...goal, condition: parsed as typeof goal.condition });
    } catch (e) {
      compositeError = (e as Error).message;
    }
  }
</script>

<div class="space-y-2 rounded-md border border-slate-200 bg-white p-3">
  <div class="flex items-center gap-2">
    <input
      type="text"
      class="flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm font-medium"
      value={goal.name}
      onblur={(e) => onChange({ ...goal, name: (e.target as HTMLInputElement).value })}
      placeholder="Goal name"
    />
    <button
      type="button"
      class="text-xs text-slate-400 hover:text-red-600"
      onclick={onRemove}
      aria-label="Remove reachability goal"
    >
      Remove
    </button>
  </div>

  <label class="flex items-center gap-2 text-[11px] text-slate-500">
    <span class="shrink-0">Kind</span>
    <select
      class="flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs"
      value={goal.kind}
      onchange={(e) =>
        onChange({ ...goal, kind: (e.target as HTMLSelectElement).value as ReachabilityGoalKind })}
    >
      {#each ALL_REACHABILITY_GOAL_KINDS as kind}
        <option value={kind}>{KIND_LABEL[kind]}</option>
      {/each}
    </select>
  </label>

  <div class="rounded-md bg-slate-50 p-3">
    <div class="mb-2 flex flex-wrap items-center gap-1 text-[10px]">
      <span class="text-slate-500">Target:</span>
      <button
        type="button"
        class="rounded px-1.5 py-0.5 {leaf
          ? 'bg-slate-900 text-white'
          : 'border border-slate-300 text-slate-600 hover:bg-white'}"
        onclick={backToLeaf}
        disabled={leaf !== null}
      >
        Single
      </button>
      <button
        type="button"
        class="rounded px-1.5 py-0.5 {isCompositeCondition(goal.condition) && (goal.condition as { kind: string }).kind === 'all'
          ? 'bg-slate-900 text-white'
          : 'border border-slate-300 text-slate-600 hover:bg-white'}"
        onclick={() => startComposite('all')}
      >
        All of
      </button>
      <button
        type="button"
        class="rounded px-1.5 py-0.5 {isCompositeCondition(goal.condition) && (goal.condition as { kind: string }).kind === 'any'
          ? 'bg-slate-900 text-white'
          : 'border border-slate-300 text-slate-600 hover:bg-white'}"
        onclick={() => startComposite('any')}
      >
        Any of
      </button>
    </div>
    {#if leaf}
      <div class="flex flex-wrap items-start gap-2 text-sm">
        <span class="mt-1.5 font-mono text-xs text-slate-500">REACH</span>
        <StatePathSelect
          value={typeof leaf.left === 'string' ? leaf.left : ''}
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
    {:else}
      <div class="space-y-1">
        <p class="text-[11px] text-slate-500">
          Composite target (<span class="font-mono">{(goal.condition as { kind: string }).kind}</span>). Each entry can be a leaf or another composite.
        </p>
        <textarea
          class="mono min-h-32 w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
          bind:value={compositeDraft}
          onblur={commitComposite}
        ></textarea>
        {#if compositeError}
          <p class="text-[11px] text-red-600">{compositeError}</p>
        {:else}
          <p class="text-[11px] text-slate-500">Saved on blur. Switch back to "Single" for visual editing.</p>
        {/if}
      </div>
    {/if}
  </div>

  <input
    type="text"
    class="w-full rounded-md border border-slate-200 px-2 py-1 text-xs"
    value={goal.description ?? ''}
    onblur={(e) => onChange({ ...goal, description: (e.target as HTMLInputElement).value })}
    placeholder="Description (what this goal means)"
  />
  <input
    type="text"
    class="w-full rounded-md border border-slate-200 px-2 py-1 text-xs"
    value={goal.message ?? ''}
    onblur={(e) => onChange({ ...goal, message: (e.target as HTMLInputElement).value })}
    placeholder="Message shown when the goal is unmet"
  />
</div>
