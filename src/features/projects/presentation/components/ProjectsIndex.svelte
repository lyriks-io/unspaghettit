<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { withBase } from '$shared/routing/appBase';
  import { projectsStore } from '$features/projects/presentation/stores/projectsStore.svelte';
  import { featuresStore } from '$features/behavior-model/presentation/stores/featuresStore.svelte';
  import ProjectCard from '$features/projects/presentation/components/ProjectCard.svelte';
  import NewProjectForm from '$features/projects/presentation/components/NewProjectForm.svelte';
  import type { ProjectId } from '$features/projects/domain/value-objects/ids';
  import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';
  import { subscribeSyncEvents } from '$lib/client/sync/syncEvents';
  import {
    alertDialog,
    checklistDialog,
    confirmDialog,
    promptDialog
  } from '$shared/presentation/dialogs/dialogStore.svelte';
  import { getBrowserContainer } from '$shared/infrastructure/browserContainer';
  import {
    downloadEnvelopeAs,
    exportProjectBundle,
    importEnvelope,
    readEnvelopeFromFile,
    MalformedEnvelopeError,
    WeakPassphraseError,
    WrongPassphraseError
  } from '$features/projects/presentation/services/projectBundleClient';
  import KebabMenu from '$shared/presentation/components/KebabMenu.svelte';
  import MenuItem from '$shared/presentation/components/MenuItem.svelte';
  import { addTag, humanizeTagText, removeTag, tagKey, type Tag } from '$shared/domain/Tags';
  import { tagPaletteStore } from '$features/tag-palette/presentation/stores/tagPaletteStore.svelte';
  import TagFilterSelect, {
    type TagFilterValue
  } from '$features/tag-palette/presentation/components/TagFilterSelect.svelte';
  import ManageTagsDialog from '$features/tag-palette/presentation/components/ManageTagsDialog.svelte';
  import { tourStore } from '$features/tutorial/presentation/stores/tourStore.svelte';
  import { firstFeatureTour } from '$features/tutorial/infrastructure/tours/firstFeatureTour';
  import { runLoadSamplesFlow } from '$features/behavior-model/presentation/loadSamplesFlow';
  import AppVersion from '$features/app-shell/presentation/components/AppVersion.svelte';

  type TaggedProject = {
    readonly tags?: readonly Tag[];
    readonly customTag?: string;
    readonly customTagType?: string;
  };

  let unsubscribeSync: (() => void) | null = null;
  let tagFilter = $state<TagFilterValue>('all');
  let createOpen = $state(false);
  let manageTagsOpen = $state(false);
  let sortBy = $state<'updated' | 'name' | 'count'>('updated');
  let loadingSamples = $state(false);

  async function loadSamplesFromEmptyState() {
    if (loadingSamples) return;
    loadingSamples = true;
    try {
      await runLoadSamplesFlow();
    } finally {
      loadingSamples = false;
    }
  }

  onMount(() => {
    projectsStore.refresh();
    tagPaletteStore.refresh();
    // Re-fetch the project list whenever a project is created/updated/deleted
    // out-of-band (notably by the MCP server writing to disk). Feature events
    // also touch the summary's featureCount, so listen for those too.
    unsubscribeSync = subscribeSyncEvents((evt) => {
      if (evt.kind === 'project' || evt.kind === 'feature') {
        projectsStore.refreshSilent();
      }
    });
  });

  onDestroy(() => {
    unsubscribeSync?.();
    unsubscribeSync = null;
  });

  // Merge the `tags` array with the legacy `customTagType`/`customTag` pair so
  // older snapshots still surface their single tag through the same UI.
  function readTags(project: TaggedProject): readonly Tag[] {
    const tags = [...(project.tags ?? [])];
    if (project.customTag?.trim()) {
      tags.push({ type: project.customTagType?.trim() || 'Tag', value: project.customTag.trim() });
    }
    return tags;
  }

  async function handleCreate(name: string, description: string) {
    const id = await projectsStore.create(name, description);
    await goto(withBase(`/projects/${id}`));
  }

  let importing = $state(false);
  let importFileInput = $state<HTMLInputElement | null>(null);

  // Import flow: hidden <input type="file"> kicks the picker, then we
  // parse the envelope, prompt for the passphrase, and POST the
  // decrypted bundle to /api/projects/import. The passphrase is
  // verified by the AES-GCM auth tag - a wrong one surfaces as
  // WrongPassphraseError and we re-prompt.
  function openImportPicker() {
    if (importing) return;
    importFileInput?.click();
  }

  async function handleImportFileChosen(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Clear so picking the same file twice in a row still fires `change`.
    input.value = '';
    if (!file) return;
    importing = true;
    try {
      const envelope = await readEnvelopeFromFile(file);
      // The envelope carries NO identifier of the contents (so an
      // attacker holding the file learns nothing without the
      // passphrase). The dialog stays generic; the project's real name
      // is revealed only after a successful decrypt, in the success
      // toast below.
      const passphrase = await promptDialog({
        title: `Import .unspa file`,
        message:
          `Enter the passphrase used when "${file.name}" was exported. ` +
          `A wrong passphrase will not corrupt anything - the file just stays encrypted.`,
        inputLabel: 'Passphrase',
        password: true,
        confirmLabel: 'Import',
        tone: 'info'
      });
      if (passphrase === null) return;
      const result = await importEnvelope(envelope, passphrase);
      await projectsStore.refreshSilent();
      await alertDialog({
        title: 'Import complete',
        message: `Restored project with ${result.featuresImported} feature(s) and ${result.statusesImported} implementation-status sidecar(s).`,
        tone: 'success'
      });
      await goto(withBase(`/projects/${result.projectId}`));
    } catch (e) {
      const message =
        e instanceof MalformedEnvelopeError
          ? `That file is not a valid .unspa bundle: ${e.message}`
          : e instanceof WrongPassphraseError
            ? e.message
            : `Import failed: ${(e as Error).message}`;
      await alertDialog({ title: 'Import failed', message, tone: 'danger' });
    } finally {
      importing = false;
    }
  }

  let exporting = $state(false);

  // Export from the card's ⋮ menu - no need to open the project first. Same
  // flow as the detail page: prompt for a passphrase, fetch the bundle,
  // encrypt client-side, download the `.unspa`. The passphrase never reaches
  // the server. Only the project id + name are needed, both on the summary.
  async function handleExport(id: ProjectId, name: string) {
    if (exporting) return;
    const passphrase = await promptDialog({
      title: 'Export project',
      message:
        `Encrypt "${name}" with a passphrase and download as a .unspa file. ` +
        `You'll need the same passphrase to import it back. Minimum 8 characters.`,
      inputLabel: 'Passphrase',
      placeholder: 'At least 8 characters',
      password: true,
      confirmLabel: 'Export',
      tone: 'info',
      validate: (v) => (v.length < 8 ? 'Passphrase must be at least 8 characters.' : null)
    });
    if (passphrase === null) return;
    exporting = true;
    try {
      const { envelope, projectName } = await exportProjectBundle(id, passphrase);
      downloadEnvelopeAs(envelope, projectName);
    } catch (e) {
      const message =
        e instanceof WeakPassphraseError ? e.message : `Export failed: ${(e as Error).message}`;
      await alertDialog({ title: 'Export failed', message, tone: 'danger' });
    } finally {
      exporting = false;
    }
  }

  async function handleDelete(id: ProjectId) {
    projectsStore.stagePendingDelete(id);
    const summary = projectsStore.summaries.find((s) => String(s.id) === String(id));
    const name = summary?.name ?? 'this project';

    const container = await getBrowserContainer();
    const project = await container.useCases.getProject(id);
    const featureIds = (project?.featureIds ?? []).map(String);

    let selectedFeatureIds: readonly string[] = [];

    if (featureIds.length === 0) {
      const ok = await confirmDialog({
        title: `Delete "${name}"?`,
        message: 'This project has no linked features. Removing it cannot be undone.',
        confirmLabel: 'Delete project',
        tone: 'danger'
      });
      if (!ok) {
        projectsStore.clearPendingDelete();
        return;
      }
    } else {
      // Resolve display names from the repo so the checklist reads by name,
      // not id, regardless of whether featuresStore has been populated.
      const items = await Promise.all(
        featureIds.map(async (fid) => {
          const card = await container.useCases.getFeatureCard(fid as FeatureId);
          return {
            id: fid,
            label: card?.name ?? fid,
            defaultChecked: true
          };
        })
      );

      const result = await checklistDialog({
        title: `Delete "${name}"?`,
        message:
          `This project links to ${featureIds.length} feature${featureIds.length === 1 ? '' : 's'}. ` +
          'Tick the ones you want to delete in the same batch. Anything left unchecked stays available as an unassigned feature.',
        items,
        confirmLabel: 'Delete project + selected',
        cancelLabel: 'Cancel',
        tone: 'danger'
      });
      if (!result.confirmed) {
        projectsStore.clearPendingDelete();
        return;
      }
      selectedFeatureIds = result.selectedIds;
    }

    for (const fid of selectedFeatureIds) {
      await container.useCases.deleteFeature(fid as FeatureId);
    }
    await projectsStore.remove(id);
    if (selectedFeatureIds.length > 0) {
      await featuresStore.refreshSilent();
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') createOpen = false;
  }

  const filtered = $derived.by(() => {
    const matches =
      projectsStore.search.trim().length === 0
        ? [...projectsStore.summaries]
        : projectsStore.summaries.filter((summary) => {
          const q = projectsStore.search.toLowerCase();
          return (
            summary.name.toLowerCase().includes(q) ||
            (summary.description ?? '').toLowerCase().includes(q)
          );
        });
    const tagged = matches.filter((summary) => matchesTagFilter(summary, tagFilter));
    return tagged.sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'count') return b.featureCount - a.featureCount;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  });

  function matchesTagFilter(project: TaggedProject, filter: TagFilterValue): boolean {
    const projectTags = readTags(project);
    if (filter === 'all') return true;
    if (filter === 'untagged') return projectTags.length === 0;
    const key = tagKey(filter);
    return projectTags.some((tag) => tagKey(tag) === key);
  }

  const allTagsFlat = $derived.by<readonly Tag[]>(() => {
    const out: Tag[] = [];
    for (const summary of projectsStore.summaries) {
      for (const tag of readTags(summary)) out.push(tag);
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

  function tagFilterCount(filter: TagFilterValue): number {
    return projectsStore.summaries.filter((s) => matchesTagFilter(s, filter)).length;
  }

  async function appendTag(id: ProjectId, type: string, value: string) {
    const container = await getBrowserContainer();
    const project = await container.useCases.getProject(id);
    if (!project) return;
    await container.useCases.saveProject({
      ...project,
      tags: addTag(readTags(project), { type, value })
    });
    await projectsStore.refreshSilent();
  }

  async function dropTag(id: ProjectId, type: string, value: string) {
    const container = await getBrowserContainer();
    const project = await container.useCases.getProject(id);
    if (!project) return;
    const nextTags = removeTag(readTags(project), { type, value });
    await container.useCases.saveProject({
      ...project,
      tags: nextTags,
      customTagType: undefined,
      customTag: undefined
    });
    // If the just-removed tag was the active filter, fall back to 'all'
    // so the user doesn't end up staring at an empty grid.
    if (
      tagFilter !== 'all' &&
      tagFilter !== 'untagged' &&
      tagKey(tagFilter) === tagKey({ type, value })
    ) {
      tagFilter = 'all';
    }
    await projectsStore.refreshSilent();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="mx-auto max-w-7xl px-4 py-8 sm:px-6">
  <header class="mb-6 border-b border-slate-200 pb-6">
    <div class="flex items-center justify-between gap-3">
      <p class="text-xs font-semibold uppercase tracking-wide text-brand-700">Home</p>
      <KebabMenu align="right" placement="down" label="Page actions">
        {#snippet children(close)}
          <MenuItem
            disabled={importing}
            onclick={() => {
              close();
              openImportPicker();
            }}
          >
            <span aria-hidden="true">&#x2B06;</span>
            {importing ? 'Importing...' : 'Import .unspa'}
          </MenuItem>
        {/snippet}
      </KebabMenu>
      <input
        bind:this={importFileInput}
        type="file"
        accept=".unspa,application/octet-stream,application/json"
        class="hidden"
        onchange={handleImportFileChosen}
      />
    </div>
    <div class="mt-2 max-w-3xl">
      <h1 class="text-4xl font-semibold tracking-tight text-slate-950">Projects</h1>
      <p class="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
        One project per product or codebase. Each groups the features that describe what
        that product does. Open one to model, simulate, and verify its behavior.
      </p>
    </div>
    <div class="mt-6 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm shadow-slate-950/5 lg:flex-row lg:items-center lg:justify-between">
      <div class="flex min-w-0 items-center rounded-lg border border-hairline bg-white p-1 lg:flex-1">
        <label for="project-search" class="sr-only">Search projects</label>
        <input
          id="project-search"
          type="search"
          placeholder="Search projects..."
          value={projectsStore.search}
          oninput={(e) => projectsStore.setSearch((e.target as HTMLInputElement).value)}
          class="h-9 w-full min-w-0 rounded-md border-0 bg-transparent px-3 text-sm outline-none placeholder:text-slate-400"
        />
        {#if projectsStore.search.trim().length > 0}
          <button
            type="button"
            class="h-8 rounded-md px-2 text-xs font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-900"
            onclick={() => projectsStore.setSearch('')}
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
          onManage={() => (manageTagsOpen = true)}
          countLabel={tagFilterCount}
        />
        <label class="flex h-10 items-center gap-2 rounded-lg border border-hairline bg-white px-3 text-sm text-slate-600">
          <span class="text-xs font-medium">Sort</span>
          <select bind:value={sortBy} class="bg-transparent text-sm font-medium text-slate-800 outline-none">
            <option value="updated">Updated</option>
            <option value="name">Name</option>
            <option value="count">Features</option>
          </select>
        </label>
        <button
          type="button"
          data-tour="new-project-button"
          class="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800"
          onclick={() => (createOpen = true)}
        >
          <span class="text-base leading-none" aria-hidden="true">+</span>
          New project
        </button>
      </div>
    </div>
  </header>

  <section aria-labelledby="projects-list-title">
    <div class="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 id="projects-list-title" class="text-base font-semibold text-slate-950">Your projects</h2>
        <p class="text-sm text-slate-500">Open a project to inspect the features it groups.</p>
      </div>
      <p class="text-xs text-slate-500">{filtered.length} shown</p>
    </div>

    {#if projectsStore.loading}
      <div class="rounded-lg border border-dashed border-hairline bg-white p-8 text-center text-sm text-slate-500">
        Loading projects...
      </div>
    {:else if projectsStore.error}
      <div class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {projectsStore.error}
      </div>
    {:else if filtered.length === 0}
      <div class="rounded-lg border border-dashed border-hairline bg-white p-8 text-center text-sm text-slate-500">
        {#if projectsStore.summaries.length === 0}
          <div class="mx-auto max-w-md space-y-4 py-4">
            <div class="space-y-1.5">
              <p class="text-base font-semibold text-slate-900">Nothing modeled yet</p>
              <p class="text-sm leading-6 text-slate-600">
                A <strong>project</strong> holds the features of one product. A
                <strong>feature</strong> describes one slice of what that product does
                (its screens, actions, state, and rules) precisely enough to simulate.
              </p>
            </div>
            <div class="flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                class="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
                onclick={() => (createOpen = true)}
              >
                Create first project
              </button>
              <button
                type="button"
                class="rounded-md border border-brand-300 bg-brand-50 px-4 py-2 text-sm font-medium text-brand-800 hover:bg-brand-100"
                onclick={() => tourStore.start(firstFeatureTour)}
              >
                Take the 3-minute tour
              </button>
              <button
                type="button"
                class="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-70"
                onclick={loadSamplesFromEmptyState}
                disabled={loadingSamples}
              >
                {loadingSamples ? 'Loading...' : 'Explore the sample project'}
              </button>
            </div>
          </div>
        {:else}
          No projects match your search.
        {/if}
      </div>
    {:else}
      <ul class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {#each filtered as summary (summary.id)}
          <li>
            <ProjectCard
              {summary}
              {tagTypeOptions}
              onAddTag={(type, value) => appendTag(summary.id, type, value)}
              onRemoveTag={(type, value) => dropTag(summary.id, type, value)}
              onExport={() => handleExport(summary.id, summary.name)}
              onDelete={() => handleDelete(summary.id)}
            />
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <!-- Build stamp, bottom-left of the projects container. Parked here for now
       until the shell grows a real footer. -->
  <AppVersion class="mt-8" />
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
      aria-labelledby="new-project-title"
    >
      <header class="flex items-start justify-between gap-4 border-b border-hairline px-5 py-4">
        <div>
          <h2 id="new-project-title" class="text-base font-semibold text-slate-950">New project</h2>
          <p class="mt-1 text-sm text-slate-500">Create a project for related behavior models.</p>
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
        <NewProjectForm onSubmit={handleCreate} />
      </div>
    </div>
  </div>
{/if}

<ManageTagsDialog
  open={manageTagsOpen}
  tags={allTagsFlat}
  onClose={() => (manageTagsOpen = false)}
  onRenamed={() => projectsStore.refreshSilent()}
/>
