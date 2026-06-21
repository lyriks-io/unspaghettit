<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { featureStore } from '$features/behavior-model/presentation/stores/featureStore.svelte';
  import { implementationStatusStore } from '$features/implementation-status/presentation/stores/implementationStatusStore.svelte';
  import { projectContextStore } from '$features/projects/presentation/stores/projectContextStore.svelte';
  import { asFeatureId } from '$features/behavior-model/domain/value-objects/ids';
  import { setFeatureQueueContext } from '$features/behavior-model/presentation/context/featureQueueContext';
  import FeatureEditor from '$features/behavior-model/presentation/components/FeatureEditor.svelte';

  // Composition root: provide the projects-feature queue context to the
  // behavior-model editors via a port they own, so they never import a sibling
  // feature's store directly.
  setFeatureQueueContext(projectContextStore);

  // Page owns the lifecycle of every editor-level store. The managers and
  // insights tabs only read; flipping between them does not tear down any
  // subscription, so MCP-side live updates and cross-feature inheritance
  // both stay correct while the user navigates inside the feature.
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
  <div class="mx-auto max-w-7xl px-4 py-10 text-sm text-neutral-500">Loading…</div>
{:else if featureStore.error}
  <div class="mx-auto max-w-7xl px-4 py-10 text-sm text-red-600">{featureStore.error}</div>
{:else if !featureStore.feature}
  <div class="mx-auto max-w-7xl px-4 py-10 text-sm text-neutral-500">
    Feature not found. <a href="/features" class="text-brand-700 underline">Back to list</a>.
  </div>
{:else}
  {#if featureStore.saveError}
    <div class="mx-auto flex max-w-400 items-center justify-between gap-2 px-4 pt-4">
      <p class="text-sm text-red-600">{featureStore.saveError}</p>
      <button
        type="button"
        class="text-xs text-neutral-400 hover:text-neutral-700"
        onclick={() => featureStore.dismissSaveError()}
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  {/if}
  <FeatureEditor feature={featureStore.feature} />
{/if}
