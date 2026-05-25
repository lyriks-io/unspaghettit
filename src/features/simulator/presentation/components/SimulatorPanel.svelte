<script lang="ts">
  import type { Feature } from '$features/behavior-model/domain/entities/Feature';
  import type { Surface } from '$features/behavior-model/domain/entities/Surface';
  import type { Action } from '$features/behavior-model/domain/entities/Action';
  import {
    ALL_RULE_CATEGORIES,
    ruleCategoryLabel,
    type RuleCategory
  } from '$features/behavior-model/domain/value-objects/RuleCategory';
  import { simulatorStore } from '$features/simulator/presentation/stores/simulatorStore.svelte';
  import StateInspector from './StateInspector.svelte';
  import ParameterInputs from './ParameterInputs.svelte';
  import PersonaPicker from './PersonaPicker.svelte';
  import ScenarioPicker from './ScenarioPicker.svelte';
  import SimulationResultView from './SimulationResultView.svelte';
  import RealActionPanel from './RealActionPanel.svelte';

  type Props = { feature: Feature; surface: Surface };
  let { feature, surface }: Props = $props();

  type Mode = 'simulated' | 'real';
  let mode = $state<Mode>('simulated');

  $effect(() => {
    simulatorStore.ensureSnapshotForSurface(surface, feature);
  });

  const selectedCapability = $derived<Action | null>(
    surface.actions.find((c) => c.id === simulatorStore.actionId) ??
      surface.actions[0] ??
      null
  );

  const ruleCountsByCategory = $derived.by(() => {
    const counts: Partial<Record<RuleCategory, number>> = {};
    for (const rule of surface.rules) {
      counts[rule.category] = (counts[rule.category] ?? 0) + 1;
    }
    if (selectedCapability) {
      for (const rule of selectedCapability.rules) {
        counts[rule.category] = (counts[rule.category] ?? 0) + 1;
      }
    }
    return counts;
  });

  $effect(() => {
    if (selectedCapability && simulatorStore.actionId !== selectedCapability.id) {
      simulatorStore.selectCapability(selectedCapability.id, {
        action: selectedCapability,
        feature
      });
    }
  });

  function run() {
    if (!selectedCapability) return;
    simulatorStore.run(surface, selectedCapability);
  }

  function reset() {
    simulatorStore.resetTo(surface);
  }
</script>

