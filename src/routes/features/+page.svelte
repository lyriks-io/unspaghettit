<script lang="ts">
  import { page } from '$app/state';
  import { pageTitle } from '$features/app-shell/presentation/pageTitle';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { withBase } from '$shared/routing/appBase';
  import { featuresStore } from '$features/behavior-model/presentation/stores/featuresStore.svelte';
  import { projectsStore } from '$features/projects/presentation/stores/projectsStore.svelte';
  import { alertDialog, chooseDialog, confirmDialog } from '$shared/presentation/dialogs/dialogStore.svelte';
  import { formatSampleSummary } from '$features/behavior-model/presentation/loadSamplesMessage';
  import FeatureCard from '$features/behavior-model/presentation/components/FeatureCard.svelte';
  import NewFeatureForm from '$features/behavior-model/presentation/components/NewFeatureForm.svelte';
  import { getBrowserContainer } from '$shared/infrastructure/browserContainer';
  import { asProjectId, type ProjectId } from '$features/projects/domain/value-objects/ids';
  import { humanizeTagText, tagKey, type Tag } from '$shared/domain/Tags';
  import { tagPaletteStore } from '$features/tag-palette/presentation/stores/tagPaletteStore.svelte';
  import TagFilterSelect, {
    type TagFilterValue
  } from '$features/tag-palette/presentation/components/TagFilterSelect.svelte';
  import ManageTagsDialog from '$features/tag-palette/presentation/components/ManageTagsDialog.svelte';

  onMount(() => {
    featuresStore.refresh();
    projectsStore.refresh();
    tagPaletteStore.refresh();
  });

  async function handleCreate(name: string, description: string) {
    const id = await featuresStore.create(name, description);
    await goto(withBase(`/features/${id}`));
  }

  async function handleDelete(id: string) {
    const summary = featuresStore.summaries.find((s) => String(s.id) === String(id));
    const name = summary?.name ?? 'this feature';
    const ok = await confirmDialog({
      title: `Delete "${name}"?`,
      message:
        'Its surfaces, actions, rules, and scenarios will be removed. Any project that references it keeps the link, but the feature itself is gone. This cannot be undone.',
      confirmLabel: 'Delete feature',
      tone: 'danger'
    });
    if (!ok) return;
    await featuresStore.remove(id);
  }

  let loadingSamples = $state(false);
  let search = $state('');
  let createOpen = $state(false);
  let moreOpen = $state(false);
  let sortBy = $state<'updated' | 'name' | 'maturity'>('updated');
  let moreMenu = $state<HTMLDivElement | null>(null);
  let projectFilter = $state<'all' | 'unassigned' | ProjectId>('all');
  let tagFilter = $state<TagFilterValue>('all');
  let manageTagsOpen = $state(false);
  let projectMembership = $state<Map<string, Set<string>>>(new Map());

  async function ensureProjectMembership(id: ProjectId): Promise<void> {
    if (projectMembership.has(id)) return;
    const container = await getBrowserContainer();
    const project = await container.useCases.getProject(id);
    const next = new Map(projectMembership);
    next.set(id, new Set(project?.featureIds.map(String) ?? []));
    projectMembership = next;
  }

  async function ensureAllMemberships(): Promise<void> {
    const container = await getBrowserContainer();
    const entries = await Promise.all(
      projectsStore.summaries.map(async (p) => {
        const project = await container.useCases.getProject(p.id);
        return [String(p.id), new Set(project?.featureIds.map(String) ?? [])] as const;
      })
    );
    projectMembership = new Map(entries);
  }

  $effect(() => {
    if (projectFilter === 'all') return;
    if (projectFilter === 'unassigned') {
      void ensureAllMemberships();
      return;
    }
    void ensureProjectMembership(projectFilter);
  });

  const totalSurfaces = $derived(
    featuresStore.summaries.reduce((total, summary) => total + summary.surfaceCount, 0)
  );
  const totalCapabilities = $derived(
    featuresStore.summaries.reduce((total, summary) => total + summary.actionCount, 0)
  );
  const averageMaturity = $derived(
    featuresStore.summaries.length === 0
      ? 0
      : Math.round(
          featuresStore.summaries.reduce((total, summary) => total + summary.maturityPercentage, 0) /
            featuresStore.summaries.length
        )
  );

  const allTagsFlat = $derived.by<readonly Tag[]>(() => {
    const out: Tag[] = [];
    for (const summary of featuresStore.summaries) {
      for (const tag of summary.tags ?? []) out.push(tag as Tag);
    }
    return out;
  });

  // Keep the auto-color allocator aware of every type currently rendered so
  // each type lands on a distinct preset.
  $effect(() => {
    tagPaletteStore.registerTypes(allTagsFlat.map((tag) => tag.type));
  });

  const tagTypeOptions = $derived(
    [...new Set(allTagsFlat.map((tag) => humanizeTagText(tag.type)))].sort((a, b) =>
      a.localeCompare(b)
    )
  );

  $effect(() => {
    if (!moreOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!moreMenu?.contains(event.target as Node)) moreOpen = false;
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  });

  function handleKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    moreOpen = false;
    createOpen = false;
  }

  const filtered = $derived.by(() => {
    const q = search.trim().toLowerCase();
    const bySearch = (summary: { name: string; description?: string }) =>
      q.length === 0 ||
      summary.name.toLowerCase().includes(q) ||
      (summary.description ?? '').toLowerCase().includes(q);

    const byProject = (id: string) => {
      if (projectFilter === 'all') return true;
      if (projectFilter === 'unassigned') {
        for (const members of projectMembership.values()) {
          if (members.has(id)) return false;
        }
        return true;
      }
      return projectMembership.get(projectFilter)?.has(id) ?? false;
    };

    const matches = featuresStore.summaries.filter(
      (summary) =>
        bySearch(summary) && byProject(String(summary.id)) && byTag(summary, tagFilter)
    );
    return matches.sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'maturity') return b.maturityPercentage - a.maturityPercentage;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  });

  function byTag(
    summary: { tags?: readonly Tag[] },
    filter: TagFilterValue
  ): boolean {
    const tags = summary.tags ?? [];
    if (filter === 'all') return true;
    if (filter === 'untagged') return tags.length === 0;
    const key = tagKey(filter);
    return tags.some((t) => tagKey(t) === key);
  }

  function tagFilterCount(filter: TagFilterValue): number {
    return featuresStore.summaries.filter((s) => byTag(s, filter)).length;
  }

  async function handleLoadSamples() {
    if (loadingSamples) return;
    loadingSamples = true;
    try {
      const result = await featuresStore.loadSamples();
      const addedAny = result.addedProjects.length + result.addedFeatures.length > 0;
      const skippedAny = result.skippedProjects.length + result.skippedFeatures.length > 0;
      if (!addedAny && !skippedAny) {
        await alertDialog({
          title: 'Nothing to load',
          message: 'No samples are bundled in this build.',
          tone: 'warning'
        });
      } else if (!addedAny) {
        await alertDialog({
          title: 'Already available',
          message: formatSampleSummary(result, 'skipped') +
            '\n\nDelete them and load again to restore from the sample.',
          tone: 'info'
        });
      } else {
        if (result.addedProjects.length > 0) {
          const projectCount = result.addedProjects.length;
          const featureCount = result.addedFeatures.length;
          const projectNoun = projectCount === 1 ? 'project' : 'projects';
          const featureNoun = featureCount === 1 ? 'feature' : 'features';
          const summary = featureCount > 0
            ? `Added ${projectCount} ${projectNoun} and ${featureCount} ${featureNoun}.`
            : `Added ${projectCount} ${projectNoun}.`;
          const featureLine = result.addedFeatures.map((f) => f.name).join(' · ');
          const chosenId = await chooseDialog({
            title: 'Samples loaded',
            message: summary,
            options: result.addedProjects.map((p) => ({
              id: p.id,
              label: `Open ${p.name}`,
              description: featureLine || undefined
            })),
            cancelLabel: 'Close',
            tone: 'success'
          });
          if (chosenId) {
            await goto(withBase(`/projects/${chosenId}`));
          }
        } else {
          await alertDialog({
            title: 'Samples loaded',
            message: formatSampleSummary(result, 'added') +
              (skippedAny ? `\n\nAlready present:\n${formatSampleSummary(result, 'skipped')}` : ''),
            tone: 'success'
          });
        }
      }
    } finally {
      loadingSamples = false;
    }
  }

