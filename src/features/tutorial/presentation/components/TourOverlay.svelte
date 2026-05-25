<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { tourStore } from '$features/tutorial/presentation/stores/tourStore.svelte';
  import {
    createTargetTracker,
    type TargetTracker
  } from '$features/tutorial/presentation/adapters/useTargetTracker.svelte';
  import { seedPending } from '$features/tutorial/presentation/adapters/inputPrefill';
  import { createTopLayerStacker } from '$features/tutorial/presentation/adapters/topLayerStacker';
  import TourPanel from './TourPanel.svelte';
  import TourSpotlight from './TourSpotlight.svelte';

  /**
   * Thin orchestrator. Composes:
   *   - TourPanel (the side-panel UI, rendered as a `[popover]`)
   *   - TourSpotlight (the highlight ring / full-screen dim)
   *   - useTargetTracker  (DOM observer that maps selector → live rect)
   *   - inputPrefill       (seeds tour-nominated inputs)
   *   - topLayerStacker    (keeps the panel above other top-layer dialogs)
   *
   * Each chunk knows one thing. This file's only job is gluing them to
   * the tour store and to the SvelteKit `page` for the route check.
   */

  const step = $derived(tourStore.currentStep);
  const onCorrectRoute = $derived.by(() => {
    if (!step?.route) return true;
    return page.url?.pathname === step.route.pathname;
  });

  // (Re)create the target tracker whenever the selector changes.
  let tracker = $state<TargetTracker | null>(null);
  $effect(() => {
    const sel = onCorrectRoute ? (step?.target ?? null) : null;
    const t = createTargetTracker(sel);
    tracker = t;
    return () => t.dispose();
  });

  const targetRect = $derived(tracker?.rect ?? null);

  /**
   * Resolved panel placement honouring the step's `panelPosition` hint:
   *   - `bottom-right` (default): pinned corner.
   *   - `avoid-target`: flip to bottom-left if the target sits in the
   *     right half of the viewport (simulator steps).
   *   - `below-target`: position directly under the highlighted rect,
   *     centred horizontally. Falls back to bottom-right if there's no
   *     room or no target.
   */
  const PANEL_WIDTH = 320; // matches Tailwind w-80
  const PANEL_HEIGHT_ESTIMATE = 220;
  const PANEL_MARGIN = 16;

  type PanelPlacement =
    | { readonly kind: 'bottom-right' }
    | { readonly kind: 'bottom-left' }
    | { readonly kind: 'absolute'; readonly top: number; readonly left: number };

  const panelPlacement = $derived.by<PanelPlacement>(() => {
    if (typeof window === 'undefined') return { kind: 'bottom-right' };
    const mode = step?.panelPosition ?? 'bottom-right';
    if (mode === 'avoid-target') {
      if (!targetRect) return { kind: 'bottom-right' };
      const targetInRightHalf =
        targetRect.left + targetRect.width / 2 > window.innerWidth / 2;
      return targetInRightHalf ? { kind: 'bottom-left' } : { kind: 'bottom-right' };
    }
    if (mode === 'below-target' && targetRect) {
      const top = targetRect.bottom + PANEL_MARGIN;
      const wouldOverflow = top + PANEL_HEIGHT_ESTIMATE > window.innerHeight - PANEL_MARGIN;
      if (wouldOverflow) return { kind: 'bottom-right' };
      const centredLeft = targetRect.left + targetRect.width / 2 - PANEL_WIDTH / 2;
      const left = Math.max(
        PANEL_MARGIN,
        Math.min(centredLeft, window.innerWidth - PANEL_WIDTH - PANEL_MARGIN)
      );
      return { kind: 'absolute', top, left };
    }
    return { kind: 'bottom-right' };
  });

  /**
   * Whether the Next button should be enabled. Manual steps default
   * to enabled; click/event steps default to disabled (only the natural
   * trigger advances). A step's optional `canAdvance` predicate
   * overrides the manual default — used by the form-modification steps
   * to gate Next until the user has actually added the
   * parameter/effect/rule.
   */
  const nextEnabled = $derived.by<boolean>(() => {
    if (!step) return false;
    if (step.advance.kind !== 'manual') return false;
    if (step.canAdvance) return step.canAdvance();
    return true;
  });

  // Whenever the tracked target changes (step entry, remount, route
  // change), pull it into view so the user can see what's highlighted
  // without scrolling around. `scrollIntoView` is a no-op if already
  // in view, so this is safe to fire on every change.
  $effect(() => {
    const el = tracker?.element;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  // Auto-focus the step's nominated input when the step becomes
  // active. Retries on rAF until the input is in the DOM (a still-
  // mounting modal can take a frame or two).
  $effect(() => {
    const s = step;
    if (!s?.focusSelector || !onCorrectRoute) return;
    const selector = s.focusSelector;
    let cancelled = false;
    let tries = 0;
    const tryFocus = (): void => {
      if (cancelled || tries++ > 60) return;
      const el = document.querySelector<HTMLElement>(selector);
      if (el) {
        el.focus();
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          el.select();
        }
        return;
      }
      requestAnimationFrame(tryFocus);
    };
    requestAnimationFrame(tryFocus);
    return () => {
      cancelled = true;
    };
  });

  // Lock body scroll when the active step asks for it (e.g. the final
  // "you're done" step where we don't want the user wandering off
  // while reading the wrap-up). Restores on step change.
  $effect(() => {
    if (!step?.lockScroll) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  });

  // Auto-rewind: if a step's target was found at some point and then
  // disappears (e.g. the user cancelled a dialog the next step lives
  // inside), step back to the previous step so its target — typically
  // the button that opened the dialog — is highlighted again and the
  // user can retry. The "everFound" gate prevents rewinding while a
  // page is still loading and the target hasn't appeared yet.
  $effect(() => {
    const s = step;
    if (!s?.target) return;
    if (tourStore.stepIndex === 0) return;

    let everFound = false;
    let rewindTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const REWIND_DELAY_MS = 500;
    const POLL_MS = 150;

    const poll = setInterval(() => {
      if (cancelled) return;
      const found = tracker?.element != null;
      if (found) {
        everFound = true;
        if (rewindTimer) {
          clearTimeout(rewindTimer);
          rewindTimer = null;
        }
      } else if (everFound && !rewindTimer) {
        rewindTimer = setTimeout(() => tourStore.previous(), REWIND_DELAY_MS);
      }
    }, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(poll);
      if (rewindTimer) clearTimeout(rewindTimer);
    };
  });

  // Spec-event-triggered advance is the store's job, but click-triggered
  // advance needs DOM. Attach a document-level capture-phase listener
  // so the user's click on the highlighted element advances us; the
  // setTimeout lets the page's own handler run first (open dialog,
  // navigate, etc.) before we re-resolve for the next step.
  $effect(() => {
    const s = step;
    if (!s || s.advance.kind !== 'click') return;
    const selector = s.advance.selector;
    const onClick = (event: MouseEvent) => {
      const t = event.target;
      if (!(t instanceof Element)) return;
      if (!t.closest(selector)) return;
      setTimeout(() => tourStore.next(), 0);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  });

  // Seed any prefill items the step nominates. Polled via rAF until
  // every selector resolves, in case the target form is mid-mount.
  $effect(() => {
    const s = step;
    if (!s?.prefill || s.prefill.length === 0 || !onCorrectRoute) return;
    let pending = [...s.prefill];
    let rafId = 0;
    let cancelled = false;
    const tick = (): void => {
      if (cancelled) return;
      pending = seedPending(pending);
      if (pending.length > 0) rafId = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
    };
  });

  // Show/hide the popover when the tour activates/deactivates, and
  // wire the top-layer stacker so any modal dialog opened later by
  // the app bumps our popover back to the top of the top-layer stack.
  let panelEl = $state<HTMLElement | null>(null);

  $effect(() => {
    if (!panelEl) return;
    if (step && !panelEl.matches(':popover-open')) panelEl.showPopover();
    if (!step && panelEl.matches(':popover-open')) panelEl.hidePopover();
  });

  $effect(() => {
    if (!panelEl) return;
    const stacker = createTopLayerStacker(panelEl);
    return () => stacker.dispose();
  });

  function handleGoToRoute(): void {
    if (!step?.route) return;
    void goto(step.route.pathname);
  }
</script>

{#if step}
  {#if onCorrectRoute}
    <TourSpotlight rect={targetRect} />
  {/if}
  <TourPanel
    {step}
    stepNumber={tourStore.stepIndex + 1}
    totalSteps={tourStore.totalSteps}
    {onCorrectRoute}
    placement={panelPlacement}
    {nextEnabled}
    panelEl={(el) => (panelEl = el)}
    onGoToRoute={handleGoToRoute}
    onPrev={() => tourStore.previous()}
    onNext={() => tourStore.next()}
    onExit={() => tourStore.cancel()}
  />
{/if}
