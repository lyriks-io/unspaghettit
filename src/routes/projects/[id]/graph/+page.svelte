<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { page } from '$app/stores';
  import { asFeatureId } from '$features/behavior-model/domain/value-objects/ids';
  import BehaviorGraph from '$features/behavior-model/presentation/components/BehaviorGraph.svelte';
  import { asProjectId } from '$features/projects/domain/value-objects/ids';
  import { projectFeaturesStore } from '$features/projects/presentation/stores/projectFeaturesStore.svelte';
  import { projectStore } from '$features/projects/presentation/stores/projectStore.svelte';
  import { subscribeSyncEvents } from '$lib/client/sync/syncEvents';

  let unsubscribeSync: (() => void) | null = null;
  let graphDataReady = $state(false);

  onMount(async () => {
    const raw = $page.params.id;
    if (!raw) return;
    graphDataReady = false;
    const id = asProjectId(raw);
    await projectStore.load(id);
    await projectFeaturesStore.loadAllSummaries();
    if (projectStore.project) {
      await projectFeaturesStore.load(projectStore.project.featureIds);
    }
    graphDataReady = true;
    unsubscribeSync = subscribeSyncEvents(async (evt) => {
      if (!projectStore.project) return;
      if (evt.kind === 'project' && evt.id === String(id)) {
        graphDataReady = false;
        await projectFeaturesStore.syncWith(projectStore.project.featureIds);
        graphDataReady = true;
      } else if (evt.kind === 'feature') {
        const ours = projectStore.project.featureIds.some((fid) => String(fid) === evt.id);
        if (ours) {
          await projectFeaturesStore.refetchOne(asFeatureId(evt.id));
        } else {
          await projectFeaturesStore.loadAllSummaries();
        }
      }
    });
  });

  onDestroy(() => {
    unsubscribeSync?.();
    unsubscribeSync = null;
    graphDataReady = false;
    projectStore.reset();
    projectFeaturesStore.reset();
  });
</script>

<svelte:head>
  <title>Project Graph / Unspaghettit</title>
</svelte:head>

{#if projectStore.loading}
  <p class="mx-auto max-w-7xl px-4 py-10 text-sm text-neutral-500">Loading project...</p>
{:else if projectStore.error}
  <p class="mx-auto max-w-7xl px-4 py-10 text-sm text-red-600">{projectStore.error}</p>
{:else if !projectStore.project}
  <p class="mx-auto max-w-7xl px-4 py-10 text-sm text-neutral-500">
    Project not found. <a href="/projects" class="text-brand-700 hover:underline">Back to projects</a>
  </p>
{:else if projectFeaturesStore.loading || !graphDataReady}
  <p class="mx-auto max-w-7xl px-4 py-10 text-sm text-neutral-500">Loading project features...</p>
{:else if projectFeaturesStore.error}
  <p class="mx-auto max-w-7xl px-4 py-10 text-sm text-red-600">{projectFeaturesStore.error}</p>
{:else if projectStore.project.featureIds.length > 0 && projectFeaturesStore.features.length === 0}
  <div class="mx-auto max-w-7xl px-4 py-10">
    <p class="text-sm font-medium text-slate-900">No feature snapshots loaded for this project.</p>
    <p class="mt-2 text-sm text-slate-600">
      The project lists {projectStore.project.featureIds.length} feature{projectStore.project.featureIds.length === 1 ? '' : 's'},
      but the graph could not load their behavior models from the shared hub.
    </p>
  </div>
{:else}
  <main class="mx-auto max-w-[1800px] px-4 py-6">
    <BehaviorGraph project={projectStore.project} features={projectFeaturesStore.features} />
  </main>
{/if}
