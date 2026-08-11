<script lang="ts">
  import { pageTitle } from '$features/app-shell/presentation/pageTitle';
  import { withBase } from '$shared/routing/appBase';
  import { onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { projectStore } from '$features/projects/presentation/stores/projectStore.svelte';
  import { projectFeaturesStore } from '$features/projects/presentation/stores/projectFeaturesStore.svelte';
  import { asProjectId } from '$features/projects/domain/value-objects/ids';
  import DigestView from '$features/behavior-digest/presentation/components/DigestView.svelte';

  // Reload when the project id changes, even if SvelteKit reuses this component
  // across a param-only navigation (onMount fires only once).
  let loadedId = '';
  $effect(() => {
    const raw = $page.params.id ?? '';
    if (!raw || raw === loadedId) return;
    loadedId = raw;
    const id = asProjectId(raw);
    void (async () => {
      await projectStore.load(id);
      if (projectStore.project) {
        await projectFeaturesStore.load(projectStore.project.featureIds);
      }
    })();
  });

  onDestroy(() => {
    projectStore.reset();
    projectFeaturesStore.reset();
  });
</script>

<svelte:head>
  <title>{pageTitle($page.url, projectStore.project?.name, 'Summary')}</title>
</svelte:head>

{#if projectStore.loading}
  <p class="mx-auto max-w-7xl px-4 py-10 text-sm text-neutral-500">Loading project...</p>
{:else if projectStore.error}
  <p class="mx-auto max-w-7xl px-4 py-10 text-sm text-red-600">{projectStore.error}</p>
{:else if !projectStore.project}
  <p class="mx-auto max-w-7xl px-4 py-10 text-sm text-neutral-500">
    Project not found. <a href={withBase('/projects')} class="text-brand-700 hover:underline">Back to projects</a>.
  </p>
{:else}
  <main class="mx-auto max-w-7xl px-4 py-8 sm:px-6">
    <div class="mb-6">
      <a
        href={withBase(`/projects/${projectStore.project.id}`)}
        class="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-brand-700 hover:underline"
      >
        <span aria-hidden="true">&larr;</span>
        Back to {projectStore.project.name}
      </a>
    </div>
    {#if projectFeaturesStore.loading}
      <p class="text-sm text-slate-500">Loading features...</p>
    {:else}
      <DigestView features={projectFeaturesStore.features} project={projectStore.project} />
    {/if}
  </main>
{/if}
