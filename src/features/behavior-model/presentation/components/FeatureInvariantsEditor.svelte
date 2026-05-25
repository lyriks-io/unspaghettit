<script lang="ts">
  import type { Feature } from '$features/behavior-model/domain/entities/Feature';
  import type { Invariant } from '$features/behavior-model/domain/entities/Invariant';
  import { featureStore } from '$features/behavior-model/presentation/stores/featureStore.svelte';
  import {
    addFeatureInvariant,
    removeFeatureInvariant,
    updateFeatureInvariant
  } from '$features/behavior-model/domain/services/FeatureTransforms';
  import { newInvariant } from '$features/behavior-model/presentation/view-models/factories';
  import { cryptoIdGenerator } from '$shared/domain/IdGenerator';
  import InvariantEditor from './InvariantEditor.svelte';

  type Props = { feature: Feature };
  let { feature }: Props = $props();

  // Feature-level invariants apply to every action regardless of which
  // surface it lives on, so the visible state-path picker can pull from any
  // surface in the feature.
  const availablePaths = $derived(
    feature.surfaces.flatMap((s) => s.stateDefinitions.map((d) => d.path))
  );
  const invariants = $derived(feature.featureInvariants ?? []);

  async function add() {
    const fallbackPath = availablePaths[0] ?? ('state.path' as unknown as never);
    const invariant = newInvariant(cryptoIdGenerator, {
      name: 'New feature invariant',
      left: fallbackPath as string
    });
    await featureStore.mutate((current) => addFeatureInvariant(current, invariant));
  }

  async function update(next: Invariant) {
    await featureStore.mutate((current) =>
      updateFeatureInvariant(current, next.id, next)
    );
  }

  async function remove(id: Invariant['id']) {
    await featureStore.mutate((current) => removeFeatureInvariant(current, id));
  }
</script>

<div class="space-y-3">
  <div class="rounded-md border border-violet-200 bg-violet-50/50 p-3 text-xs text-violet-900">
    <p class="font-semibold">Feature-level invariants</p>
    <p class="mt-0.5 text-[11px] leading-relaxed">
      Checked after EVERY action runs in this feature, no matter which surface it lives on. Use
      these for global properties: accounting equations (Σ balances = 0), referential
      integrity across surfaces, anything that must hold project-wide. Surface-local
      invariants stay on the surface; declare here only when the property is global.
    </p>
  </div>

  <div class="flex justify-end">
    <button
      type="button"
      class="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
      onclick={add}
    >
      <span class="text-base leading-none">+</span> Add feature invariant
    </button>
  </div>

  {#if invariants.length === 0}
    <div class="rounded-lg border border-dashed border-slate-300 bg-slate-50/30 p-6 text-center">
      <p class="text-sm font-medium text-slate-700">No feature-level invariants yet</p>
      <p class="mx-auto mt-1 max-w-md text-xs text-slate-500">
        Most features don't need any, only add them when a property must hold across multiple
        surfaces (e.g. accounting equations, cross-surface referential integrity).
      </p>
    </div>
  {:else}
    <div class="space-y-2">
      {#each invariants as invariant (invariant.id)}
        <InvariantEditor
          {invariant}
          {availablePaths}
          onChange={(next) => update(next)}
          onRemove={() => remove(invariant.id)}
        />
      {/each}
    </div>
  {/if}
</div>
