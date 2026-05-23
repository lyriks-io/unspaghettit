<script lang="ts">
  import type { Feature } from '$features/behavior-model/domain/entities/Feature';
  import type { Transition } from '$features/behavior-model/domain/entities/Transition';
  import {
    asSurfaceId,
    asTransitionId,
    type SurfaceId
  } from '$features/behavior-model/domain/value-objects/ids';
  import {
    addTransitionToSurface,
    removeTransitionFromSurface,
    updateTransitionOnSurface
  } from '$features/behavior-model/domain/services/FeatureTransforms';
  import { featureStore } from '$features/behavior-model/presentation/stores/featureStore.svelte';
  import {
    buildTransitionCatalog,
    groupTransitionCatalog,
    type TransitionOrigin,
    type TransitionSource
  } from '$features/behavior-model/domain/services/TransitionCatalog';
  import { editorStore } from '$features/behavior-model/presentation/stores/editorStore.svelte';
  import { cryptoIdGenerator } from '$shared/domain/IdGenerator';
  import { projectContextStore } from '$features/projects/presentation/stores/projectContextStore.svelte';
  import { inheritedTransitions } from '$features/projects/domain/services/InheritedFromProject';

  type Props = { feature: Feature };
  let { feature }: Props = $props();

  const entries = $derived(buildTransitionCatalog(feature));
  const groups = $derived(groupTransitionCatalog(entries));
  const total = $derived(entries.length);
  const inherited = $derived(inheritedTransitions(projectContextStore.siblings));
  let sourceDraft = $state<string>('');
  let targetDraft = $state<string>('');

  $effect(() => {
    const first = feature.surfaces[0];
    const second = feature.surfaces[1] ?? first;
    if (!sourceDraft && first) sourceDraft = first.id;
    if (!targetDraft && second) targetDraft = second.id;
  });

  async function addDeclaredTransition() {
    if (!sourceDraft || !targetDraft) return;
    const transition: Transition = {
      id: asTransitionId(cryptoIdGenerator()),
      target: asSurfaceId(targetDraft)
    };
    await featureStore.mutate((current) =>
      addTransitionToSurface(current, asSurfaceId(sourceDraft), transition)
    );
  }

  async function updateDeclaredTransition(
    sourceId: SurfaceId,
    transition: Transition,
    patch: Partial<Transition>
  ) {
    await featureStore.mutate((current) =>
      updateTransitionOnSurface(current, sourceId, transition.id, patch)
    );
  }

  async function removeDeclaredTransition(sourceId: SurfaceId, transition: Transition) {
    if (!confirm('Delete this declared transition?')) return;
    await featureStore.mutate((current) =>
      removeTransitionFromSurface(current, sourceId, transition.id)
    );
  }

  function originLabel(o: TransitionOrigin): string {
    switch (o) {
      case 'declared':
        return 'declared';
      case 'action_effect':
        return 'action effect';
      case 'action_rule_effect':
        return 'action rule';
      case 'surface_rule_effect':
        return 'surface rule';
    }
  }

  function navigateToSource(source: TransitionSource) {
    editorStore.navigateTo({
      surfaceId: source.surfaceId,
      actionId: source.actionId,
      surfacePanelTab: 'actions'
    });
  }

  function navigateToSurface(surfaceId: string) {
    editorStore.navigateTo({ surfaceId });
  }
</script>

