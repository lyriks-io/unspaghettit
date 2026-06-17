<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { asFeatureId } from '$features/behavior-model/domain/value-objects/ids';
  import { featureStore } from '$features/behavior-model/presentation/stores/featureStore.svelte';
  import { implementationStatusStore } from '$features/implementation-status/presentation/stores/implementationStatusStore.svelte';
  import { projectContextStore } from '$features/projects/presentation/stores/projectContextStore.svelte';
  import BehaviorGraph from '$features/behavior-model/presentation/components/BehaviorGraph.svelte';

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
    Feature not found. <a href="/features" class="text-brand-700 underline">Back to list</a>.
  </div>
{:else}
  <main class="mx-auto max-w-[1600px] px-4 py-6">
    <BehaviorGraph feature={featureStore.feature} />
  </main>
{/if}
