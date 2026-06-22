<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * A small "three-dot" (⋮) overflow menu: a trigger button plus a dropdown
   * panel of actions. The codebase had no shared dropdown — each call site
   * rolled its own open/close/click-outside — so this consolidates that for the
   * project card, the projects page header, and the project detail header.
   *
   * The `children` snippet receives a `close` callback so each action can
   * dismiss the menu before running (e.g. before opening a dialog). Pair it
   * with {@link MenuItem} for consistent item styling.
   *
   * Placement: `up` opens the panel above the trigger — use it inside
   * `overflow-hidden` containers (like a card) where a downward panel would be
   * clipped or spill past the bottom edge.
   */
  type Props = {
    /** Accessible name + tooltip for the trigger. */
    label?: string;
    /** Which edge the panel aligns to. */
    align?: 'left' | 'right';
    /** Open above (`up`) or below (`down`) the trigger. */
    placement?: 'up' | 'down';
    /** Extra classes for the trigger button (sizing/tint per context). */
    triggerClass?: string;
    children: Snippet<[() => void]>;
  };

  let {
    label = 'More actions',
    align = 'right',
    placement = 'down',
    triggerClass = '',
    children
  }: Props = $props();

  let open = $state(false);
  let rootEl = $state<HTMLDivElement | null>(null);

  const close = (): void => {
    open = false;
  };

  // Only listen while open, and only on the open instance — cheaper and
  // simpler than a permanent per-card window listener.
  $effect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (rootEl && !rootEl.contains(event.target as Node)) open = false;
    };
    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') open = false;
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeydown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeydown);
    };
  });

  const panelPosition = $derived(
    `${placement === 'up' ? 'bottom-full mb-1' : 'top-full mt-1'} ${
      align === 'right' ? 'right-0' : 'left-0'
    }`
  );
</script>

<div bind:this={rootEl} class="relative inline-flex">
  <button
    type="button"
    aria-haspopup="menu"
    aria-expanded={open}
    aria-label={label}
    title={label}
    onclick={() => (open = !open)}
    class="grid h-8 w-8 place-items-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 {triggerClass}"
  >
    <svg viewBox="0 0 24 24" fill="currentColor" class="h-4 w-4" aria-hidden="true">
      <circle cx="12" cy="5" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="12" cy="19" r="1.7" />
    </svg>
  </button>

  {#if open}
    <div
      role="menu"
      class="absolute z-50 min-w-40 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-xl shadow-slate-950/10 {panelPosition}"
    >
      {@render children(close)}
    </div>
  {/if}
</div>
