<script lang="ts">
  import type { TourStep } from '$features/tutorial/domain/entities/TourStep';

  /**
   * The side-panel UI of the tour: title, body, navigation buttons,
   * "go to route" CTA when the user is on the wrong page.
   *
   * Rendered as a `[popover="manual"]` element so the browser places it
   * in the top layer cross-browser. Native `<dialog>.show()` is only
   * top-layer in Chromium; the Popover API is the cross-browser
   * equivalent and supports the same "last opened wins" re-stacking we
   * need to bump the panel above any modal dialog the app opens during
   * the tour.
   *
   * Pure view: receives all dynamic data via props + callbacks, owns no
   * state, knows nothing about the DOM at large. The orchestrator
   * (TourOverlay) feeds it the active step, the resolved position, and
   * the canAdvance verdict.
   */
  export type PanelPlacement =
    | { readonly kind: 'bottom-right' }
    | { readonly kind: 'bottom-left' }
    | { readonly kind: 'absolute'; readonly top: number; readonly left: number };

  type Props = {
    step: TourStep;
    /** 1-based index of the current step. */
    stepNumber: number;
    totalSteps: number;
    /** True when the page route already matches the step's `route.pathname`. */
    onCorrectRoute: boolean;
    /** Resolved by the parent based on the step + target rect. */
    placement: PanelPlacement;
    /** Whether the user has fulfilled the step's requirements (for manual-advance steps). */
    nextEnabled: boolean;
    /**
     * Bound by the parent so it can call .showPopover()/.hidePopover()
     * on the underlying element.
     */
    panelEl?: (el: HTMLElement | null) => void;
    onGoToRoute: () => void;
    onPrev: () => void;
    onNext: () => void;
    onExit: () => void;
  };
  let {
    step,
    stepNumber,
    totalSteps,
    onCorrectRoute,
    placement,
    nextEnabled,
    panelEl,
    onGoToRoute,
    onPrev,
    onNext,
    onExit
  }: Props = $props();

  let element = $state<HTMLElement | null>(null);
  $effect(() => {
    panelEl?.(element);
  });

  const isFirst = $derived(stepNumber === 1);
  const isLast = $derived(stepNumber === totalSteps);

  /** Inline style string for the popover. Adds 1.5rem margins on edges. */
  const positionStyle = $derived.by<string>(() => {
    switch (placement.kind) {
      case 'bottom-right':
        return 'bottom: 1.5rem; right: 1.5rem; left: auto; top: auto;';
      case 'bottom-left':
        return 'bottom: 1.5rem; left: 1.5rem; right: auto; top: auto;';
      case 'absolute':
        return `top: ${placement.top}px; left: ${placement.left}px; bottom: auto; right: auto;`;
    }
  });
</script>

<aside
  bind:this={element}
  popover="manual"
  class="fixed z-1010 m-0 w-80 max-w-[calc(100vw-3rem)] rounded-xl border border-brand-200 bg-white p-4 shadow-2xl shadow-slate-950/20 transition-[top,left,bottom,right] duration-200"
  style={positionStyle}
  aria-label="Interactive tutorial"
>
  <header class="mb-2 flex items-start justify-between gap-3">
    <div class="min-w-0">
      <p class="text-[10px] font-semibold uppercase tracking-wide text-brand-700">
        Tutorial &middot; step {stepNumber} of {totalSteps}
      </p>
      <h3 class="mt-0.5 text-sm font-semibold text-slate-950">{step.title}</h3>
    </div>
    <button
      type="button"
      onclick={onExit}
      class="rounded-md px-1.5 py-0.5 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-700"
      aria-label="Exit tutorial"
      title="Exit tutorial"
    >
      x
    </button>
  </header>

  <p class="whitespace-pre-line text-xs leading-5 text-slate-700">{step.body}</p>

  {#if !onCorrectRoute && step.route}
    <div
      class="mt-3 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-900"
    >
      <p class="mb-1.5 font-medium">First, head to the right page.</p>
      <button
        type="button"
        onclick={onGoToRoute}
        class="rounded-md bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-slate-800"
      >
        {step.route.label} &rarr;
      </button>
    </div>
  {:else if step.advance.kind === 'click'}
    <p class="mt-3 text-[10px] italic text-slate-500">
      Click the highlighted element to continue.
    </p>
  {:else if step.advance.kind === 'event'}
    <p class="mt-3 text-[10px] italic text-slate-500">
      Do the action above to continue.
    </p>
  {:else if step.advance.kind === 'manual' && !nextEnabled}
    <p class="mt-3 text-[10px] italic text-amber-700">
      Finish the action above first, then click Next.
    </p>
  {/if}

  <footer class="mt-3 flex items-center justify-between gap-2">
    <button
      type="button"
      onclick={onPrev}
      disabled={isFirst}
      class="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-30"
      aria-label="Previous step"
      title="Back"
    >
      &larr;
    </button>
    <button
      type="button"
      onclick={onExit}
      class="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
    >
      Exit
    </button>
    <button
      type="button"
      onclick={onNext}
      disabled={!nextEnabled}
      class="rounded-md bg-brand-700 px-3 py-1 text-[11px] font-semibold text-white hover:bg-brand-800 disabled:cursor-not-allowed disabled:bg-slate-300"
      title={nextEnabled
        ? isLast
          ? 'Finish the tour'
          : 'Next step'
        : 'Finish the current action first'}
    >
      {isLast ? 'Finish' : 'Next'} &rarr;
    </button>
  </footer>
</aside>
