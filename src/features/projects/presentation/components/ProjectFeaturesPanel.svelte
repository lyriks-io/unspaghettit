<script lang="ts">
  import { tick } from "svelte";
  import FeatureCard from "$features/behavior-model/presentation/components/FeatureCard.svelte";
  import type { Feature } from "$features/behavior-model/domain/entities/Feature";
  import type { FeatureId } from "$features/behavior-model/domain/value-objects/ids";
  import type { FeatureCardModel } from "$features/behavior-model/application/use-cases/ListFeaturesWithMaturity";
  import { scoreFeature } from "$features/maturity/domain/MaturityScorer";
  import { computeImplementationBreakdown } from "$features/implementation-status/domain/ImplementationBreakdown";
  import type { ImplementationStatus } from "$features/implementation-status/domain/ImplementationStatus";
  import { humanizeTagText, tagKey, type Tag } from "$shared/domain/Tags";
  import TagFilterSelect, {
    type TagFilterValue
  } from "$features/tag-palette/presentation/components/TagFilterSelect.svelte";
  import { tagPaletteStore } from "$features/tag-palette/presentation/stores/tagPaletteStore.svelte";
  import { projectStore } from "$features/projects/presentation/stores/projectStore.svelte";
  import { queueItemKey } from "$features/implementation-queue/domain/entities/QueueItem";
  import { getBrowserContainer } from "$shared/infrastructure/browserContainer";
  import { tourStore } from "$features/tutorial/presentation/stores/tourStore.svelte";
  import { evaluateTourSubmitGuard } from "$features/tutorial/domain/services/SubmitGuard";
  import { subscribeSyncEvents } from "$lib/client/sync/syncEvents";

  type Props = {
    features: readonly Feature[];
    search: string;
    onSearch: (query: string) => void;
    onCreate: (name: string, description: string) => void | Promise<void>;
    onAddTag: (id: FeatureId, tag: Tag) => void | Promise<void>;
    onRemoveTag?: (id: FeatureId, tag: Tag) => void | Promise<void>;
    onRemove: (id: FeatureId) => void | Promise<void>;
  };

  let { features, search, onSearch, onCreate, onAddTag, onRemoveTag, onRemove }: Props =
    $props();

  let tagFilter = $state<TagFilterValue>("all");

  function matchesSearch(feature: Feature, query: string): boolean {
    if (query.length === 0) return true;
    return (
      feature.name.toLowerCase().includes(query) ||
      (feature.description ?? "").toLowerCase().includes(query)
    );
  }

  function matchesTagFilter(feature: Feature, filter: TagFilterValue): boolean {
    const featureTags = feature.tags ?? [];
    if (filter === "all") return true;
    if (filter === "untagged") return featureTags.length === 0;
    const key = tagKey(filter);
    return featureTags.some((tag) => tagKey(tag) === key);
  }

  const filteredMembers = $derived.by(() => {
    const q = search.trim().toLowerCase();
    return features.filter(
      (feature) => matchesSearch(feature, q) && matchesTagFilter(feature, tagFilter)
    );
  });

  const allTagsFlat = $derived.by<readonly Tag[]>(() => {
    const out: Tag[] = [];
    for (const feature of features) {
      for (const tag of feature.tags ?? []) out.push(tag);
    }
    return out;
  });

  // Keep the auto-color allocator aware of every type rendered here so
  // colors stay consistent with the global index pages.
  $effect(() => {
    tagPaletteStore.registerTypes(allTagsFlat.map((tag) => tag.type));
  });

  function tagFilterCount(filter: TagFilterValue): number {
    const q = search.trim().toLowerCase();
    return features.filter(
      (feature) => matchesSearch(feature, q) && matchesTagFilter(feature, filter)
    ).length;
  }

  let addOpen = $state(false);
  let newNameInput = $state<HTMLInputElement | null>(null);
  let sortBy = $state<"updated" | "name" | "maturity">("updated");
  let newName = $state("");
  let newDescription = $state("");
  let creating = $state(false);

  // Tutor-mode guard: blocks submit until name matches the tour's
  // current `requireExact.value`. Pure predicate from the domain layer.
  const tourGuard = $derived(
    evaluateTourSubmitGuard(tourStore.currentStep, "new-feature", newName)
  );

  // Impl statuses fetched per feature on demand. Cards show "-" until the
  // fetch lands so layout doesn't shift, then update reactively in place.
  let implByFeatureId = $state<Map<string, ImplementationStatus | null>>(
    new Map(),
  );

  $effect(() => {
    const ids = features.map((f) => String(f.id));
    let cancelled = false;
    void (async () => {
      const container = await getBrowserContainer();
      const missing = ids.filter((id) => !implByFeatureId.has(id));
      if (missing.length === 0) return;
      const entries = await Promise.all(
        missing.map(
          async (id) =>
            [id, await container.statusRepository.get(id as FeatureId)] as const,
        ),
      );
      if (cancelled) return;
      const next = new Map(implByFeatureId);
      for (const [id, status] of entries) next.set(id, status);
      implByFeatureId = next;
    })();
    return () => {
      cancelled = true;
    };
  });

  // Re-fetch one feature's implementation status into the cache. The cache
  // effect above only fills MISSING ids, so an MCP coverage report never
  // refreshes an already-cached entry on its own.
  async function refreshImplStatus(featureId: string): Promise<void> {
    try {
      const container = await getBrowserContainer();
      const status = await container.statusRepository.get(featureId as FeatureId);
      const next = new Map(implByFeatureId);
      next.set(featureId, status);
      implByFeatureId = next;
    } catch {
      // Best-effort live refresh; a full reload still reconciles.
    }
  }

  // Live-refresh the implementation score. An MCP `report_implementation_status`
  // broadcasts an 'implementation-status' sync event; without this the card kept
  // showing the old percentage until a full page reload. A 'feature' edit can
  // also change the expected count, so refetch the status on that kind too.
  $effect(() => {
    const unsubscribe = subscribeSyncEvents((evt) => {
      if (evt.kind !== "implementation-status" && evt.kind !== "feature") return;
      if (!features.some((f) => String(f.id) === evt.id)) return;
      void refreshImplStatus(evt.id);
    });
    return unsubscribe;
  });

  $effect(() => {
    if (!addOpen) return;
    void tick().then(() => newNameInput?.focus());
  });

  function openAdd() {
    addOpen = true;
  }

  function closeAdd() {
    addOpen = false;
    newName = "";
    newDescription = "";
  }

  async function handleCreate() {
    const name = newName.trim();
    if (creating || name.length === 0) return;
    if (newDescription.trim().length === 0) return;
    creating = true;
    try {
      await onCreate(name, newDescription.trim());
      closeAdd();
    } finally {
      creating = false;
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") closeAdd();
  }

  function toFeatureCard(feature: Feature): FeatureCardModel {
    const report = scoreFeature(feature);
    const impl = computeImplementationBreakdown(
      feature,
      implByFeatureId.get(String(feature.id)) ?? null,
    );
    return {
      id: feature.id,
      name: feature.name,
      description: feature.description,
      surfaceCount: feature.surfaces.length,
      actionCount: feature.surfaces.reduce(
        (acc, surface) => acc + surface.actions.length,
        0,
      ),
      createdAt: feature.createdAt,
      updatedAt: feature.updatedAt,
      tags: feature.tags,
      maturityPercentage: report.percentage,
      criticalIssueCount: report.criticalIssues.length,
      recommendedIssueCount: report.recommendedIssues.length,
      implementationPercentage:
        impl.expectedCount === 0 ? null : impl.percentage,
      implementationFoundCount: impl.foundCount,
      implementationExpectedCount: impl.expectedCount,
      implementationHasReport: impl.hasReport,
    };
  }

  const filteredCards = $derived.by(() => {
    const cards = filteredMembers.map(toFeatureCard);
    return cards.sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      if (sortBy === "maturity")
        return b.maturityPercentage - a.maturityPercentage;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  });

  const tagTypeOptions = $derived.by(() => {
    const types = new Set<string>();
    for (const feature of features) {
      for (const tag of feature.tags ?? []) types.add(humanizeTagText(tag.type));
    }
    return [...types].sort((a, b) => a.localeCompare(b));
  });

  // Lookup queued state per feature directly from the live project snapshot
  // so the chip flips immediately after enqueue/dequeue without an extra
  // round-trip. Keyed on the same `queueItemKey` the domain uses.
  function isFeatureQueued(featureId: FeatureId): boolean {
    const queue = projectStore.project?.implementationQueue ?? [];
    const key = `feature:${String(featureId)}`;
    return queue.some((q) => queueItemKey(q) === key);
  }

  async function enqueueFeature(featureId: FeatureId) {
    if (!projectStore.project) return;
    const container = await getBrowserContainer();
    const result = await container.useCases.enqueueQueueItem(projectStore.project.id, {
      kind: 'feature',
      featureId
    });
    // Mutating the project locally keeps the chip reactive without waiting
    // on the Yjs round-trip; the round-trip still publishes to other tabs.
    if (projectStore.project) projectStore.project = result.project;
  }

  async function removeFeatureFromQueue(featureId: FeatureId) {
    if (!projectStore.project) return;
    const queue = projectStore.project.implementationQueue ?? [];
    const key = `feature:${String(featureId)}`;
    const match = queue.find((q) => queueItemKey(q) === key);
    if (!match) return;
    const container = await getBrowserContainer();
    const next = await container.useCases.dequeueQueueItem(projectStore.project.id, match.id);
    if (projectStore.project) projectStore.project = next;
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="space-y-4">
  <div
    class="rounded-xl border border-slate-200 bg-white p-3 shadow-sm shadow-slate-950/5"
  >
    <div
      class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"
    >
      <div
        class="flex min-w-0 items-center rounded-lg border border-hairline bg-white p-1 lg:flex-1"
      >
        <label for="project-feature-search" class="sr-only"
          >Search project features</label
        >
        <input
          id="project-feature-search"
          type="search"
          placeholder="Search features..."
          value={search}
          oninput={(e) => onSearch((e.target as HTMLInputElement).value)}
          class="h-9 w-full min-w-0 rounded-md border-0 bg-transparent px-3 text-sm outline-none placeholder:text-slate-400"
        />
        {#if search.trim().length > 0}
          <button
            type="button"
            class="h-8 rounded-md px-2 text-xs font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-900"
            onclick={() => onSearch("")}
          >
            Clear
          </button>
        {/if}
      </div>
      <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
        <TagFilterSelect
          tags={allTagsFlat}
          value={tagFilter}
          onChange={(next) => (tagFilter = next)}
          countLabel={tagFilterCount}
        />
        <label
          class="flex h-10 items-center gap-2 rounded-lg border border-hairline bg-white px-3 text-sm text-slate-600"
        >
          <span class="text-xs font-medium">Sort</span>
          <select
            bind:value={sortBy}
            class="bg-transparent text-sm font-medium text-slate-800 outline-none"
          >
            <option value="updated">Updated</option>
            <option value="name">Name</option>
            <option value="maturity">Maturity</option>
          </select>
        </label>
        <button
          type="button"
          data-tour="new-feature-button"
          class="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-medium text-white"
          onclick={() => openAdd()}
          title="Create a new feature inside this project"
        >
          <span aria-hidden="true">+</span>
          New feature
        </button>
      </div>
    </div>
  </div>

  {#if filteredCards.length === 0}
    <div
      class="rounded-lg border border-dashed border-hairline bg-white p-6 text-center text-sm text-slate-500"
    >
      {#if features.length === 0}
        <div class="space-y-3">
          <p>No features in this project yet.</p>
          <div class="flex flex-wrap justify-center gap-2">
            <button
              type="button"
              class="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
              onclick={() => openAdd()}
            >
              Create first feature
            </button>
          </div>
        </div>
      {:else}
        No features match your search.
      {/if}
    </div>
  {:else}
    <ul class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {#each filteredCards as summary (summary.id)}
        <li>
          <FeatureCard
            {summary}
            {tagTypeOptions}
            deleteLabel="Remove"
            onAddTag={(type, value) => onAddTag(summary.id, { type, value })}
            onRemoveTag={onRemoveTag ? (type, value) => onRemoveTag(summary.id, { type, value }) : undefined}
            onDelete={() => onRemove(summary.id)}
            queued={isFeatureQueued(summary.id)}
            onAddToQueue={() => enqueueFeature(summary.id)}
            onRemoveFromQueue={() => removeFeatureFromQueue(summary.id)}
          />
        </li>
      {/each}
    </ul>
  {/if}
</div>

{#if addOpen}
  <div
    class="fixed inset-0 z-40 flex items-start justify-center bg-slate-950/30 px-4 py-24 backdrop-blur-sm"
    role="presentation"
    onclick={(event) => {
      if (event.currentTarget === event.target) closeAdd();
    }}
  >
    <div
      class="w-full max-w-2xl rounded-xl border border-hairline bg-white shadow-xl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-feature-dialog-title"
    >
      <header
        class="flex items-start justify-between gap-4 border-b border-hairline px-5 py-4"
      >
        <div>
          <h2
            id="add-feature-dialog-title"
            class="text-base font-semibold text-slate-950"
          >
            Add an feature
          </h2>
          <p class="mt-1 text-sm text-slate-500">
            Create a new behavior model. It will be tied to this project automatically.
          </p>
        </div>
        <button
          type="button"
          class="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          onclick={closeAdd}
          aria-label="Close"
        >
          x
        </button>
      </header>

      <form
        class="space-y-3 p-5"
        data-tour="new-feature-form"
        onsubmit={(event) => {
          event.preventDefault();
          void handleCreate();
        }}
      >
          <label class="block text-xs font-medium text-slate-700">
            Feature name
            <input
              bind:this={newNameInput}
              type="text"
              bind:value={newName}
              placeholder="e.g. Restaurant booking"
              class="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-slate-900"
              required
            />
          </label>
          <label class="block text-xs font-medium text-slate-700">
            Description
            <input
              type="text"
              data-tour="new-feature-description"
              bind:value={newDescription}
              placeholder="What is this feature about?"
              class="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-slate-900"
              required
            />
          </label>
          <div class="flex justify-end gap-2 pt-2">
            <button
              type="button"
              class="h-10 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
              onclick={closeAdd}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating || newName.trim().length === 0 || newDescription.trim().length === 0 || tourGuard.blocked}
              title={tourGuard.blocked
                ? `Tutorial: name must be exactly "${tourGuard.requiredValue}"`
                : undefined}
              class="h-10 rounded-md bg-slate-900 px-4 text-sm font-medium text-white disabled:opacity-50"
            >
              {creating ? 'Creating...' : 'Create feature'}
            </button>
          </div>
      </form>
    </div>
  </div>
{/if}
