<script lang="ts">
  import { tick } from 'svelte';
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
  import { tourStore } from '$features/tutorial/presentation/stores/tourStore.svelte';
  import { evaluateTourSubmitGuard } from '$features/tutorial/domain/services/SubmitGuard';
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
  import { connectableToSelection } from '$features/library/domain/services/BlueprintConnections';
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
   * when "Add" is clicked. Runs each blueprint's build() with mock SurfaceIds.
   * The same applier mechanism used at apply time, so what the user sees here
   * matches what they'll get exactly.
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
  let blankNameInput = $state<HTMLInputElement | null>(null);

  // Step machine. The dialog opens on the chooser so a user who just wants a
  // blank surface doesn't have to scroll past the template library to find
  // the (previously) tucked-away <details>.
  type Step = 'chooser' | 'blank' | 'library';
  let step = $state<Step>('chooser');

  let filter = $state<BlueprintFilter>({ ...emptyFilter });
  let selected = $state<Set<BlueprintId>>(new Set());

  let blankName = $state('');
  let blankType = $state<SurfaceType>('screen');

  // Tutor-mode guard: blocks blank-surface submit until name matches the
  // tour's `requireExact.value`. Pure predicate from the domain layer.
  const tourGuard = $derived(
    evaluateTourSubmitGuard(tourStore.currentStep, 'blank-surface', blankName)
  );

  $effect(() => {
    if (!dialogEl) return;
    if (open && !dialogEl.open) {
      // Fresh state on every open. Close+reopen should not retain ticks or
      // previously-typed names.
      step = 'chooser';
      selected = new Set();
      filter = { ...emptyFilter };
      blankName = '';
      blankType = 'screen';
      dialogEl.showModal();
    } else if (!open && dialogEl.open) {
      dialogEl.close();
    }
  });

  // Autofocus the name input when the user enters the blank step.
  $effect(() => {
    if (step !== 'blank') return;
    void tick().then(() => blankNameInput?.focus());
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

  // Which unselected blueprints would wire up to the current picks, and the
  // names they'd link to. Computed against the full library (not just the
  // filtered view) so connectability is stable while the user searches.
  const connectableMap = $derived(
    connectableToSelection(inMemoryBlueprintRepository.list(), selected)
  );

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

  function handleBlankKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && blankName.trim().length > 0) {
      event.preventDefault();
      void createBlank();
    }
  }
</script>

<dialog
  bind:this={dialogEl}
  onclose={close}
  class="fixed left-1/2 top-1/2 max-h-[85vh] {step === 'chooser'
    ? 'w-[min(560px,95vw)]'
    : step === 'blank'
      ? 'w-[min(560px,95vw)]'
      : 'w-[min(960px,95vw)]'} -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-hairline bg-white p-0 shadow-xl backdrop:bg-slate-950/40 backdrop:backdrop-blur-sm"
