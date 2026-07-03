<script lang="ts">
  import { goto } from '$app/navigation';
  import { projectStore, type ProjectPanel } from '$features/projects/presentation/stores/projectStore.svelte';
  import { projectFeaturesStore } from '$features/projects/presentation/stores/projectFeaturesStore.svelte';
  import { featuresStore } from '$features/behavior-model/presentation/stores/featuresStore.svelte';
  import ProjectFeaturesPanel from './ProjectFeaturesPanel.svelte';
  import ProjectResourcesPanel from './ProjectResourcesPanel.svelte';
  import ProjectEntitiesPanel from './ProjectEntitiesPanel.svelte';
  import ProjectEventsPanel from './ProjectEventsPanel.svelte';
  import ProjectTransitionsPanel from './ProjectTransitionsPanel.svelte';
  import ProjectHistoryPanel from './ProjectHistoryPanel.svelte';
  import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';
  import {
    alertDialog,
    promptDialog
  } from '$shared/presentation/dialogs/dialogStore.svelte';
  import {
    downloadEnvelopeAs,
    exportProjectBundle,
    WeakPassphraseError
  } from '$features/projects/presentation/services/projectBundleClient';
  import { fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import {
    groupResources,
    groupEntities,
    groupEvents,
    groupTransitions
  } from '$features/projects/presentation/services/crossFeatureGroups';
  import type { Tag } from '$shared/domain/Tags';
  import TagDotStrip from '$features/tag-palette/presentation/components/TagDotStrip.svelte';
  import { tagPaletteStore } from '$features/tag-palette/presentation/stores/tagPaletteStore.svelte';
  import KebabMenu from '$shared/presentation/components/KebabMenu.svelte';
  import MenuItem from '$shared/presentation/components/MenuItem.svelte';

  const PANELS: { id: ProjectPanel; label: string }[] = [
    { id: 'features', label: 'Features' },
    { id: 'resources', label: 'Resources' },
    { id: 'data', label: 'Entity' },
    { id: 'events', label: 'Events' },
    { id: 'transitions', label: 'Transitions' },
    { id: 'history', label: 'History' }
  ];

  let editingProject = $state(false);
  let nameDraft = $state('');
  let descriptionDraft = $state('');

  $effect(() => {
    const project = projectStore.project;
    if (!project || editingProject) return;
    nameDraft = project.name;
    descriptionDraft = project.description ?? '';
  });

  // Register this project's tag types with the palette store so auto-color
  // assignment lands on the same presets you'd see on the projects index.
  $effect(() => {
    const tags = projectStore.project?.tags ?? [];
    if (tags.length > 0) tagPaletteStore.registerTypes(tags.map((t) => t.type));
  });

  // Tab counters mirror what each panel actually renders. Resources / Entity /
  // Events / Transitions panels collapse duplicates that appear in multiple
  // features (same `users` table referenced from two flows shows once, not
  // twice), so the counters share that grouping logic instead of summing
  // per-feature lengths.
  function panelCount(panel: ProjectPanel): number {
    const exps = projectFeaturesStore.features;
    switch (panel) {
      case 'features':
        return exps.length;
      case 'resources':
        return groupResources(exps).length;
      case 'data':
        return groupEntities(exps).length;
      case 'events':
        return groupEvents(exps).length;
      case 'transitions':
        return groupTransitions(exps).length;
      case 'history':
        return projectStore.historyEntries.length;
    }
  }

  async function saveProjectMetadata() {
    if (!projectStore.project) return;
    await projectStore.updateMetadata(nameDraft, descriptionDraft);
    if (!projectStore.saveError) editingProject = false;
  }

  async function handleAddFeatureTag(id: FeatureId, tag: Tag) {
    const feature = projectFeaturesStore.features.find((item) => item.id === id);
    if (!feature) return;
    await featuresStore.addTag(String(id), tag);
    if (projectStore.project) {
      await projectFeaturesStore.load(projectStore.project.featureIds);
    }
  }

  async function handleRemoveFeatureTag(id: FeatureId, tag: Tag) {
    const feature = projectFeaturesStore.features.find((item) => item.id === id);
    if (!feature) return;
    await featuresStore.removeTag(String(id), tag);
    if (projectStore.project) {
      await projectFeaturesStore.load(projectStore.project.featureIds);
    }
  }

  // Project-scoped create. The standalone create flow on /features is gone:
  // every Feature must belong to a Project, just as every Project belongs
  // to a Domain. The new id is auto-attached before navigating.
  async function handleCreateFeature(name: string, description: string) {
    const newId = await featuresStore.create(name, description);
    await projectStore.addFeature(newId as FeatureId);
    await goto(`/features/${newId}`);
  }

  async function handleRemoveFeature(id: FeatureId) {
    await projectStore.removeFeature(id);
    if (projectStore.project) {
      await projectFeaturesStore.load(projectStore.project.featureIds);
    }
  }

  let exporting = $state(false);

  // Export = prompt for a passphrase, fetch bundle, encrypt client-side,
  // trigger a `.unspa` download. The passphrase never touches the
  // server. Min length is checked client-side; surfaces the right error
  // in the same prompt so the user can retry without losing the dialog.
  async function handleExport() {
    const project = projectStore.project;
    if (!project || exporting) return;
    const passphrase = await promptDialog({
      title: 'Export project',
      message:
        `Encrypt "${project.name}" with a passphrase and download as a .unspa file. ` +
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
      const { envelope, projectName } = await exportProjectBundle(project.id, passphrase);
      downloadEnvelopeAs(envelope, projectName);
    } catch (e) {
      const message =
        e instanceof WeakPassphraseError ? e.message : `Export failed: ${(e as Error).message}`;
      await alertDialog({ title: 'Export failed', message, tone: 'danger' });
    } finally {
      exporting = false;
    }
  }
</script>

{#if projectStore.project}
  {@const project = projectStore.project}
  <div class="mx-auto max-w-7xl px-4 py-8 sm:px-6">
    <header class="mb-6 border-b border-slate-200 pb-6">
      <div class="flex items-center justify-between gap-3">
        <a href="/projects" class="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-brand-700 hover:underline">
          <span aria-hidden="true">←</span>
          Back to projects
        </a>
        <a
          href={`/projects/${project.id}/digest`}
          class="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-brand-300 hover:bg-cyan-50 hover:text-brand-800"
          title="Read a plain-language summary of the whole project"
        >
          Summary
        </a>
        <a
          href={`/projects/${project.id}/graph`}
          class="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-brand-300 hover:bg-cyan-50 hover:text-brand-800"
          title="Open the whole project behavior graph"
        >
          Graph
        </a>
        <a
          href={`/projects/${project.id}/mcp`}
          class="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-brand-300 hover:bg-cyan-50 hover:text-brand-800"
          title="Connect AI agents to this project's features via MCP"
        >
          MCP
        </a>
        <KebabMenu align="right" placement="down" label="Project actions">
          {#snippet children(close)}
            <MenuItem
              disabled={exporting}
              onclick={() => {
                close();
                handleExport();
              }}
            >
              <span aria-hidden="true">⬇</span>
              {exporting ? 'Exporting...' : 'Export .unspa'}
            </MenuItem>
          {/snippet}
        </KebabMenu>
      </div>
      <div class="mt-3">
        <div class="min-w-0">
          {#if editingProject}
            <div class="space-y-3">
              <label class="block">
                <span class="sr-only">Project name</span>
                <input
                  type="text"
                  bind:value={nameDraft}
                  class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-3xl font-semibold tracking-tight text-slate-950 outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-100 sm:text-4xl"
                />
              </label>
              <label class="block">
                <span class="sr-only">Project description</span>
                <textarea
                  bind:value={descriptionDraft}
                  rows="3"
                  placeholder="Describe what belongs in this project..."
                  class="w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-6 text-slate-700 outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-100"
                ></textarea>
              </label>
              <div class="flex flex-wrap gap-2">
                <button
                  type="button"
                  class="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                  onclick={saveProjectMetadata}
                  disabled={projectStore.saving || nameDraft.trim().length === 0 || descriptionDraft.trim().length === 0}
                >
                  {projectStore.saving ? 'Saving...' : 'Save project'}
                </button>
                <button
                  type="button"
                  class="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  onclick={() => (editingProject = false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          {:else}
            <h1 class="truncate text-4xl font-semibold tracking-tight text-slate-950">{project.name}</h1>
            {#if project.description}
              <p class="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{project.description}</p>
            {:else}
              <p class="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
                A project that groups related behavior models and their implementation signals.
              </p>
            {/if}
            {#if project.tags && project.tags.length > 0}
              <div class="mt-3">
                <TagDotStrip tags={project.tags} />
              </div>
            {/if}
            <div class="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
              <button class="font-medium text-brand-700 hover:underline" onclick={() => (editingProject = true)}>
                Edit project
              </button>
              <span>Updated {new Date(project.updatedAt).toLocaleString()}</span>
              <span>{projectStore.saving ? 'Saving...' : 'Saved'}</span>
            </div>
          {/if}
        </div>
      </div>
      {#if projectStore.saveError}
        <p class="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {projectStore.saveError}
          <button type="button" class="ml-2 underline" onclick={() => projectStore.dismissSaveError()}>
            dismiss
          </button>
        </p>
      {/if}
    </header>

    <div class="mb-4 rounded-xl border border-slate-200 bg-white p-1 shadow-sm shadow-slate-950/5">
      <nav class="flex flex-wrap gap-1">
        {#each PANELS as panel (panel.id)}
          <button
            type="button"
            class="rounded-md px-3 py-1.5 text-sm font-medium transition {projectStore.activePanel === panel.id
              ? 'bg-slate-900 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'}"
            onclick={() => projectStore.setActivePanel(panel.id)}
          >
            {panel.label}
            <span class="ml-1 rounded bg-white/80 px-1.5 py-0.5 text-xs {projectStore.activePanel === panel.id ? 'text-brand-900' : 'text-slate-600'}">
              {panelCount(panel.id)}
            </span>
          </button>
        {/each}
      </nav>
    </div>

    {#if projectStore.activePanel !== 'features' && projectStore.activePanel !== 'history'}
      <div class="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          type="search"
          placeholder={`Search ${projectStore.activePanel}...`}
          value={projectStore.search}
          oninput={(e) => projectStore.setSearch((e.target as HTMLInputElement).value)}
          class="h-10 w-full max-w-sm rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-100"
        />
        <p class="text-xs text-slate-500">
          {panelCount(projectStore.activePanel)} {projectStore.activePanel} in this project
        </p>
      </div>
    {/if}

    {#if projectFeaturesStore.loading}
      <p class="text-sm text-slate-500">Loading features...</p>
    {:else}
      {#key projectStore.activePanel}
        <div in:fade={{ duration: 140, easing: cubicOut }} class="motion-reduce:animate-none! motion-reduce:opacity-100!">
          {#if projectStore.activePanel === 'features'}
            <ProjectFeaturesPanel
              features={projectFeaturesStore.features}
              search={projectStore.search}
              onSearch={(query) => projectStore.setSearch(query)}
              onCreate={handleCreateFeature}
              onAddTag={handleAddFeatureTag}
              onRemoveTag={handleRemoveFeatureTag}
              onRemove={handleRemoveFeature}
            />
          {:else if projectStore.activePanel === 'resources'}
            <ProjectResourcesPanel features={projectFeaturesStore.features} search={projectStore.search} />
          {:else if projectStore.activePanel === 'data'}
            <ProjectEntitiesPanel features={projectFeaturesStore.features} search={projectStore.search} />
          {:else if projectStore.activePanel === 'events'}
            <ProjectEventsPanel features={projectFeaturesStore.features} search={projectStore.search} />
          {:else if projectStore.activePanel === 'transitions'}
            <ProjectTransitionsPanel features={projectFeaturesStore.features} search={projectStore.search} />
          {:else if projectStore.activePanel === 'history'}
            <ProjectHistoryPanel />
          {/if}
        </div>
      {/key}
    {/if}
  </div>
{/if}
