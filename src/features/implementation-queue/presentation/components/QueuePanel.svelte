<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { projectStore } from '$features/projects/presentation/stores/projectStore.svelte';
  import { queueStore } from '../stores/queueStore.svelte';
  import type { QueueItemId } from '../../domain/entities/QueueItem';

  // Refresh whenever the active project or its queue snapshot changes.
  // Reading `implementationQueue` inside $effect makes the effect re-run
  // when Yjs reconciles a remote change, keeping the panel live across
  // multiple dashboard tabs.
  $effect(() => {
    const _ = projectStore.project?.implementationQueue;
    void _;
    untrack(() => {
      void queueStore.refresh();
    });
  });

  onMount(() => {
    void queueStore.refresh();
  });

  // ── drag-and-drop reorder ─────────────────────────────────────────────
  // Plain HTML5 DnD: light, no extra deps, accessible enough with the
  // up/down keyboard buttons rendered alongside the handle.
  let draggingId = $state<QueueItemId | null>(null);
  let overIndex = $state<number | null>(null);

  function onDragStart(e: DragEvent, itemId: QueueItemId) {
    draggingId = itemId;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      // Firefox requires a payload for the drag to fire dragover events.
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
    if (!moving || !projectStore.project) return;
    await queueStore.moveTo(projectStore.project.id, moving, targetIndex);
  }

  function onDragEnd() {
    draggingId = null;
    overIndex = null;
  }

  async function moveBy(itemId: QueueItemId, delta: -1 | 1) {
    if (!projectStore.project) return;
    const current = queueStore.views.findIndex((v) => v.item.id === itemId);
    if (current < 0) return;
    await queueStore.moveTo(projectStore.project.id, itemId, current + delta);
  }

  async function remove(itemId: QueueItemId) {
    if (!projectStore.project) return;
    await queueStore.dequeue(projectStore.project.id, itemId);
  }
</script>

<div class="space-y-3">
  <header class="flex items-start justify-between gap-3">
    <div>
      <h2 class="text-sm font-semibold text-slate-800">Implementation queue</h2>
      <p class="mt-1 text-xs text-slate-500">
        What to implement next. Drag to reorder. The MCP <code class="mono text-[11px]">get_next_queued</code> tool reads the top live entry so an LLM can pick up where you left off without you naming the feature.
      </p>
    </div>
    <span class="shrink-0 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
      {queueStore.views.length}
    </span>
  </header>

  {#if queueStore.error}
    <p class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
      {queueStore.error}
    </p>
  {/if}

  {#if queueStore.views.length === 0}
    <div class="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-xs text-slate-500">
      <p class="font-medium text-slate-700">No items queued yet.</p>
      <p class="mt-1 mx-auto max-w-md">
        Hover any Feature card or any Action row and click <strong>+ queue</strong> to add it here. Then ask your LLM &quot;implement the next thing in the queue&quot;.
      </p>
    </div>
  {:else}
    <ul class="space-y-1.5">
      {#each queueStore.views as view, index (view.item.id)}
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
                href={`/features/${view.item.featureId}`}
                class="font-medium text-slate-900 hover:text-brand-800 hover:underline"
              >
                {view.actionName ?? '(unnamed action)'}
              </a>
              <span class="text-xs text-slate-500"> · {view.featureName}</span>
            {:else if view.item.kind === 'surface'}
              <a
                href={`/features/${view.item.featureId}`}
                class="font-medium text-slate-900 hover:text-brand-800 hover:underline"
              >
                {view.surfaceName ?? '(unnamed surface)'}
              </a>
              <span class="text-xs text-slate-500"> · {view.featureName}</span>
            {:else}
              <a
                href={`/features/${view.item.featureId}`}
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
              disabled={index === queueStore.views.length - 1}
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
              x
            </button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>