<div class="space-y-2 text-sm" data-tour="simulator-panel">
  <!-- ─── Mode toggle: Simulated ↔ Real ─────────────────────────────── -->
  <div
    class="flex rounded-md border border-hairline bg-slate-50 p-0.5 text-[11px] font-medium"
    role="tablist"
    aria-label="View mode"
  >
    <button
      type="button"
      role="tab"
      aria-selected={mode === 'simulated'}
      class="flex-1 rounded px-2 py-1 transition {mode === 'simulated'
        ? 'bg-white text-brand-800'
        : 'text-slate-600 hover:text-slate-950'}"
      onclick={() => (mode = 'simulated')}
      title="Run the deterministic simulator on the modeled spec"
    >
      Simulated
    </button>
    <button
      type="button"
      role="tab"
      aria-selected={mode === 'real'}
      class="flex-1 rounded px-2 py-1 transition {mode === 'real'
        ? 'bg-white text-brand-800'
        : 'text-slate-600 hover:text-slate-950'}"
      onclick={() => (mode = 'real')}
      title="Show the real implementation captured from the repo (file paths + code snippets)"
    >
      Real
    </button>
  </div>

  <!-- ─── Action picker (visible in both modes) ────────────────────── -->
  <section class="space-y-2 rounded-lg border border-hairline bg-white p-2.5">
    <h3 class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
      {mode === 'simulated' ? 'Test setup' : 'Inspect action'}
    </h3>

    {#if mode === 'simulated'}
      <PersonaPicker {feature} {surface} action={selectedCapability} />
    {/if}

    <div class="space-y-1">
      <span class="text-[11px] font-medium text-slate-700">
        {mode === 'simulated' ? 'Action to test' : 'Action'}
      </span>
      {#if surface.actions.length === 0}
        <p class="text-[11px] text-slate-500">(no action on this surface)</p>
      {:else}
        <div class="flex flex-wrap gap-1">
          {#each surface.actions as cap (cap.id)}
            <button
              type="button"
              class="rounded-md border px-2 py-1 text-[11px] font-medium transition {selectedCapability?.id ===
              cap.id
                ? 'border-brand-500 bg-brand-50 text-brand-800'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}"
              aria-pressed={selectedCapability?.id === cap.id}
              title={cap.intent}
              onclick={() =>
                simulatorStore.selectCapability(cap.id, { action: cap, feature })}
            >
              {cap.name}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </section>

  {#if mode === 'real'}
    <RealActionPanel {feature} action={selectedCapability} />
  {:else}

  <!-- ─── Scenario (own card, directly below test setup) ───────────── -->
  {#if selectedCapability && (selectedCapability.scenarios?.length ?? 0) > 0}
    <section class="space-y-2 rounded-lg border border-hairline bg-white p-2.5">
      <h3 class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        Scenario
      </h3>
      <ScenarioPicker {feature} {surface} action={selectedCapability} />
    </section>
  {/if}

  <!-- ─── Inputs (parameters of the selected action) ───────────── -->
  {#if selectedCapability && selectedCapability.parameters.length > 0}
    <section class="space-y-2 rounded-lg border border-hairline bg-white p-2.5">
      <div class="flex items-baseline justify-between">
        <h3 class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Inputs
        </h3>
        <span class="text-[10px] text-slate-400">
          {selectedCapability.parameters.length} parameter{selectedCapability.parameters.length === 1
            ? ''
            : 's'}
        </span>
      </div>
      <ParameterInputs surfaceId={surface.id} action={selectedCapability} />
    </section>
  {/if}

  <!-- ─── Current state ────────────────────────────────────────────── -->
  <section class="space-y-2 rounded-lg border border-hairline bg-white p-2.5">
    <div class="flex items-baseline justify-between">
      <h3 class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        Current state
      </h3>
      <span class="text-[10px] text-slate-400">
        {surface.stateDefinitions.length} value{surface.stateDefinitions.length === 1 ? '' : 's'}
      </span>
    </div>
    <StateInspector {surface} />
  </section>

  <!-- ─── Run / reset ──────────────────────────────────────────────── -->
  <div class="flex items-center gap-1.5">
    <button
      type="button"
      data-tour="simulator-run"
      class="flex-1 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-slate-300"
      onclick={run}
      disabled={!selectedCapability}
    >
      Run {selectedCapability?.name ?? 'action'}
    </button>
    <button
      type="button"
      class="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-[11px] font-medium text-slate-700 transition hover:bg-slate-50"
      onclick={reset}
      title="Reset state to surface defaults and clear inputs"
    >
      Reset
    </button>
  </div>

  <!-- ─── Real-flow toggle (state persists across surface navigation) ─ -->
  <label
    class="flex items-start gap-2 rounded-md border border-hairline bg-white px-2.5 py-2 text-[11px] cursor-pointer hover:bg-slate-50"
    title="When on, switching surfaces keeps existing state values. Testing the feature as a real navigation flow."
  >
    <input
      type="checkbox"
      class="mt-0.5"
      checked={simulatorStore.persistAcrossNavigation}
      onchange={(e) =>
        simulatorStore.setPersistAcrossNavigation(
          (e.target as HTMLInputElement).checked
        )}
    />
    <span class="flex-1">
      <span class="font-medium text-slate-800">Real-flow mode</span>
      <span class="block text-slate-500">
        Keep state when navigating between surfaces. Off = test each surface in isolation.
      </span>
    </span>
  </label>

  <!-- ─── Result ───────────────────────────────────────────────────── -->
  {#if simulatorStore.lastResult}
    <div data-tour="simulator-result">
      <SimulationResultView {feature} result={simulatorStore.lastResult} {surface} />
    </div>
  {/if}

  <!-- ─── History (collapsed by default) ───────────────────────────── -->
  {#if simulatorStore.history.length > 1}
    <details class="rounded-lg border border-neutral-200 bg-white px-2.5 py-2 text-xs">
      <summary class="flex cursor-pointer items-center justify-between gap-2 font-medium text-neutral-700">
        <span>Recent runs ({simulatorStore.history.length})</span>
        <button
          type="button"
          class="rounded-md px-1.5 py-0 text-[10px] font-medium text-neutral-500 hover:bg-neutral-100 hover:text-red-600"
          onclick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            simulatorStore.clearHistory();
          }}
          aria-label="Clear simulation history"
        >
          Clear
        </button>
      </summary>
      <ul class="mt-2 space-y-1">
        {#each simulatorStore.history as result, i (i)}
          {@const cap = surface.actions.find((c) => c.id === result.actionId)}
          <li class="flex items-center justify-between gap-2 text-neutral-600">
            <span class="truncate">{cap?.name ?? 'unknown'}</span>
            <span
              class="rounded-full px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide {result.status ===
              'success'
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-amber-100 text-amber-800'}"
            >
              {result.status}
            </span>
          </li>
        {/each}
      </ul>
    </details>
  {/if}

  <!-- ─── Rule categories reference (collapsed) ────────────────────── -->
  <details class="rounded-lg border border-neutral-200 bg-white px-2.5 py-2 text-xs">
    <summary class="cursor-pointer font-medium text-neutral-700">
      Rule categories reference
    </summary>
    <ul class="mt-2 grid grid-cols-2 gap-x-2 gap-y-1">
      {#each ALL_RULE_CATEGORIES as c (c)}
        {@const count = ruleCountsByCategory[c] ?? 0}
        <li class="flex items-center gap-1">
          <span class={count > 0 ? 'text-neutral-700' : 'text-neutral-400'}>
            {ruleCategoryLabel(c)}
          </span>
          {#if count > 0}
            <span
              class="ml-auto rounded-full bg-brand-50 px-1.5 py-0 text-[10px] font-semibold text-brand-700"
              title="Rules in this category that will evaluate when you run the action"
            >
              {count}
            </span>
          {/if}
        </li>
      {/each}
    </ul>
  </details>
  {/if}
</div>
