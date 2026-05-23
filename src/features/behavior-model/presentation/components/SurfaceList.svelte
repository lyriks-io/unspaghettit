<script lang="ts">
  import type { Feature } from '$features/behavior-model/domain/entities/Feature';
  import { surfaceTypeLabel } from '$features/behavior-model/domain/entities/Surface';
  import type { SurfaceId } from '$features/behavior-model/domain/value-objects/ids';
  import { featureStore } from '$features/behavior-model/presentation/stores/featureStore.svelte';
  import {
    canMoveSurfaceDown,
    canMoveSurfaceUp,
    moveSurfaceBy,
    moveSurfaceTo,
    removeSurface,
    setSurfaceParent,
    surfaceDepth,
    type SurfaceDropTarget
  } from '$features/behavior-model/domain/services/FeatureTransforms';
  import LibraryDialog from '$features/library/presentation/components/LibraryDialog.svelte';
  import { emit } from '$shared/events/eventBus';

  type Props = {
    feature: Feature;
    selectedId: SurfaceId | null;
    onSelect: (id: SurfaceId) => void;
  };
  let { feature, selectedId, onSelect }: Props = $props();

  let dialogOpen = $state(false);

  // Drag-and-drop state. `dragging` is the id being dragged; `dropTarget` is
  // the id under the cursor and which third of the row (before / inside /
  // after) is currently highlighted.
  let dragging = $state<SurfaceId | null>(null);
  let dropTargetId = $state<SurfaceId | null>(null);
  let dropZone = $state<SurfaceDropTarget['kind'] | null>(null);

  async function handleRemove(id: SurfaceId) {
    if (!confirm('Delete this surface and everything inside it?')) return;
    await featureStore.mutate((current) => removeSurface(current, id));
    emit('editor.surface.removed', { surfaceId: String(id) });
  }

  async function move(id: SurfaceId, delta: -1 | 1) {
    await featureStore.mutate((current) => moveSurfaceBy(current, id, delta));
  }

  async function indent(id: SurfaceId, index: number) {
    const surfaces = feature.surfaces;
    const myDepth = surfaceDepth(surfaces, id);
    for (let i = index - 1; i >= 0; i--) {
      const candidate = surfaces[i];
      if (!candidate) continue;
      const candidateDepth = surfaceDepth(surfaces, candidate.id);
      if (candidateDepth <= myDepth) {
        await featureStore.mutate((current) => setSurfaceParent(current, id, candidate.id));
        return;
      }
    }
  }

  async function outdent(id: SurfaceId) {
    const surfaces = feature.surfaces;
    const me = surfaces.find((s) => s.id === id);
    if (!me?.parentSurfaceId) return;
    const parent = surfaces.find((s) => s.id === me.parentSurfaceId);
    const grandparentId = parent?.parentSurfaceId ?? null;
    await featureStore.mutate((current) => setSurfaceParent(current, id, grandparentId));
  }

  function canIndent(id: SurfaceId, index: number): boolean {
    if (index === 0) return false;
    const surfaces = feature.surfaces;
    const myDepth = surfaceDepth(surfaces, id);
    for (let i = index - 1; i >= 0; i--) {
      const candidate = surfaces[i];
      if (!candidate) continue;
      if (surfaceDepth(surfaces, candidate.id) <= myDepth) return true;
    }
    return false;
  }

  function onSurfacesAdded(ids: readonly SurfaceId[]) {
    for (const id of ids) emit('editor.surface.added', { surfaceId: String(id) });
    const first = ids[0];
    if (first) onSelect(first);
  }

  /**
   * Whether `descendant` is in the subtree rooted at `ancestorId`. Used to
   * dim the moved subtree during drag and to suppress drop targets within it
   * (would create a cycle).
   */
  function isInSubtree(ancestorId: SurfaceId, descendantId: SurfaceId): boolean {
    if (ancestorId === descendantId) return true;
    const surfaces = feature.surfaces;
    let current = surfaces.find((s) => s.id === descendantId);
    let depth = 0;
    while (current?.parentSurfaceId && depth < 32) {
      if (current.parentSurfaceId === ancestorId) return true;
      current = surfaces.find((s) => s.id === current!.parentSurfaceId);
      depth++;
    }
    return false;
  }

  function onDragStart(event: DragEvent, id: SurfaceId) {
    dragging = id;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', id);
    }
  }

  function onDragOver(event: DragEvent, id: SurfaceId) {
    if (!dragging || dragging === id) return;
    if (isInSubtree(dragging, id)) return; // cannot drop inside own subtree
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const h = rect.height;
    let zone: SurfaceDropTarget['kind'];
    if (y < h * 0.3) zone = 'before';
    else if (y > h * 0.7) zone = 'after';
    else zone = 'inside';
    dropTargetId = id;
    dropZone = zone;
  }

  function onDragLeave(event: DragEvent) {
    // Only clear when actually leaving the row, not when moving over a child.
    const related = event.relatedTarget as Node | null;
    const target = event.currentTarget as Node;
    if (related && target.contains(related)) return;
    dropTargetId = null;
    dropZone = null;
  }

  async function onDrop(event: DragEvent, id: SurfaceId) {
    event.preventDefault();
    const moved = dragging;
    const zone = dropZone;
    resetDrag();
    if (!moved || moved === id || !zone) return;
    if (isInSubtree(moved, id)) return;
    await featureStore.mutate((current) =>
      moveSurfaceTo(current, moved, { kind: zone, targetId: id })
    );
  }

  function onDragEnd() {
    resetDrag();
  }

  function resetDrag() {
    dragging = null;
    dropTargetId = null;
    dropZone = null;
  }
