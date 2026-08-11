<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { withBase } from '$shared/routing/appBase';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { projectStore } from '$features/projects/presentation/stores/projectStore.svelte';
  import { projectContextStore } from '$features/projects/presentation/stores/projectContextStore.svelte';
  import { subscribeSyncEvents } from '$lib/client/sync/syncEvents';
  import { globalQueueStore } from '../stores/globalQueueStore.svelte';
  import type { QueueItemId } from '../../domain/entities/QueueItem';

  const reduceMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const motionMs = (ms: number): number => (reduceMotion ? 0 : ms);

  // Hydrate the remembered project from localStorage during setup (before the
  // first reactive effect runs) so a route with no loaded project shows the
  // last queue immediately, with no empty flash. No-op on the server.
  globalQueueStore.init();

  // Point the widget at whichever project the current route has loaded:
  // the project editor loads `projectStore`, the feature editor loads
  // `projectContextStore`. Reading `.implementationQueue` here makes the
  // effect re-run when a "+ queue" chip enqueues/dequeues, so the corner
  // list stays in lockstep without a refresh button. A route with no loaded
  // project keeps the last-remembered queue (the store ignores the null).
  $effect(() => {
    const project = projectStore.project ?? projectContextStore.project;
    void project?.implementationQueue;
    untrack(() => {
      if (project) globalQueueStore.setActiveProject(String(project.id), project.name);
      void globalQueueStore.refresh();
    });
  });

  onMount(() => {
    // Cross-tab / MCP liveness while we're NOT on the owning project's page:
    // a project (queue write) or feature (rename → label) event for the
    // remembered project should refresh the enriched view.
    const unsubscribe = subscribeSyncEvents((evt) => {
      if (!globalQueueStore.projectId) return;
      if (evt.kind === 'project' || evt.kind === 'feature') {
        void globalQueueStore.refresh();
      }
    });
    return unsubscribe;
  });

  // ── drag-and-drop reorder (mirrors QueuePanel: plain HTML5 DnD) ────────────
  let draggingId = $state<QueueItemId | null>(null);
  let overIndex = $state<number | null>(null);

  function onDragStart(e: DragEvent, itemId: QueueItemId) {
    draggingId = itemId;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(itemId));
    }
  }

  function onDragOver(e: DragEvent, index: number) {
    if (draggingId === null) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    overIndex = index;
  }

  async function onDrop(e: DragEvent, targetIndex: number) {
    e.preventDefault();
    const moving = draggingId;
    draggingId = null;
    overIndex = null;
    if (!moving) return;
    await globalQueueStore.moveTo(moving, targetIndex);
  }

  function onDragEnd() {
    draggingId = null;
    overIndex = null;
  }

  async function moveBy(itemId: QueueItemId, delta: -1 | 1) {
    const current = globalQueueStore.views.findIndex((v) => v.item.id === itemId);
    if (current < 0) return;
    await globalQueueStore.moveTo(itemId, current + delta);
  }

  async function remove(itemId: QueueItemId) {
    await globalQueueStore.dequeue(itemId);
  }
</script>

