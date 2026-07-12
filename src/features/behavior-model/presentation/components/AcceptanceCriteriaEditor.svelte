<script lang="ts">
  import {
    ALL_ACCEPTANCE_OUTCOMES,
    type AcceptanceCriterion,
    type AcceptanceOutcome
  } from '$features/behavior-model/domain/entities/AcceptanceCriterion';
  import type { Feature } from '$features/behavior-model/domain/entities/Feature';
  import { featureStore } from '$features/behavior-model/presentation/stores/featureStore.svelte';
  import {
    addAcceptanceCriterion,
    removeAcceptanceCriterion,
    updateAcceptanceCriterion
  } from '$features/behavior-model/domain/services/FeatureTransforms';
  import { newAcceptanceCriterion } from '$features/behavior-model/presentation/view-models/factories';
  import { cryptoIdGenerator } from '$shared/domain/IdGenerator';

  type Props = { feature: Feature };
  let { feature }: Props = $props();

  const criteria = $derived(feature.acceptanceCriteria ?? []);
  // Criteria are feature-level, so the optional "about" link can point at any
  // surface in the feature.
  const surfaces = $derived(feature.surfaces ?? []);

  const OUTCOME_LABEL: Record<AcceptanceOutcome, string> = {
    success: 'Succeeds',
    failure: 'Errors out',
    blocked: 'Rejected'
  };

  const surfaceName = (id: string | undefined): string | undefined =>
    id === undefined || id.length === 0
      ? undefined
      : (surfaces.find((s) => String(s.id) === id)?.name ?? id);

  async function add() {
    const criterion = newAcceptanceCriterion(cryptoIdGenerator);
    await featureStore.mutate((current) => addAcceptanceCriterion(current, criterion));
  }

  async function patch(id: AcceptanceCriterion['id'], next: Partial<AcceptanceCriterion>) {
    await featureStore.mutate((current) => updateAcceptanceCriterion(current, id, next));
  }

  async function remove(id: AcceptanceCriterion['id']) {
    await featureStore.mutate((current) => removeAcceptanceCriterion(current, id));
  }
</script>

<div class="space-y-3">
  <div class="rounded-md border border-sky-200 bg-sky-50/50 p-3 text-xs text-sky-900">
    <p class="font-semibold">Acceptance criteria (spec / documentation)</p>
    <p class="mt-0.5 text-[11px] leading-relaxed">
      Prose Given/When/Then acceptance tests — the documentation facet, the complement to the
      model-checked action-level scenario. These are <span class="font-medium">not</span> run by the
      simulator or scored: they capture what must be true for the behavior to be accepted, in your
      own words. For a check the engine can prove, add a scenario to an action instead.
    </p>
  </div>

  <div class="flex justify-end">
    <button
      type="button"
      class="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
      onclick={add}
    >
      <span class="text-base leading-none">+</span> Add acceptance criterion
    </button>
  </div>

  {#if criteria.length === 0}
    <div class="rounded-lg border border-dashed border-slate-300 bg-slate-50/30 p-6 text-center">
      <p class="text-sm font-medium text-slate-700">No acceptance criteria yet</p>
      <p class="mx-auto mt-1 max-w-md text-xs text-slate-500">
        Optional — add one to record an edge case in prose (e.g. "Given an order delivered 20 days
        ago, when the customer requests a refund, then it is approved").
      </p>
    </div>
  {:else}
    <div class="space-y-2">
      {#each criteria as criterion (criterion.id)}
        <div class="space-y-2 rounded-md border border-slate-200 bg-white p-3">
          <div class="flex items-center gap-2">
            <input
              type="text"
              class="flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm font-medium"
              value={criterion.title}
              onblur={(e) => patch(criterion.id, { title: (e.target as HTMLInputElement).value })}
              placeholder="Criterion title"
            />
            {#if surfaceName(criterion.relatedSurfaceId)}
              <span class="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                {surfaceName(criterion.relatedSurfaceId)}
              </span>
            {/if}
            <button
              type="button"
              class="text-xs text-slate-400 hover:text-red-600"
              onclick={() => remove(criterion.id)}
              aria-label="Remove acceptance criterion"
            >
              Remove
            </button>
          </div>

          <div class="grid grid-cols-[3.5rem_1fr] items-center gap-x-2 gap-y-1 text-sm">
            <span class="text-[11px] font-medium text-slate-500">Given</span>
            <input
              type="text"
              class="rounded-md border border-slate-200 px-2 py-1 text-xs"
              value={criterion.given}
              onblur={(e) => patch(criterion.id, { given: (e.target as HTMLInputElement).value })}
              placeholder="the precondition"
            />
            <span class="text-[11px] font-medium text-slate-500">When</span>
            <input
              type="text"
              class="rounded-md border border-slate-200 px-2 py-1 text-xs"
              value={criterion.when}
              onblur={(e) => patch(criterion.id, { when: (e.target as HTMLInputElement).value })}
              placeholder="the trigger"
            />
            <span class="text-[11px] font-medium text-slate-500">Then</span>
            <input
              type="text"
              class="rounded-md border border-slate-200 px-2 py-1 text-xs"
              value={criterion.then}
              onblur={(e) => patch(criterion.id, { then: (e.target as HTMLInputElement).value })}
              placeholder="the expected result"
            />
          </div>

          <div class="flex flex-wrap items-center gap-3">
            <label class="flex items-center gap-1.5 text-[11px] text-slate-500">
              <span>Expected</span>
              <select
                class="rounded-md border border-slate-300 px-2 py-1 text-xs"
                value={criterion.expectedOutcome}
                onchange={(e) =>
                  patch(criterion.id, {
                    expectedOutcome: (e.target as HTMLSelectElement).value as AcceptanceOutcome
                  })}
              >
                {#each ALL_ACCEPTANCE_OUTCOMES as outcome}
                  <option value={outcome}>{OUTCOME_LABEL[outcome]}</option>
                {/each}
              </select>
            </label>
            <label class="flex items-center gap-1.5 text-[11px] text-slate-500">
              <span>About</span>
              <select
                class="rounded-md border border-slate-300 px-2 py-1 text-xs"
                value={criterion.relatedSurfaceId ?? ''}
                onchange={(e) =>
                  patch(criterion.id, {
                    relatedSurfaceId: (e.target as HTMLSelectElement).value || undefined
                  })}
              >
                <option value="">(no surface)</option>
                {#each surfaces as surface}
                  <option value={String(surface.id)}>{surface.name}</option>
                {/each}
              </select>
            </label>
          </div>

          <input
            type="text"
            class="w-full rounded-md border border-slate-200 px-2 py-1 text-xs"
            value={criterion.description ?? ''}
            onblur={(e) =>
              patch(criterion.id, { description: (e.target as HTMLInputElement).value })}
            placeholder="Note (optional)"
          />
        </div>
      {/each}
    </div>
  {/if}
</div>
