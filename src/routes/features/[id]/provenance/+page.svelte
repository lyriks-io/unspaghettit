<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { asFeatureId } from '$features/behavior-model/domain/value-objects/ids';
  import { featureStore } from '$features/behavior-model/presentation/stores/featureStore.svelte';
  import { provenanceStore } from '$features/source-provenance/presentation/stores/provenanceStore.svelte';
  import SourceViewer from '$features/source-provenance/presentation/components/SourceViewer.svelte';

  const featureId = $derived($page.params.id ?? '');

  onMount(() => {
    const id = asFeatureId($page.params.id ?? '');
    featureStore.load(id);
    provenanceStore.load(id);
    return () => {
      featureStore.reset();
      provenanceStore.reset();
    };
  });
</script>

<main class="mx-auto max-w-7xl px-4 py-6">
  <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
    <div>
      <h1 class="text-lg font-semibold text-slate-800">Source provenance</h1>
      <p class="text-xs text-slate-500">
        The file an agent analyzed, with every extracted element highlighted at the span it was
        derived from. Click a highlight or a span to follow it.
      </p>
    </div>
    {#if featureId}
      <a href={`/features/${featureId}`} class="text-xs text-brand-700 underline">Back to feature</a
      >
    {/if}
  </div>

  {#if featureStore.loading}
    <div class="py-10 text-sm text-slate-500">Loading…</div>
  {:else if featureStore.error}
    <div class="py-10 text-sm text-red-600">{featureStore.error}</div>
  {:else if !featureStore.feature}
    <div class="py-10 text-sm text-slate-500">
      Feature not found. <a href="/projects" class="text-brand-700 underline">Back to projects</a>.
    </div>
  {:else}
    <SourceViewer
      feature={featureStore.feature}
      provenance={provenanceStore.provenance}
      sources={provenanceStore.sources}
      loading={provenanceStore.loading}
      refreshing={provenanceStore.refreshing}
      error={provenanceStore.error}
      onRefresh={() => provenanceStore.refresh()}
    />
  {/if}
</main>
