<script lang="ts">
  import type { Surface } from '$features/behavior-model/domain/entities/Surface';
  import type { Rule } from '$features/behavior-model/domain/entities/Rule';
  import { featureStore } from '$features/behavior-model/presentation/stores/featureStore.svelte';
  import {
    addRuleToSurface,
    removeRuleFromSurface,
    updateRuleOnSurface
  } from '$features/behavior-model/domain/services/FeatureTransforms';
  import { newRule } from '$features/behavior-model/presentation/view-models/factories';
  import { cryptoIdGenerator } from '$shared/domain/IdGenerator';
  import RuleEditor from './RuleEditor.svelte';

  type Props = { surface: Surface };
  let { surface }: Props = $props();

  const availablePaths = $derived(surface.stateDefinitions.map((d) => d.path));

  async function add() {
    const fallbackPath = surface.stateDefinitions[0]?.path ?? 'state.path';
    const rule = newRule(cryptoIdGenerator, {
      category: 'permissions',
      left: fallbackPath as string,
      operator: 'equals'
    });
    await featureStore.mutate((current) => addRuleToSurface(current, surface.id, rule));
  }

  async function update(rule: Rule) {
    await featureStore.mutate((current) => updateRuleOnSurface(current, surface.id, rule));
  }

  async function remove(rule: Rule) {
    await featureStore.mutate((current) => removeRuleFromSurface(current, surface.id, rule.id));
  }
</script>

<div class="space-y-3">
  <div class="flex justify-end">
    <button
      type="button"
      class="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
      onclick={add}
    >
      <span class="text-base leading-none">+</span> Add surface rule
    </button>
  </div>

  {#if surface.rules.length === 0}
    <div class="rounded-lg border border-dashed border-slate-300 bg-slate-50/30 p-6 text-center">
      <p class="text-sm font-medium text-slate-700">No surface-level rules</p>
      <p class="mx-auto mt-1 max-w-sm text-xs text-slate-500">
        Surface rules fire before every action on this surface. Use them for cross-cutting
        gates: signed-in check, role gate, kill-switch.
      </p>
    </div>
  {:else}
    <div class="space-y-2">
      {#each surface.rules as rule (rule.id)}
        <RuleEditor
          {rule}
          {availablePaths}
          onChange={(next) => update(next)}
          onRemove={() => remove(rule)}
        />
      {/each}
    </div>
  {/if}
</div>
