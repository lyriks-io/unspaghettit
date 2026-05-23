<script lang="ts">
  import type { Surface } from '$features/behavior-model/domain/entities/Surface';
  import { ALL_SURFACE_TYPES, surfaceTypeLabel } from '$features/behavior-model/domain/entities/Surface';
  import { featureStore } from '$features/behavior-model/presentation/stores/featureStore.svelte';
  import { renameSurface } from '$features/behavior-model/domain/services/FeatureTransforms';
  import { projectContextStore } from '$features/projects/presentation/stores/projectContextStore.svelte';

  type Props = { surface: Surface };
  let { surface }: Props = $props();

  // Queue toggle: only renders when the surface's feature is part of a
  // project (the only context where "implement next" is meaningful).
  // Reactive against the local store snapshot so the chip flips instantly
  // after enqueue/dequeue without a refresh.
  const featureId = $derived(featureStore.feature?.id);
  const isQueued = $derived(
    featureId ? projectContextStore.isSurfaceQueued(featureId, surface.id) : false
  );

  async function toggleQueue() {
    if (!featureId) return;
    if (isQueued) {
      const itemId = projectContextStore.findQueueItemIdForSurface(featureId, surface.id);
      if (itemId) await projectContextStore.dequeueByItemId(itemId);
    } else {
      await projectContextStore.enqueueSurface(featureId, surface.id);
    }
  }

  let editing = $state(false);
  let name = $state('');
  let type = $state<Surface['type']>('screen');
  let description = $state('');

  $effect(() => {
    name = surface.name;
    type = surface.type;
    description = surface.description ?? '';
  });

  async function save() {
    if (
      name.trim() === surface.name &&
      type === surface.type &&
      description.trim() === (surface.description ?? '')
    ) {
      return;
    }
    await featureStore.mutate((current) =>
      renameSurface(current, surface.id, {
        name: name.trim() || surface.name,
        type,
        description: description.trim() || undefined
      })
    );
  }

  async function done() {
    await save();
    editing = false;
  }
</script>

<div class="group border-b border-hairline px-4 pt-3 pb-4">
  {#if editing}
    <div class="space-y-3">
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label class="block text-xs font-medium text-slate-600">
          Name
          <input
            type="text"
            bind:value={name}
            onblur={save}
            class="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm outline-none focus:border-slate-900"
          />
        </label>
        <label class="block text-xs font-medium text-slate-600">
          Type
          <select
            bind:value={type}
            onchange={save}
            class="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm outline-none focus:border-slate-900"
          >
            {#each ALL_SURFACE_TYPES as t}
              <option value={t}>{surfaceTypeLabel(t)}</option>
            {/each}
          </select>
        </label>
      </div>
      <label class="block text-xs font-medium text-slate-600">
        Description
        <textarea
          bind:value={description}
          onblur={save}
          rows="4"
          placeholder="What happens on this surface? Who lands here, and what can they do?"
          class="mt-1 w-full resize-y rounded-md border border-slate-300 px-2 py-1.5 text-sm font-normal leading-snug outline-none focus:border-slate-900"
        ></textarea>
      </label>
      <div class="flex justify-end gap-2">
        <button
          type="button"
          onclick={done}
          class="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white"
        >
          Done
        </button>
      </div>
    </div>
  {:else}
    <div class="space-y-2">
      <div class="flex items-start justify-between gap-3">
        <div class="flex flex-wrap items-center gap-2">
          <h2 class="text-lg font-semibold leading-tight text-slate-950">
            {surface.name}
          </h2>
          <span
            class="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600"
          >
            {surfaceTypeLabel(surface.type)}
          </span>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          {#if projectContextStore.isInProject && featureId}
            <button
              type="button"
              class="rounded-md border border-transparent px-2 py-1 text-xs font-medium transition {isQueued
                ? 'text-brand-700 opacity-100 hover:bg-cyan-50 hover:text-brand-900'
                : 'text-slate-500 opacity-0 hover:border-hairline hover:bg-cyan-50 hover:text-brand-800 group-hover:opacity-100 group-focus-within:opacity-100'}"
              onclick={toggleQueue}
              aria-label={isQueued ? 'Remove surface from queue' : 'Add surface to implementation queue'}
              title={isQueued ? 'In queue (click to remove)' : 'Add surface to implementation queue'}
            >
              {isQueued ? '✓ queued' : '+ queue'}
            </button>
          {/if}
          <button
            type="button"
            onclick={() => (editing = true)}
            aria-label="Edit surface metadata"
            class="rounded-md border border-transparent px-2 py-1 text-xs font-medium text-slate-500 hover:border-hairline hover:bg-slate-50 hover:text-slate-950"
          >
            Edit
          </button>
        </div>
      </div>
      {#if surface.description && surface.description.trim().length > 0}
        <p class="whitespace-pre-wrap text-sm leading-6 text-slate-600">
          {surface.description}
        </p>
      {:else}
        <p class="text-sm italic text-slate-400">No description yet.</p>
      {/if}
    </div>
  {/if}
</div>
