<script lang="ts">
  import { page } from '$app/state';
  import { tourStore } from '$features/tutorial/presentation/stores/tourStore.svelte';
  import { onboardingStore } from '$features/tutorial/presentation/stores/onboardingStore.svelte';
  import { firstFeatureTour } from '$features/tutorial/infrastructure/tours/firstFeatureTour';
  import { runLoadSamplesFlow } from '$features/behavior-model/presentation/loadSamplesFlow';

  /**
   * Persistent "Getting started" strip under the header. Stays visible
   * on every Expert-view page until the user finishes the interactive
   * tour or closes the banner - both remembered per browser (see
   * onboardingStore). Hidden while the tour itself is running, on the
   * Help page (which carries the same actions), and in Builder mode
   * (its own world, dark chrome).
   */

  const onQuietRoute = $derived(
    page.url.pathname.startsWith('/tutorial') || page.url.pathname.startsWith('/builder-mode')
  );
  const visible = $derived(onboardingStore.showBanner && !tourStore.isActive && !onQuietRoute);

  let loadingSamples = $state(false);

  async function loadSamples(): Promise<void> {
    if (loadingSamples) return;
    loadingSamples = true;
    try {
      await runLoadSamplesFlow();
    } finally {
      loadingSamples = false;
    }
  }
</script>

{#if visible}
  <div class="border-b border-brand-200/70 bg-brand-50/80">
    <div
      class="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-2.5 sm:px-6 md:flex-row md:items-center md:gap-4"
    >
      <p class="min-w-0 flex-1 text-sm leading-5 text-slate-700">
        <span class="font-semibold text-slate-900">New here?</span>
        Take the 3-minute interactive tour: build a tiny feature and run it in the simulator, right
        in this app.
      </p>
      <div class="flex shrink-0 flex-wrap items-center gap-2">
        <button
          type="button"
          onclick={() => tourStore.start(firstFeatureTour)}
          class="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-slate-950/10 transition hover:bg-brand-800"
        >
          Start the tour
        </button>
        <button
          type="button"
          onclick={loadSamples}
          disabled={loadingSamples}
          class="rounded-md border border-brand-300 bg-white px-3 py-1.5 text-xs font-medium text-brand-800 transition hover:bg-brand-100 disabled:cursor-wait disabled:opacity-70"
        >
          {loadingSamples ? 'Loading...' : 'Load sample project'}
        </button>
        <a
          href="/tutorial"
          class="rounded-md px-2 py-1.5 text-xs font-medium text-brand-800 underline-offset-2 transition hover:underline"
        >
          Read the guide
        </a>
        <button
          type="button"
          onclick={() => onboardingStore.dismiss()}
          class="grid h-7 w-7 place-items-center rounded-md text-slate-500 transition hover:bg-brand-100 hover:text-slate-800"
          aria-label="Dismiss the getting-started banner"
          title="Don't show this again (the Help page keeps these shortcuts)"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="h-4 w-4"
            aria-hidden="true"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>
    </div>
  </div>
{/if}
