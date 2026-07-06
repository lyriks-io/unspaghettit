<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * One header dropdown: a trigger button plus a right-aligned panel. Owns the
   * open/close lifecycle - click-outside and Escape both dismiss, and opening
   * a sibling menu closes this one for free (the sibling's trigger click lands
   * outside this root). Same listener discipline as `KebabMenu`: handlers are
   * only bound while open.
   */
  type Props = {
    /** Accessible name for the trigger. */
    label: string;
    /** Trigger tooltip; defaults to the label. */
    title?: string;
    /** Trigger button classes, computed from the current open state. */
    triggerClass: (open: boolean) => string;
    /** Panel classes appended to the shared dropdown chrome (width etc.). */
    panelClass?: string;
    /** Trigger button inner content. */
    trigger: Snippet;
    /** Panel content; receives a `close` callback. */
    menu: Snippet<[() => void]>;
  };

  let { label, title = label, triggerClass, panelClass = 'w-60', trigger, menu }: Props = $props();

  let open = $state(false);
  let rootEl = $state<HTMLDivElement | null>(null);

  const close = (): void => {
    open = false;
  };

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
</script>

<div bind:this={rootEl} class="relative">
  <button
    type="button"
    onclick={() => (open = !open)}
    aria-haspopup="menu"
    aria-expanded={open}
    aria-label={label}
    {title}
    class={triggerClass(open)}
  >
    {@render trigger()}
  </button>
  {#if open}
    <div
      role="menu"
      class="absolute right-0 top-12 z-40 overflow-hidden rounded-lg border border-slate-200 bg-white p-1 shadow-lg shadow-slate-950/10 {panelClass}"
    >
      {@render menu(close)}
    </div>
  {/if}
</div>
