<script lang="ts">
  import { asSurfaceId, type SurfaceId } from '$features/behavior-model/domain/value-objects/ids';
  import {
    ALL_SURFACE_TYPES,
    surfaceTypeLabel,
    type SurfaceType
  } from '$features/behavior-model/domain/entities/Surface';
  type SurfaceTypeOrAll = SurfaceType | 'all';
  import { featureStore } from '$features/behavior-model/presentation/stores/featureStore.svelte';
  import { addSurface } from '$features/behavior-model/domain/services/FeatureTransforms';
  import { newSurface } from '$features/behavior-model/presentation/view-models/factories';
  import { cryptoIdGenerator } from '$shared/domain/IdGenerator';
  import { applyBlueprintsToFeature } from '$features/library/application/use-cases/ApplyBlueprintsToFeature';
  import { inMemoryBlueprintRepository } from '$features/library/infrastructure/InMemoryBlueprintRepository';
  import {
    ALL_BLUEPRINT_CATEGORIES,
    blueprintCategoryLabel,
    type BlueprintCategory
  } from '$features/library/domain/value-objects/BlueprintCategory';
  import {
    emptyFilter,
    filterBlueprints,
    type BlueprintFilter,
    type BlueprintSort
  } from '$features/library/domain/services/BlueprintFilter';
  import type { BlueprintId } from '$features/library/domain/value-objects/BlueprintId';
  import type { SurfaceBlueprint } from '$features/library/domain/entities/SurfaceBlueprint';
  import BlueprintCard from './BlueprintCard.svelte';

  type Connection = {
    readonly from: string;
    readonly to: string;
    readonly label: string | undefined;
  };

  /**
   * Preview the transitions that will exist between the picked blueprints
   * when "Add" is clicked. Runs each blueprint's build() with mock SurfaceIds
   *. The same applier mechanism used at apply time, so what the user sees
   * here matches what they'll get exactly.
   */
  function previewConnections(blueprints: readonly SurfaceBlueprint[]): readonly Connection[] {
    if (blueprints.length < 2) return [];
    const linkTargets = new Map<BlueprintId, SurfaceId>();
    for (const bp of blueprints) {
      linkTargets.set(bp.id, asSurfaceId(`preview-${bp.id}`));
    }
    let i = 0;
    const ids = () => `preview-id-${i++}`;
    const out: Connection[] = [];
    for (const bp of blueprints) {
      const ownSurfaceId = linkTargets.get(bp.id);
      if (!ownSurfaceId) continue;
      const built = bp.build({ ids, ownSurfaceId, linkTargets });
      for (const t of built.surface.transitions) {
        const target = blueprints.find((b) => linkTargets.get(b.id) === t.target);
        if (target) {
          out.push({ from: bp.name, to: target.name, label: t.label });
        }
      }
    }
    return out;
  }

  type Props = {
    open: boolean;
    onClose: () => void;
    onSurfacesAdded: (ids: readonly SurfaceId[]) => void;
  };
  let { open, onClose, onSurfacesAdded }: Props = $props();

  let dialogEl = $state<HTMLDialogElement | null>(null);

  let filter = $state<BlueprintFilter>({ ...emptyFilter });
  let selected = $state<Set<BlueprintId>>(new Set());

  // Blank-surface fallback form state
  let blankName = $state('');
  let blankType = $state<SurfaceType>('screen');

  $effect(() => {
    if (!dialogEl) return;
    if (open && !dialogEl.open) {
      // Fresh selection on every open. Close+reopen should not retain ticks.
      selected = new Set();
      filter = { ...emptyFilter };
      blankName = '';
      dialogEl.showModal();
    } else if (!open && dialogEl.open) {
      dialogEl.close();
    }
  });

  const blueprints = $derived(filterBlueprints(inMemoryBlueprintRepository.list(), filter));
  const selectedCount = $derived(selected.size);

  const selectedBlueprints = $derived.by<readonly SurfaceBlueprint[]>(() => {
    const list: SurfaceBlueprint[] = [];
    for (const id of selected) {
      const bp = inMemoryBlueprintRepository.findById(id);
      if (bp) list.push(bp);
    }
    return list;
  });

  const connections = $derived(previewConnections(selectedBlueprints));

  type ConnectionGroup = { readonly from: string; readonly targets: readonly string[] };

  const connectionGroups = $derived.by<readonly ConnectionGroup[]>(() => {
    const byFrom = new Map<string, string[]>();
    for (const conn of connections) {
      if (!byFrom.has(conn.from)) byFrom.set(conn.from, []);
      byFrom.get(conn.from)!.push(conn.to);
    }
    return Array.from(byFrom.entries())
      .map(([from, targets]) => ({ from, targets }))
      .sort((a, b) => a.from.localeCompare(b.from));
  });

  function close() {
    onClose();
  }

  function toggle(id: BlueprintId) {
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    selected = next;
  }

  async function addSelected() {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    let added: readonly SurfaceId[] = [];
    await featureStore.mutate((current) => {
      const result = applyBlueprintsToFeature(
        inMemoryBlueprintRepository,
        current,
        ids,
        cryptoIdGenerator,
        { includeSiblings: false }
      );
      added = result.addedSurfaceIds;
      return result.feature;
    });
    onSurfacesAdded(added);
    close();
  }

  async function createBlank() {
    const name = blankName.trim();
    if (name.length === 0) return;
    const surface = newSurface(cryptoIdGenerator, { name, type: blankType });
    await featureStore.mutate((current) => addSurface(current, surface));
    onSurfacesAdded([surface.id]);
    blankName = '';
    close();
  }

  function setCategory(c: BlueprintCategory | 'all') {
    filter = { ...filter, category: c };
  }

  function setSort(s: BlueprintSort) {
    filter = { ...filter, sort: s };
  }

  function setQuery(q: string) {
    filter = { ...filter, query: q };
  }

  function setSurfaceType(t: SurfaceTypeOrAll) {
    filter = { ...filter, surfaceType: t };
  }
