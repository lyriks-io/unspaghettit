<script lang="ts">
  import { onMount } from 'svelte';
  import { withBase } from '$shared/routing/appBase';
  import { page } from '$app/stores';
  import { asFeatureId } from '$features/behavior-model/domain/value-objects/ids';
  import { featureStore } from '$features/behavior-model/presentation/stores/featureStore.svelte';
  import { implementationStatusStore } from '$features/implementation-status/presentation/stores/implementationStatusStore.svelte';
  import { projectContextStore } from '$features/projects/presentation/stores/projectContextStore.svelte';
  import { setFeatureQueueContext } from '$features/behavior-model/presentation/context/featureQueueContext';
  import ProjectionViewer from '$features/diagram-projection/presentation/components/ProjectionViewer.svelte';
  import { fillViewportHeight } from '$shared/presentation/actions/fillViewportHeight';

  // Provide the queue context for any editor descendant (e.g. FeatureHeader)
  // rendered under the graph view, mirroring the main feature page.
  setFeatureQueueContext(projectContextStore);

  onMount(() => {
    const id = asFeatureId($page.params.id ?? '');
    featureStore.load(id);
    projectContextStore.load(id);
    return () => {
      featureStore.reset();
      implementationStatusStore.reset();
      projectContextStore.reset();
    };
  });
</script>

{#if featureStore.loading}
  <div class="mx-auto max-w-7xl px-4 py-10 text-sm text-neutral-500">Loading...</div>
{:else if featureStore.error}
  <div class="mx-auto max-w-7xl px-4 py-10 text-sm text-red-600">{featureStore.error}</div>
{:else if !featureStore.feature}
  <div class="mx-auto max-w-7xl px-4 py-10 text-sm text-neutral-500">
    Feature not found. <a href={withBase('/projects')} class="text-brand-700 underline">Back to projects</a>.
  </div>
{:else}
  <!-- Fill exactly the space below whatever sits above (sticky header, the
       getting-started banner, ...); a hard-coded calc drifts the moment any
       of those render and leaves a window scrollbar on an otherwise
       fixed-height page. -->
  <main
    use:fillViewportHeight
    class="w-full px-4 py-6 lg:flex lg:flex-col lg:overflow-hidden"
  >
    <ProjectionViewer feature={featureStore.feature} />
  </main>
{/if}