</script>

<svelte:window onkeydown={handleKeydown} />

<svelte:head>
  <title>{pageTitle(page.url, 'Features')}</title>
</svelte:head>

<div class="mx-auto max-w-7xl px-4 py-8 sm:px-6">
  <header class="mb-6 border-b border-slate-200 pb-6">
    <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
    <div class="max-w-3xl">
      <div>
        <p class="text-xs font-semibold uppercase tracking-wide text-brand-700">Behavior models</p>
        <h1 class="mt-2 text-4xl font-semibold tracking-tight text-slate-950">Features</h1>
        <p class="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
          Every feature from every project, in one list. A feature is one slice of behavior,
          modeled as surfaces, actions, state, and rules you can simulate and verify.
        </p>
      </div>
    </div>
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:w-[42rem]">
      <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-950/5">
        <p class="text-xs font-medium uppercase tracking-wide text-brand-700">Models</p>
        <p class="mt-2 text-2xl font-semibold text-slate-950">{filtered.length}</p>
        <p class="mt-1 text-xs text-slate-500">{featuresStore.summaries.length} total</p>
      </div>
      <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-950/5">
        <p class="text-xs font-medium uppercase tracking-wide text-violet-700">Surfaces</p>
        <p class="mt-2 text-2xl font-semibold text-slate-950">{totalSurfaces}</p>
        <p class="mt-1 text-xs text-slate-500">Across models</p>
      </div>
      <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-950/5">
        <p class="text-xs font-medium uppercase tracking-wide text-amber-700">Actions</p>
        <p class="mt-2 text-2xl font-semibold text-slate-950">{totalCapabilities}</p>
        <p class="mt-1 text-xs text-slate-500">Actions</p>
      </div>
      <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-950/5">
        <p class="text-xs font-medium uppercase tracking-wide text-emerald-700">Maturity</p>
        <p class="mt-2 text-2xl font-semibold text-slate-950">{averageMaturity}%</p>
        <p class="mt-1 text-xs text-slate-500">Average</p>
      </div>
    </div>
    </div>
    <div class="mt-6 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm shadow-slate-950/5 lg:flex-row lg:items-center lg:justify-between">
      <div class="flex min-w-0 items-center rounded-lg border border-hairline bg-white p-1 lg:flex-1">
        <label for="feature-search" class="sr-only">Search features</label>
        <input
          id="feature-search"
          type="search"
          placeholder="Search features..."
          bind:value={search}
          class="h-9 w-full min-w-0 rounded-md border-0 bg-transparent px-3 text-sm outline-none placeholder:text-slate-400"
        />
        {#if search.trim().length > 0}
          <button
            type="button"
            class="h-8 rounded-md px-2 text-xs font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-900"
            onclick={() => (search = '')}
          >
            Clear
          </button>
        {/if}
      </div>
      <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
      <label class="flex h-10 items-center gap-2 rounded-lg border border-hairline bg-white px-3 text-sm text-slate-600">
        <span class="text-xs font-medium">Project</span>
        <select
          value={projectFilter}
          onchange={(event) => {
            const v = (event.currentTarget as HTMLSelectElement).value;
            projectFilter = v === 'all' || v === 'unassigned' ? v : asProjectId(v);
          }}
          class="bg-transparent text-sm font-medium text-slate-800 outline-none"
        >
          <option value="all">All</option>
          <option value="unassigned">Unassigned</option>
          {#each projectsStore.summaries as project (project.id)}
            <option value={project.id}>{project.name}</option>
          {/each}
        </select>
      </label>
      <TagFilterSelect
        tags={allTagsFlat}
        value={tagFilter}
        onChange={(next) => (tagFilter = next)}
        onManage={() => (manageTagsOpen = true)}
        countLabel={tagFilterCount}
      />
      <label class="flex h-10 items-center gap-2 rounded-lg border border-hairline bg-white px-3 text-sm text-slate-600">
        <span class="text-xs font-medium">Sort</span>
        <select bind:value={sortBy} class="bg-transparent text-sm font-medium text-slate-800 outline-none">
          <option value="updated">Updated</option>
          <option value="name">Name</option>
          <option value="maturity">Maturity</option>
        </select>
      </label>
      <div class="relative" bind:this={moreMenu}>
        <button
          type="button"
          class="inline-flex h-10 items-center gap-2 rounded-lg border border-hairline bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          onclick={() => (moreOpen = !moreOpen)}
          aria-expanded={moreOpen}
        >
          More
          <span class="text-xs text-slate-400" aria-hidden="true">v</span>
        </button>
        {#if moreOpen}
          <div class="absolute right-0 z-20 mt-2 w-56 rounded-lg border border-hairline bg-white p-1 shadow-lg">
            <button
              type="button"
              class="flex w-full items-start rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              onclick={() => {
                moreOpen = false;
                handleLoadSamples();
              }}
              disabled={loadingSamples}
            >
              <span>
                <span class="block font-medium">{loadingSamples ? 'Loading samples...' : 'Load sample project'}</span>
                <span class="block text-xs text-slate-500">Add bundled example specs.</span>
              </span>
            </button>
          </div>
        {/if}
      </div>
      <a
        href={withBase('/projects')}
        class="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800"
        title="New features are created from a project"
      >
        <span class="text-base leading-none" aria-hidden="true">+</span>
        New feature
      </a>
      </div>
    </div>
  </header>

  <section aria-labelledby="features-list-title">
    <div class="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 id="features-list-title" class="text-base font-semibold text-slate-950">Behavior models</h2>
        <p class="text-sm text-slate-500">Open an feature to edit surfaces, rules, effects, and scenarios.</p>
      </div>
      <p class="text-xs text-slate-500">{filtered.length} shown</p>
    </div>

  {#if featuresStore.loading}
    <div class="rounded-lg border border-dashed border-hairline bg-white p-8 text-center text-sm text-slate-500">
      Loading features...
    </div>
  {:else if featuresStore.error}
    <div class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
      {featuresStore.error}
    </div>
  {:else if filtered.length === 0}
    <div class="rounded-lg border border-dashed border-hairline bg-white p-8 text-center text-sm text-slate-500">
      {#if featuresStore.summaries.length === 0}
        <div class="space-y-3">
          <p>No features yet.</p>
          <p class="text-xs">Features live inside projects. Start by opening or creating a project.</p>
          <div class="flex flex-wrap justify-center gap-2">
            <a
              href={withBase('/projects')}
              class="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
            >
              Go to projects
            </a>
            <button
              type="button"
              class="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700"
              onclick={handleLoadSamples}
              disabled={loadingSamples}
            >
              {loadingSamples ? 'Loading...' : 'Load sample project'}
            </button>
          </div>
        </div>
      {:else}
        No features match your search.
      {/if}
    </div>
  {:else}
    <ul class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {#each filtered as summary (summary.id)}
        <li>
          <FeatureCard
            {summary}
            {tagTypeOptions}
            onAddTag={(type, value) => featuresStore.addTag(String(summary.id), { type, value })}
            onRemoveTag={async (type, value) => {
              await featuresStore.removeTag(String(summary.id), { type, value });
              if (
                tagFilter !== 'all' &&
                tagFilter !== 'untagged' &&
                tagKey(tagFilter) === tagKey({ type, value })
              ) {
                tagFilter = 'all';
              }
            }}
            onDelete={() => handleDelete(summary.id)}
          />
        </li>
      {/each}
    </ul>
  {/if}
  </section>
</div>

{#if createOpen}
  <div
    class="fixed inset-0 z-40 flex items-start justify-center bg-slate-950/30 px-4 py-24 backdrop-blur-sm"
    role="presentation"
    onclick={(event) => {
      if (event.currentTarget === event.target) createOpen = false;
    }}
  >
    <div
      class="w-full max-w-3xl rounded-xl border border-hairline bg-white shadow-xl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-feature-title"
    >
      <header class="flex items-start justify-between gap-4 border-b border-hairline px-5 py-4">
        <div>
          <h2 id="new-feature-title" class="text-base font-semibold text-slate-950">New feature</h2>
          <p class="mt-1 text-sm text-slate-500">Start a behavior model from a blank specification.</p>
        </div>
        <button
          type="button"
          class="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          onclick={() => (createOpen = false)}
          aria-label="Close"
        >
          x
        </button>
      </header>
      <div class="p-5">
        <NewFeatureForm onSubmit={handleCreate} />
      </div>
    </div>
  </div>
{/if}

<ManageTagsDialog
  open={manageTagsOpen}
  tags={allTagsFlat}
  onClose={() => (manageTagsOpen = false)}
  onRenamed={() => featuresStore.refreshSilent()}
/>
