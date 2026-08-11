<script lang="ts">
  import { page } from '$app/stores';
  import { withBase } from '$shared/routing/appBase';
  import { asFeatureId } from '$features/behavior-model/domain/value-objects/ids';
  import { featureStore } from '$features/behavior-model/presentation/stores/featureStore.svelte';
  import { projectContextStore } from '$features/projects/presentation/stores/projectContextStore.svelte';
  import { setFeatureQueueContext } from '$features/behavior-model/presentation/context/featureQueueContext';
  import DigestView from '$features/behavior-digest/presentation/components/DigestView.svelte';

  // Provide the queue context for any editor descendant, mirroring the graph view.
  setFeatureQueueContext(projectContextStore);

  // Load, and refresh when the feature id changes (even if SvelteKit reuses this
  // component across a param-only navigation, where onMount fires only once).
  //
  // We deliberately do NOT reset featureStore on destroy. A summary line is a
  // jump link straight into the feature editor, which shares this singleton
  // store; resetting here nulls `feature` mid-navigation and crashes the editor's
  // panels (MaturityPanel reads feature.id in an $effect). The editor route loads
  // the store itself, so the handoff stays populated.
  let loadedId = '';
  $effect(() => {
    const raw = $page.params.id ?? '';
    if (!raw || raw === loadedId) return;
    loadedId = raw;
    const id = asFeatureId(raw);
    featureStore.load(id);
    projectContextStore.load(id);
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
  <main class="w-full px-4 py-6">
    <DigestView feature={featureStore.feature} />
  </main>
{/if}