{#if globalQueueStore.open}
  <section
    transition:fly={{ y: 12, duration: motionMs(180), easing: cubicOut }}
    class="fixed bottom-5 right-5 z-40 flex max-h-[70vh] w-[min(92vw,380px)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/15 ring-1 ring-slate-950/5"
  >
    <header class="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <span class="text-brand-600" aria-hidden="true">▶</span>
          <h2 class="text-sm font-semibold text-slate-800">Implementation queue</h2>
          <span class="rounded-full bg-brand-600 px-2 py-0.5 text-xs font-bold tabular-nums text-white">
            {globalQueueStore.views.length}
          </span>
        </div>
        {#if globalQueueStore.projectName}
          <p class="mt-0.5 truncate text-xs text-slate-500" title={globalQueueStore.projectName}>
            {globalQueueStore.projectName}
          </p>
        {/if}
      </div>
      <button
        type="button"
        class="-mr-1 shrink-0 rounded-md p-1 text-slate-400 transition hover:bg-slate-200 hover:text-slate-700"
        onclick={() => globalQueueStore.setOpen(false)}
        aria-label="Minimize implementation queue"
        title="Minimize"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto p-3">
      {#if globalQueueStore.error}
        <p class="mb-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {globalQueueStore.error}
        </p>
      {/if}

      {#if globalQueueStore.views.length === 0}
        <div class="rounded-lg border border-dashed border-slate-300 bg-slate-50/60 p-5 text-center text-xs text-slate-500">
          <p class="font-medium text-slate-700">Nothing queued yet.</p>
          <p class="mt-1">
            Hover any Feature card, Surface, or Action and click
            <span class="font-semibold text-brand-700">+ queue</span> to plan what to implement next.
          </p>
        </div>
      {:else}
        <ul class="space-y-1.5">
          {#each globalQueueStore.views as view, index (view.item.id)}
            {@const itemId = view.item.id}
            {@const isDragging = draggingId === itemId}
            {@const isOver = overIndex === index && draggingId !== null && draggingId !== itemId}
            <li
              class="group flex items-center gap-2 rounded-md border bg-white px-2 py-1.5 text-sm transition
                {view.orphaned ? 'border-amber-200 bg-amber-50/40' : 'border-slate-200'}
                {isDragging ? 'opacity-40' : ''}
                {isOver ? 'border-brand-400 ring-1 ring-brand-200' : ''}"
              draggable="true"
              ondragstart={(e) => onDragStart(e, itemId)}
              ondragover={(e) => onDragOver(e, index)}
              ondrop={(e) => onDrop(e, index)}
              ondragend={onDragEnd}
            >
              <span
                class="cursor-grab select-none text-slate-300 transition-colors group-hover:text-slate-500 active:cursor-grabbing"
                aria-hidden="true"
                title="Drag to reorder"
              >
                ⋮⋮
              </span>
              <span class="w-5 shrink-0 text-right text-[11px] tabular-nums text-slate-400">
                {index + 1}.
              </span>
              <span
                class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide
                  {view.item.kind === 'feature'
                    ? 'bg-violet-100 text-violet-800'
                    : view.item.kind === 'surface'
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-cyan-100 text-cyan-800'}"
              >
                {view.item.kind}
              </span>
              <div class="min-w-0 flex-1 truncate">
                {#if view.item.kind === 'action'}
                  <a
                    href={withBase(`/features/${view.item.featureId}`)}
                    class="font-medium text-slate-900 hover:text-brand-800 hover:underline"
                  >
                    {view.actionName ?? '(unnamed action)'}
                  </a>
                  <span class="text-xs text-slate-500"> · {view.featureName}</span>
                {:else if view.item.kind === 'surface'}
                  <a
                    href={withBase(`/features/${view.item.featureId}`)}
                    class="font-medium text-slate-900 hover:text-brand-800 hover:underline"
                  >
                    {view.surfaceName ?? '(unnamed surface)'}
                  </a>
                  <span class="text-xs text-slate-500"> · {view.featureName}</span>
                {:else}
                  <a
                    href={withBase(`/features/${view.item.featureId}`)}
                    class="font-medium text-slate-900 hover:text-brand-800 hover:underline"
                  >
                    {view.featureName}
                  </a>
                {/if}
                {#if view.item.note}
                  <span class="block truncate text-xs text-slate-500">{view.item.note}</span>
                {/if}
              </div>
              {#if view.orphaned}
                <span class="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800" title="Target was deleted from the spec">
                  orphan
                </span>
              {/if}
              <div class="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                <button
                  type="button"
                  class="rounded px-1 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-30"
                  onclick={() => moveBy(itemId, -1)}
                  disabled={index === 0}
                  aria-label="Move up"
                  title="Move up"
                >
                  ↑
                </button>
                <button
                  type="button"
                  class="rounded px-1 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-30"
                  onclick={() => moveBy(itemId, 1)}
                  disabled={index === globalQueueStore.views.length - 1}
                  aria-label="Move down"
                  title="Move down"
                >
                  ↓
                </button>
                <button
                  type="button"
                  class="rounded px-1 text-xs text-slate-400 hover:bg-red-50 hover:text-red-600"
                  onclick={() => remove(itemId)}
                  aria-label="Remove from queue"
                  title="Remove from queue"
                >
                  ✕
                </button>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </section>
{:else}
  <button
    type="button"
    class="group fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full border border-slate-200 bg-white py-2.5 pl-4 pr-3 text-sm font-semibold text-slate-800 shadow-xl shadow-slate-950/15 ring-1 ring-slate-950/5 transition hover:border-brand-400 hover:shadow-brand-500/15"
    onclick={() => globalQueueStore.setOpen(true)}
    aria-label="Open implementation queue"
    title="Implementation queue"
  >
    <span class="text-brand-600 transition group-hover:translate-x-0.5" aria-hidden="true">▶</span>
    Queue
    <span class="rounded-full bg-brand-600 px-2 py-0.5 text-xs font-bold tabular-nums text-white">
      {globalQueueStore.views.length}
    </span>
  </button>
{/if}
