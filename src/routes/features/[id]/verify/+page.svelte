<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { asFeatureId } from '$features/behavior-model/domain/value-objects/ids';
  import { featureStore } from '$features/behavior-model/presentation/stores/featureStore.svelte';
  import { projectContextStore } from '$features/projects/presentation/stores/projectContextStore.svelte';
  import { setFeatureQueueContext } from '$features/behavior-model/presentation/context/featureQueueContext';
  import { verificationStore } from '$features/verification/presentation/stores/verificationStore.svelte';
  import VerifyPanel from '$features/verification/presentation/components/VerifyPanel.svelte';

  setFeatureQueueContext(projectContextStore);

  const featureId = $derived(asFeatureId($page.params.id ?? ''));
  const verdict = $derived(
    verificationStore.report?.features.find((f) => f.featureId === String(featureId)) ?? null
  );
  const siblings = $derived(
    (verificationStore.report?.features ?? []).filter((f) => f.featureId !== String(featureId))
  );

  onMount(() => {
    const id = asFeatureId($page.params.id ?? '');
    featureStore.load(id);
    projectContextStore.load(id);
    verificationStore.load(id);
    return () => {
      featureStore.reset();
      projectContextStore.reset();
      verificationStore.reset();
    };
  });
</script>

<main class="mx-auto max-w-5xl px-4 py-6">
  <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
    <div>
      <h1 class="text-lg font-semibold text-slate-800">Verify</h1>
      <p class="text-xs text-slate-500">
        Scenarios, maturity, navigation reachability, bounded model checking, drift, and
        cross-feature event wiring — the spec broken loudly.
      </p>
    </div>
    <div class="flex items-center gap-3 text-xs">
      <label class="flex items-center gap-1.5 text-slate-600">
        <input
          type="checkbox"
          checked={verificationStore.modelCheck}
          onchange={(e) => verificationStore.setModelCheck(e.currentTarget.checked)}
        />
        Model check
      </label>
      <button
        class="rounded-md border border-slate-200 px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        disabled={verificationStore.loading}
        onclick={() => verificationStore.refresh()}
      >
        {verificationStore.loading ? 'Running…' : 'Re-run'}
      </button>
    </div>
  </div>

  {#if verificationStore.loading && !verificationStore.report}
    <div class="py-10 text-sm text-slate-500">Running verification…</div>
  {:else if verificationStore.error}
    <div class="py-10 text-sm text-red-600">{verificationStore.error}</div>
  {:else if !verdict}
    <div class="py-10 text-sm text-slate-500">
      Nothing to verify. <a href="/features" class="text-brand-700 underline">Back to list</a>.
    </div>
  {:else}
    <div class="space-y-4">
      <VerifyPanel {verdict} />

      {#if siblings.length > 0}
        <details class="rounded-xl border border-slate-200 bg-white shadow-sm shadow-slate-950/5">
          <summary class="cursor-pointer px-4 py-3 text-xs font-medium text-slate-600">
            Project context — {siblings.length} sibling feature{siblings.length === 1 ? '' : 's'}
            verified alongside (cross-feature checks span all of them)
          </summary>
          <div class="space-y-3 px-4 pb-4">
            {#each siblings as sibling (sibling.featureId)}
              <VerifyPanel verdict={sibling} />
            {/each}
          </div>
        </details>
      {/if}
    </div>
  {/if}
</main>