</script>

<section class="rounded-lg border border-hairline bg-white">
  <header class="flex items-center justify-between border-b border-hairline px-3 py-2.5">
    <h2 class="text-sm font-semibold text-slate-950">Surfaces</h2>
    <button
      type="button"
      class="inline-flex items-center gap-1 rounded-md bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-50"
      onclick={() => (dialogOpen = true)}
    >
      <span aria-hidden="true">+</span>
      <span>Add surface</span>
    </button>
  </header>

  <ul class="max-h-[60vh] divide-y divide-slate-100 overflow-auto">
    {#each feature.surfaces as surface, index (surface.id)}
      {@const isSelected = selectedId === surface.id}
      {@const canMoveUp = canMoveSurfaceUp(feature.surfaces, surface.id)}
      {@const canMoveDown = canMoveSurfaceDown(feature.surfaces, surface.id)}
      {@const depth = surfaceDepth(feature.surfaces, surface.id)}
      {@const indentable = canIndent(surface.id, index)}
      {@const outdentable = depth > 0}
      {@const inDraggedSubtree = dragging !== null && isInSubtree(dragging, surface.id)}
      {@const isDropTarget = dropTargetId === surface.id && dropZone !== null}
      <li
        draggable="true"
        ondragstart={(e) => onDragStart(e, surface.id)}
        ondragover={(e) => onDragOver(e, surface.id)}
        ondragleave={onDragLeave}
        ondrop={(e) => onDrop(e, surface.id)}
        ondragend={onDragEnd}
        class="group relative flex items-start justify-between gap-2 py-2 pr-3 text-sm transition-colors {isSelected
          ? 'border-l-4 border-brand-700 bg-brand-50'
          : 'border-l-4 border-transparent hover:bg-slate-50'} {inDraggedSubtree
          ? 'opacity-60 ring-2 ring-brand-200'
          : ''} {isDropTarget && dropZone === 'inside'
          ? 'bg-brand-50 ring-2 ring-brand-300 ring-inset'
          : ''}"
        style="padding-left: {(isSelected ? 8 : 12) + depth * 14}px"
      >
        {#if isDropTarget && dropZone === 'before'}
          <div
            class="pointer-events-none absolute left-0 right-0 top-0 h-0.5 bg-brand-600"
          ></div>
        {/if}
        {#if isDropTarget && dropZone === 'after'}
          <div
            class="pointer-events-none absolute bottom-0 left-0 right-0 h-0.5 bg-brand-600"
          ></div>
        {/if}

        <button
          type="button"
          class="min-w-0 flex-1 text-left"
          onclick={() => onSelect(surface.id)}
        >
          <div
            class="flex items-center gap-1 truncate font-medium {isSelected
              ? 'text-brand-900'
              : 'text-slate-950'}"
          >
            {#if depth > 0}<span class="text-slate-400">↳</span>{/if}
            <span class="truncate">{surface.name}</span>
          </div>
          <div class="text-xs {isSelected ? 'text-brand-700' : 'text-slate-500'}">
            {surfaceTypeLabel(surface.type)} · {surface.actions.length} action(s)
          </div>
        </button>
        <div class="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            class="rounded px-1 text-xs text-slate-400 opacity-0 transition-opacity hover:bg-slate-100 hover:text-slate-700 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-0 group-hover:disabled:opacity-30"
            onclick={() => outdent(surface.id)}
            disabled={!outdentable}
            aria-label={`Outdent ${surface.name}`}
            title="Outdent (lift out of parent)"
          >
            ◀
          </button>
          <button
            type="button"
            class="rounded px-1 text-xs text-slate-400 opacity-0 transition-opacity hover:bg-slate-100 hover:text-slate-700 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-0 group-hover:disabled:opacity-30"
            onclick={() => indent(surface.id, index)}
            disabled={!indentable}
            aria-label={`Indent ${surface.name} as child of previous`}
            title="Indent under previous surface"
          >
            ▶
          </button>
          <span class="mx-0.5 h-3 w-px bg-slate-200 opacity-0 group-hover:opacity-100"></span>
          <button
            type="button"
            class="rounded px-1 text-xs text-slate-400 opacity-0 transition-opacity hover:bg-slate-100 hover:text-slate-700 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-0 group-hover:disabled:opacity-30"
            onclick={() => move(surface.id, -1)}
            disabled={!canMoveUp}
            aria-label={`Move ${surface.name} up`}
            title="Move up"
          >
            ▲
          </button>
          <button
            type="button"
            class="rounded px-1 text-xs text-slate-400 opacity-0 transition-opacity hover:bg-slate-100 hover:text-slate-700 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-0 group-hover:disabled:opacity-30"
            onclick={() => move(surface.id, 1)}
            disabled={!canMoveDown}
            aria-label={`Move ${surface.name} down`}
            title="Move down"
          >
            ▼
          </button>
          <button
            type="button"
            class="rounded px-1 text-xs text-slate-400 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 {isSelected
              ? 'opacity-100 text-brand-700'
              : ''}"
            onclick={() => handleRemove(surface.id)}
            aria-label={`Delete surface ${surface.name}`}
          >
            ✕
          </button>
        </div>
      </li>
    {/each}
    {#if feature.surfaces.length === 0}
      <li class="px-3 py-4 text-center text-xs text-slate-500">No surfaces yet.</li>
    {/if}
  </ul>
</section>

<LibraryDialog
  open={dialogOpen}
  onClose={() => (dialogOpen = false)}
  onSurfacesAdded={(ids) => onSurfacesAdded(ids)}
/>
