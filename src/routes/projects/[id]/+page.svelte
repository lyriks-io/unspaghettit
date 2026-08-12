<script lang="ts">
  import { pageTitle } from '$features/app-shell/presentation/pageTitle';
  import { withBase } from '$shared/routing/appBase';
  import { goto } from '$app/navigation';
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { projectStore } from '$features/projects/presentation/stores/projectStore.svelte';
  import { projectFeaturesStore } from '$features/projects/presentation/stores/projectFeaturesStore.svelte';
  import { asProjectId } from '$features/projects/domain/value-objects/ids';
  import { asFeatureId } from '$features/behavior-model/domain/value-objects/ids';
  import ProjectEditor from '$features/projects/presentation/components/ProjectEditor.svelte';
  import { subscribeSyncEvents } from '$lib/client/sync/syncEvents';

  let unsubscribeSync: (() => void) | null = null;

  onMount(async () => {
    const raw = $page.params.id;
    if (!raw) return;
    const id = asProjectId(raw);
    await projectStore.load(id);
    if (!projectStore.project && !projectStore.error) {
      // A dead link (stale id from a host application, deleted project) lands
      // on the live projects list instead of a dead-end page; replaceState
      // keeps the browser's Back button out of the redirect loop. Load errors
      // still render in place: they are transient and a redirect would hide them.
      void goto(withBase('/projects'), { replaceState: true });
      return;
    }
    await projectFeaturesStore.loadAllSummaries();
    if (projectStore.project) {
      await projectFeaturesStore.load(projectStore.project.featureIds);
    }
    // Out-of-band sync: keep the open page live without the "Loading
    // features..." flash that a full refetch produces. The projectStore
    // already subscribes to the project's Y.Doc room (subscribeRoom),
    // so project metadata + featureIds update reactively without any work
    // here. We only need to:
    //   - project event for this id  → reconcile the features list
    //     against the (possibly new) featureIds, silently
    //   - feature event for one of our features → refetch just that
    //     feature, in place, no flicker
    //   - feature event for an unrelated feature → still refresh the
    //     "all summaries" sidebar pool, silently
    unsubscribeSync = subscribeSyncEvents(async (evt) => {
      if (!projectStore.project) return;
      if (evt.kind === 'project' && evt.id === String(id)) {
        await projectFeaturesStore.syncWith(projectStore.project.featureIds);
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
    projectStore.reset();
    projectFeaturesStore.reset();
  });
</script>

<svelte:head>
  <title>{pageTitle($page.url, projectStore.project?.name, 'Project')}</title>
</svelte:head>

{#if projectStore.loading}
  <p class="mx-auto max-w-7xl px-4 py-10 text-sm text-neutral-500">Loading project…</p>
{:else if projectStore.error}
  <p class="mx-auto max-w-7xl px-4 py-10 text-sm text-red-600">{projectStore.error}</p>
{:else if !projectStore.project}
  <!-- Momentary: onMount redirects to the projects list. The link is the
       fallback if that navigation ever fails. -->
  <p class="mx-auto max-w-7xl px-4 py-10 text-sm text-neutral-500">
    Project not found; taking you to the list.
    <a href={withBase('/projects')} class="text-brand-700 hover:underline">← Back to projects</a>
  </p>
{:else}
  <ProjectEditor />
{/if}
