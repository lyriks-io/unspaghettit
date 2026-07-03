<script lang="ts">
  import type { Surface } from '$features/behavior-model/domain/entities/Surface';
  import type { Invariant } from '$features/behavior-model/domain/entities/Invariant';
  import { featureStore } from '$features/behavior-model/presentation/stores/featureStore.svelte';
  import {
    addInvariantToSurface,
    removeInvariantFromSurface
  } from '$features/behavior-model/domain/services/FeatureTransforms';
  import { newInvariant } from '$features/behavior-model/presentation/view-models/factories';
  import { cryptoIdGenerator } from '$shared/domain/IdGenerator';
  import InvariantEditor from './InvariantEditor.svelte';

  type Props = { surface: Surface };
  let { surface }: Props = $props();

  const availablePaths = $derived(surface.stateDefinitions.map((d) => d.path));

  async function add() {
    const fallbackPath = surface.stateDefinitions[0]?.path ?? 'state.path';
    const invariant = newInvariant(cryptoIdGenerator, {
      name: 'New invariant',
      left: fallbackPath as string
    });
    await featureStore.mutate((current) => addInvariantToSurface(current, surface.id, invariant));
  }

  async function update(invariant: Invariant) {
    await featureStore.mutate((current) => ({
      ...current,
      surfaces: current.surfaces.map((s) =>
        s.id === surface.id
          ? { ...s, invariants: s.invariants.map((i) => (i.id === invariant.id ? invariant : i)) }
          : s
      )
    }));
  }

  async function remove(invariant: Invariant) {
    await featureStore.mutate((current) =>
      removeInvariantFromSurface(current, surface.id, invariant.id)
    );
  }
</script>

<div class="space-y-3">
  <div class="flex justify-end">
    <button
      type="button"
      class="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
      onclick={add}
    >
      <span class="text-base leading-none">+</span> Add invariant
    </button>
  </div>

  {#if surface.invariants.length === 0}
    <div class="rounded-lg border border-dashed border-slate-300 bg-slate-50/30 p-6 text-center">
      <p class="text-sm font-medium text-slate-700">No invariants on this surface</p>
      <p class="mx-auto mt-1 max-w-sm text-xs text-slate-500">
        Invariants are properties that must hold after every action runs on this surface, like
        "count is never negative". Violations block the simulation.
      </p>
    </div>
  {:else}
    <div class="space-y-2">
      {#each surface.invariants as invariant (invariant.id)}
        <div data-focus-target={`invariant:${invariant.id}`} class="scroll-mt-24 rounded-lg">
          <InvariantEditor
            {invariant}
            {availablePaths}
            onChange={(next) => update(next)}
            onRemove={() => remove(invariant)}
          />
        </div>
      {/each}
    </div>
  {/if}
</div>