<div class="space-y-6">
  <header class="space-y-1">
    <h2 class="text-lg font-semibold text-neutral-900">Transitions</h2>
    <p class="text-sm text-neutral-600">
      Every authored navigation between surfaces. Declared transitions, default
      <span class="mono">transition_surface</span> effects, and rule-driven transitions.
      {total} edge{total === 1 ? '' : 's'} across {groups.length} source surface{groups.length === 1 ? '' : 's'}.
    </p>
  </header>

  <section class="space-y-3 rounded-md border border-neutral-200 bg-white p-3">
    <header class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h3 class="text-sm font-semibold text-neutral-900">Declared transitions</h3>
        <p class="text-xs text-neutral-500">
          Surface-level navigation edges, separate from transition effects on rules and actions.
        </p>
      </div>
      {#if feature.surfaces.length >= 2}
        <div class="flex flex-wrap items-center gap-2">
          <select
            class="rounded-md border border-neutral-300 px-2 py-1 text-xs"
            bind:value={sourceDraft}
            aria-label="Source surface"
          >
            {#each feature.surfaces as surface (surface.id)}
              <option value={surface.id}>{surface.name}</option>
            {/each}
          </select>
          <span class="text-xs text-neutral-400">to</span>
          <select
            class="rounded-md border border-neutral-300 px-2 py-1 text-xs"
            bind:value={targetDraft}
            aria-label="Target surface"
          >
            {#each feature.surfaces as surface (surface.id)}
              <option value={surface.id}>{surface.name}</option>
            {/each}
          </select>
          <button
            type="button"
            class="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            onclick={addDeclaredTransition}
            disabled={sourceDraft.length === 0 || targetDraft.length === 0}
          >
            Add transition
          </button>
        </div>
      {/if}
    </header>

    {#if feature.surfaces.length < 2}
      <p class="rounded-md border border-dashed border-neutral-300 p-3 text-center text-xs text-neutral-500">
        Add at least two surfaces to declare navigation.
      </p>
    {:else if feature.surfaces.every((surface) => surface.transitions.length === 0)}
      <p class="rounded-md border border-dashed border-neutral-300 p-3 text-center text-xs text-neutral-500">
        No declared transitions yet.
      </p>
    {:else}
      <ul class="space-y-2">
        {#each feature.surfaces as source (source.id)}
          {#each source.transitions as transition (transition.id)}
            <li class="flex flex-wrap items-start gap-2 rounded-md border border-neutral-200 bg-neutral-50/40 p-2 text-xs">
              <span class="mt-1 font-medium text-neutral-800">{source.name}</span>
              <span class="mt-1 text-neutral-400">to</span>
              <select
                class="rounded-md border border-neutral-300 px-2 py-1 text-xs"
                value={transition.target}
                onchange={(e) =>
                  updateDeclaredTransition(source.id, transition, {
                    target: asSurfaceId((e.target as HTMLSelectElement).value)
                  })}
              >
                {#each feature.surfaces as target (target.id)}
                  <option value={target.id}>{target.name}</option>
                {/each}
              </select>
              <input
                type="text"
                class="min-w-32 rounded-md border border-neutral-300 px-2 py-1 text-xs"
                value={transition.label ?? ''}
                placeholder="Label"
                onblur={(e) =>
                  updateDeclaredTransition(source.id, transition, {
                    label: (e.target as HTMLInputElement).value || undefined
                  })}
              />
              <input
                type="text"
                class="min-w-48 flex-1 rounded-md border border-neutral-300 px-2 py-1 text-xs"
                value={transition.description ?? ''}
                placeholder="Description"
                onblur={(e) =>
                  updateDeclaredTransition(source.id, transition, {
                    description: (e.target as HTMLInputElement).value || undefined
                  })}
              />
              <button
                type="button"
                class="mt-1 text-xs text-neutral-400 hover:text-red-600"
                onclick={() => removeDeclaredTransition(source.id, transition)}
              >
                Remove
              </button>
            </li>
          {/each}
        {/each}
      </ul>
    {/if}
  </section>

  {#if total === 0}
    <p class="rounded-md border border-dashed border-neutral-300 p-4 text-center text-sm text-neutral-500">
      No transitions yet. Add a <span class="mono">transition_surface</span> effect to a
      action, or declare one in a surface's <em>transitions</em>.
    </p>
  {:else}
    <div class="space-y-5">
      {#each groups as group (group.fromSurfaceId)}
        <section>
          <header class="mb-1 flex items-baseline gap-2">
            <button
              type="button"
              class="text-sm font-semibold text-neutral-900 hover:text-brand-700 hover:underline"
              onclick={() => navigateToSurface(group.fromSurfaceId)}
              title="Open this surface"
            >
              {group.fromSurfaceName}
            </button>
            <span class="text-[11px] text-neutral-500">
              {group.transitions.length} outgoing edge{group.transitions.length === 1 ? '' : 's'}
            </span>
          </header>
          <ul class="divide-y divide-neutral-200 rounded-md border border-neutral-200 bg-white">
            {#each group.transitions as edge (edge.toSurfaceId)}
              <li class="px-3 py-2">
                <header class="flex flex-wrap items-baseline gap-2 text-sm">
                  <span class="text-neutral-700">{edge.fromSurfaceName}</span>
                  <span class="text-neutral-400" aria-hidden="true">→</span>
                  <button
                    type="button"
                    class="font-medium text-neutral-900 hover:text-brand-700 hover:underline"
                    onclick={() => navigateToSurface(edge.toSurfaceId)}
                    title="Open target surface"
                  >
                    {edge.toSurfaceName}
                  </button>
                  <span class="text-[11px] text-neutral-500">
                    {edge.sources.length} source{edge.sources.length === 1 ? '' : 's'}
                  </span>
                </header>
                <ul class="mt-1.5 space-y-0.5">
                  {#each edge.sources as source, i (i)}
                    <li class="flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-600">
                      <button
                        type="button"
                        class="rounded-md border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800"
                        onclick={() => navigateToSource(source)}
                        title="Open in feature editor"
                      >
                        {#if source.actionName}
                          {source.actionName}
                        {:else}
                          {source.surfaceName} (surface)
                        {/if}
                      </button>
                      <span class="rounded bg-neutral-100 px-1 text-[10px] uppercase tracking-wide text-neutral-500">
                        {originLabel(source.origin)}
                      </span>
                      {#if source.description}
                        <span class="text-neutral-500">- {source.description}</span>
                      {/if}
                    </li>
                  {/each}
                </ul>
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    </div>
  {/if}

  {#if inherited.length > 0}
    <section class="space-y-2 border-t border-dashed border-neutral-200 pt-3">
      <header class="flex items-baseline justify-between">
        <h3 class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Inherited from project
        </h3>
        <p class="text-[10px] text-slate-400">
          Read-only. Edit on the source feature.
        </p>
      </header>
      <ul class="divide-y divide-slate-100 rounded-md border border-slate-200 bg-slate-50/40">
        {#each inherited as row (row.value.id)}
          {@const t = row.value}
          <li class="flex flex-wrap items-baseline gap-2 px-4 py-2 text-xs">
            <span class="flex flex-wrap items-baseline gap-1.5 font-medium text-slate-800">
              <span>{t.surfaceName}</span>
              <span class="text-slate-400" aria-hidden="true">→</span>
              {#if t.targetMissing}
                <span
                  class="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800"
                  title="No surface with this id in the source feature, broken reference"
                >
                  ! unresolved
                </span>
                <span class="mono text-[10px] text-slate-400" title="Target surface id">{t.target}</span>
              {:else}
                <span>{t.targetName}</span>
              {/if}
            </span>
            {#if t.label}
              <span class="text-[11px] text-slate-500">· {t.label}</span>
            {/if}
            <span class="ml-auto rounded-md bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700" title="Source feature">
              {row.sourceFeatureName}
            </span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</div>