</script>

<dialog
  bind:this={dialogEl}
  onclose={close}
  class="fixed left-1/2 top-1/2 max-h-[85vh] w-[min(960px,95vw)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-hairline bg-white p-0 shadow-xl backdrop:bg-slate-950/40 backdrop:backdrop-blur-sm"
>
  <div class="flex h-full max-h-[85vh] flex-col">
    <header class="flex items-center justify-between border-b border-hairline px-5 py-4">
      <div>
        <h2 class="text-base font-semibold text-slate-950">Surface library</h2>
        <p class="mt-0.5 text-xs text-slate-500">
          Pick one or many surfaces. Every entry scores 100% on the maturity check.
        </p>
      </div>
      <button
        type="button"
        onclick={close}
        aria-label="Close library"
        class="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100 hover:text-slate-950"
      >
        ✕
      </button>
    </header>

    <div class="flex flex-wrap items-center gap-2 border-b border-hairline bg-slate-50/70 px-5 py-3">
      <input
        type="search"
        placeholder="Search by name, summary, or tag…"
        value={filter.query}
        oninput={(e) => setQuery((e.target as HTMLInputElement).value)}
        class="min-w-55 flex-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-slate-900"
      />
      <div class="flex items-center gap-1 text-xs">
        <button
          type="button"
          class="rounded-full px-2 py-1 transition {filter.category === 'all'
            ? 'bg-slate-900 text-white'
            : 'bg-white text-slate-700 ring-1 ring-hairline hover:bg-slate-50'}"
          onclick={() => setCategory('all')}
        >
          All
        </button>
        {#each ALL_BLUEPRINT_CATEGORIES as c (c)}
          <button
            type="button"
            class="rounded-full px-2 py-1 transition {filter.category === c
              ? 'bg-slate-900 text-white'
              : 'bg-white text-slate-700 ring-1 ring-hairline hover:bg-slate-50'}"
            onclick={() => setCategory(c)}
          >
            {blueprintCategoryLabel(c)}
          </button>
        {/each}
      </div>
      <label class="flex items-center gap-1 text-xs text-slate-600">
        Type
        <select
          value={filter.surfaceType}
          onchange={(e) =>
            setSurfaceType((e.target as HTMLSelectElement).value as SurfaceTypeOrAll)}
          class="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
        >
          <option value="all">All types</option>
          {#each ALL_SURFACE_TYPES as t (t)}
            <option value={t}>{surfaceTypeLabel(t)}</option>
          {/each}
        </select>
      </label>
      <label class="flex items-center gap-1 text-xs text-slate-600">
        Sort
        <select
          value={filter.sort}
          onchange={(e) => setSort((e.target as HTMLSelectElement).value as BlueprintSort)}
          class="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
        >
          <option value="name">Name</option>
          <option value="category">Category</option>
        </select>
      </label>
    </div>

    <div class="flex-1 overflow-y-auto px-5 py-4">
      {#if blueprints.length === 0}
        <p class="text-center text-sm italic text-slate-500">
          No blueprint matches this filter.
        </p>
      {:else}
        <ul class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {#each blueprints as blueprint (blueprint.id)}
            <li>
              <BlueprintCard
                {blueprint}
                selected={selected.has(blueprint.id)}
                onToggle={() => toggle(blueprint.id)}
              />
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    {#if connectionGroups.length > 0}
      <div class="border-t border-hairline bg-emerald-50/70 px-5 py-2">
        <h4
          class="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800"
        >
          {connections.length} connection{connections.length === 1 ? '' : 's'} will be created
        </h4>
        <ul class="space-y-1 text-xs">
          {#each connectionGroups as group (group.from)}
            <li class="flex flex-wrap items-baseline gap-x-2">
              <span class="min-w-26 font-medium text-emerald-900">{group.from}</span>
              {#each group.targets as target, idx (idx)}
                <span class="text-emerald-500">→</span>
                <span class="text-emerald-800">{target}</span>
              {/each}
            </li>
          {/each}
        </ul>
      </div>
    {:else if selectedCount > 1}
      <div
        class="border-t border-hairline bg-slate-50 px-5 py-2 text-[11px] italic text-slate-500"
      >
        These surfaces don't link to each other.
      </div>
    {/if}

    <footer
      class="flex flex-wrap items-center gap-3 border-t border-hairline bg-slate-50 px-5 py-3"
    >
      <details class="flex-1 min-w-55">
        <summary class="cursor-pointer text-xs font-medium text-slate-700">
          Or create a blank surface instead
        </summary>
        <div class="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_160px_auto]">
          <input
            type="text"
            bind:value={blankName}
            placeholder="Surface name"
            class="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-slate-900"
          />
          <select
            bind:value={blankType}
            class="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-slate-900"
          >
            {#each ALL_SURFACE_TYPES as t (t)}
              <option value={t}>{surfaceTypeLabel(t)}</option>
            {/each}
          </select>
          <button
            type="button"
            onclick={createBlank}
            disabled={blankName.trim().length === 0}
            class="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            Create blank
          </button>
        </div>
      </details>

      <button
        type="button"
        onclick={addSelected}
        disabled={selectedCount === 0}
        class="ml-auto rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        Add{selectedCount > 0 ? ` (${selectedCount})` : ''}
      </button>
    </footer>
  </div>
</dialog>