>
  <div class="flex h-full max-h-[85vh] flex-col">
    <header class="flex items-center justify-between border-b border-hairline px-5 py-4">
      <div class="flex min-w-0 items-center gap-2">
        {#if step !== 'chooser'}
          <button
            type="button"
            onclick={() => (step = 'chooser')}
            class="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-950"
            aria-label="Back to chooser"
            title="Back"
          >
            &larr;
          </button>
        {/if}
        <div class="min-w-0">
          <h2 class="truncate text-base font-semibold text-slate-950">
            {#if step === 'chooser'}
              Add a surface
            {:else if step === 'blank'}
              Create a new surface
            {:else}
              Surface library
            {/if}
          </h2>
          <p class="mt-0.5 truncate text-xs text-slate-500">
            {#if step === 'chooser'}
              How do you want to start?
            {:else if step === 'blank'}
              You'll define states, actions, and rules yourself.
            {:else}
              Pick one or many ready-made surfaces. Each scores 100% maturity.
            {/if}
          </p>
        </div>
      </div>
      <button
        type="button"
        onclick={close}
        aria-label="Close"
        title="Close"
        class="ml-2 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-brand-400"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="h-4 w-4"
          aria-hidden="true"
        >
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      </button>
    </header>

    {#if step === 'chooser'}
      <div class="grid flex-1 grid-cols-1 gap-4 p-6 sm:grid-cols-2">
        <button
          type="button"
          data-tour="chooser-create-new"
          onclick={() => (step = 'blank')}
          class="group flex h-full flex-col items-start gap-3 rounded-2xl border-2 border-slate-200 bg-white p-6 text-left transition hover:-translate-y-0.5 hover:border-brand-500 hover:bg-cyan-50/40 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-brand-400"
        >
          <span
            class="grid h-12 w-12 place-items-center rounded-xl bg-slate-100 text-2xl text-slate-700 transition group-hover:bg-brand-100 group-hover:text-brand-800"
            aria-hidden="true"
          >
            +
          </span>
          <span class="block">
            <span class="block text-base font-semibold text-slate-950 group-hover:text-brand-900">
              Create new
            </span>
            <span class="mt-1 block text-xs leading-5 text-slate-500">
              Start from a blank surface. You choose the type and name; everything inside is yours to define.
            </span>
          </span>
        </button>

        <button
          type="button"
          onclick={() => (step = 'library')}
          class="group flex h-full flex-col items-start gap-3 rounded-2xl border-2 border-slate-200 bg-white p-6 text-left transition hover:-translate-y-0.5 hover:border-brand-500 hover:bg-cyan-50/40 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-brand-400"
        >
          <span
            class="grid h-12 w-12 place-items-center rounded-xl bg-emerald-50 text-2xl text-emerald-700 transition group-hover:bg-emerald-100 group-hover:text-emerald-800"
            aria-hidden="true"
          >
            *
          </span>
          <span class="block">
            <span class="block text-base font-semibold text-slate-950 group-hover:text-brand-900">
              From template
            </span>
            <span class="mt-1 block text-xs leading-5 text-slate-500">
              Pick from a library of ready-made surfaces - auth, checkout, dashboards - each pre-modeled to 100% maturity.
            </span>
          </span>
        </button>
      </div>
    {:else if step === 'blank'}
      <form
        class="flex flex-1 flex-col gap-4 p-6"
        data-tour="blank-surface-form"
        onsubmit={(event) => {
          event.preventDefault();
          void createBlank();
        }}
      >
        <label class="block">
          <span class="block text-xs font-medium text-slate-700">Surface name</span>
          <input
            bind:this={blankNameInput}
            type="text"
            bind:value={blankName}
            onkeydown={handleBlankKeydown}
            placeholder="e.g. Checkout, Project board, MCP Server"
            class="mt-1 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-100"
            required
          />
        </label>
        <label class="block">
          <span class="block text-xs font-medium text-slate-700">Surface type</span>
          <select
            bind:value={blankType}
            class="mt-1 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-100"
          >
            {#each ALL_SURFACE_TYPES as t (t)}
              <option value={t}>{surfaceTypeLabel(t)}</option>
            {/each}
          </select>
        </label>
        <div class="mt-2 flex justify-end gap-2">
          <button
            type="button"
            onclick={() => (step = 'chooser')}
            class="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Back
          </button>
          <button
            type="submit"
            disabled={blankName.trim().length === 0 || tourGuard.blocked}
            title={tourGuard.blocked
              ? `Tutorial: name must be exactly "${tourGuard.requiredValue}"`
              : undefined}
            class="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            Create surface
          </button>
        </div>
      </form>
    {:else}
      <div class="flex flex-col gap-2 border-b border-hairline bg-slate-50/70 px-5 py-3">
        <div class="flex flex-wrap items-center gap-2">
          <input
            type="search"
            placeholder="Search by name, summary, or tag..."
            value={filter.query}
            oninput={(e) => setQuery((e.target as HTMLInputElement).value)}
            class="min-w-55 flex-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-slate-900"
          />
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
        <!-- Category pills get their own scroll-capped, wrapping row so the
             growing set of categories never overflows the dialog. -->
        <div class="flex max-h-16 flex-wrap items-center gap-1 overflow-y-auto text-xs">
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
      </div>

      {#if connectableMap.size > 0}
        <div
          class="flex items-center gap-2 border-b border-hairline bg-emerald-50/40 px-5 py-1.5 text-[11px] text-emerald-800"
        >
          <span class="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-400" aria-hidden="true"
          ></span>
          <span>Green cards link to your selection - add them to wire the surfaces together.</span>
        </div>
      {/if}

      <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
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
                  connectsTo={connectableMap.get(blueprint.id) ?? []}
                  dimmed={selectedCount > 0 &&
                    !selected.has(blueprint.id) &&
                    !connectableMap.has(blueprint.id)}
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
                  <span class="text-emerald-500">&rarr;</span>
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
        class="flex flex-wrap items-center justify-end gap-2 border-t border-hairline bg-slate-50 px-5 py-3"
      >
        <button
          type="button"
          onclick={() => (step = 'chooser')}
          class="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Back
        </button>
        <button
          type="button"
          onclick={addSelected}
          disabled={selectedCount === 0}
          class="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          Add{selectedCount > 0 ? ` (${selectedCount})` : ''}
        </button>
      </footer>
    {/if}
  </div>
</dialog>
