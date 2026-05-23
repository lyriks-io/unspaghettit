<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { goto } from '$app/navigation';
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
    importEnvelope,
    readEnvelopeFromFile,
    MalformedEnvelopeError,
    WrongPassphraseError
  } from '$features/projects/presentation/services/projectBundleClient';
  import { addTag, removeTag, tagKey, tagLabel, type Tag } from '$shared/domain/Tags';

  type TagOption = {
    readonly type: string;
    readonly value: string;
    readonly key: string;
    readonly label: string;
  };

  type TaggedProject = {
    readonly tags?: readonly Tag[];
    readonly customTag?: string;
    readonly customTagType?: string;
  };

  let unsubscribeSync: (() => void) | null = null;
  let tagFilter = $state<string>('all');
  let createOpen = $state(false);
  let sortBy = $state<'updated' | 'name' | 'count'>('updated');

  onMount(() => {
    projectsStore.refresh();
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
    await goto(`/projects/${id}`);
  }

  let importing = $state(false);
  let importFileInput = $state<HTMLInputElement | null>(null);

  // Import flow: hidden <input type="file"> kicks the picker, then we
  // parse the envelope, prompt for the passphrase, and POST the
  // decrypted bundle to /api/projects/import. The passphrase is
  // verified by the AES-GCM auth tag — a wrong one surfaces as
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
          `A wrong passphrase will not corrupt anything — the file just stays encrypted.`,
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
      await goto(`/projects/${result.projectId}`);
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
    const tagged = matches.filter((summary) => {
      if (tagFilter === 'all') return true;
      if (tagFilter === 'untagged') return readTags(summary).length === 0;
      return readTags(summary).some((tag) => tagKey(tag) === tagFilter);
    });
    return tagged.sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'count') return b.featureCount - a.featureCount;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  });

  const tagOptions = $derived.by<readonly TagOption[]>(() => {
    const byKey = new Map<string, TagOption>();
    for (const summary of projectsStore.summaries) {
      for (const tag of readTags(summary)) {
        const key = tagKey(tag);
        byKey.set(key, { ...tag, key, label: tagLabel(tag) });
      }
    }
    return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label));
  });

  const tagTypeOptions = $derived(
    [...new Set(tagOptions.map((option) => option.type))].sort((a, b) => a.localeCompare(b))
  );

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
    if (tagFilter === tagKey({ type, value })) tagFilter = 'all';
    await projectsStore.refreshSilent();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="mx-auto max-w-7xl px-4 py-8 sm:px-6">
  <header class="mb-6 border-b border-slate-200 pb-6">
    <div class="max-w-3xl">
      <p class="text-xs font-semibold uppercase tracking-wide text-brand-700">Home</p>
      <h1 class="mt-2 text-4xl font-semibold tracking-tight text-slate-950">Projects</h1>
      <p class="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
        Group related behavior models and inspect their resources, data, events, and transitions together.
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
          class="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:border-brand-300 hover:bg-cyan-50 hover:text-brand-800 disabled:opacity-50"
          onclick={openImportPicker}
          disabled={importing}
          title="Restore a project from a .unspa file"
        >
          <span aria-hidden="true">⬆</span>
          {importing ? 'Importing...' : 'Import .unspa'}
        </button>
        <input
          bind:this={importFileInput}
          type="file"
          accept=".unspa,application/octet-stream,application/json"
          class="hidden"
          onchange={handleImportFileChosen}
        />
        <button
          type="button"
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

    {#if tagOptions.length > 0}
      <div class="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          class="rounded-full border px-3 py-1 text-xs font-medium {tagFilter === 'all' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}"
          onclick={() => (tagFilter = 'all')}
        >
          All
        </button>
        <button
          type="button"
          class="rounded-full border px-3 py-1 text-xs font-medium {tagFilter === 'untagged' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'}"
          onclick={() => (tagFilter = 'untagged')}
        >
          Untagged
        </button>
        {#each tagOptions as tag (tag.key)}
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium {tagFilter === tag.key ? 'border-slate-900 bg-slate-900 text-white' : 'border-emerald-100 bg-emerald-50 text-emerald-700 hover:border-emerald-200'}"
            onclick={() => (tagFilter = tag.key)}
          >
            <span class="text-[10px] uppercase tracking-wider opacity-70">{tag.type}</span>
            <span>{tag.value}</span>
          </button>
        {/each}
      </div>
    {/if}

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
          <div class="space-y-3">
            <p>No projects yet.</p>
            <button
              type="button"
              class="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
              onclick={() => (createOpen = true)}
            >
              Create first project
            </button>
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
