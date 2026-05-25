<script lang="ts">
  /**
   * Renders the visual highlight for a tour step:
   *   - a ring + box-shadow cutout around `rect` when a target is found
   *     and the rect overlaps the viewport
   *   - an arrow indicator pinned to the top or bottom of the viewport
   *     when the target is off-screen (the user scrolled away)
   *   - a full-screen dim when there is no target (welcome / done steps)
   *
   * Pure view: takes a rect, renders pixels. Knows nothing about where
   * the rect comes from and nothing about the tour engine. Keeping this
   * component dumb is what lets the spotlight be reused for future tour
   * flavors (e.g. an "explore mode" that highlights without an active
   * tour step).
   */
  type Props = {
    /** Viewport rect of the element to highlight, or null for a full-screen dim. */
    rect: DOMRect | null;
  };
  let { rect }: Props = $props();

  // Live viewport size so the off-screen check stays accurate after
  // window resize. `innerHeight` only reads when needed so SSR doesn't
  // crash; the spotlight only renders client-side anyway.
  let viewportHeight = $state<number>(0);
  $effect(() => {
    const set = (): void => {
      viewportHeight = window.innerHeight;
    };
    set();
    window.addEventListener('resize', set);
    return () => window.removeEventListener('resize', set);
  });

  // Padding around the target so the ring breathes around the element.
  const PAD = 10;
  // Account for the sticky app header (z-30, ~64px). Targets sitting
  // under the header count as "off-screen above" so the arrow points
  // up.
  const HEADER_OFFSET = 64;

  const ring = $derived.by(() => {
    if (!rect) return null;
    return {
      top: rect.top - PAD,
      left: rect.left - PAD,
      width: rect.width + PAD * 2,
      height: rect.height + PAD * 2
    };
  });

  /**
   * Off-screen state of the target:
   *   - 'above': target is above the visible viewport (or behind sticky header)
   *   - 'below': target is below the visible viewport
   *   - 'visible': at least partially in view
   *   - null: no target (full-screen dim case)
   */
  const offscreen = $derived.by<'above' | 'below' | 'visible' | null>(() => {
    if (!rect || viewportHeight === 0) return null;
    if (rect.bottom < HEADER_OFFSET) return 'above';
    if (rect.top > viewportHeight) return 'below';
    return 'visible';
  });
</script>

{#if ring && offscreen === 'visible'}
  <div
    class="pointer-events-none fixed z-20 rounded-lg ring-4 ring-brand-400 ring-offset-2 ring-offset-transparent"
    style="top: {ring.top}px; left: {ring.left}px; width: {ring.width}px; height: {ring.height}px; box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.55);"
    aria-hidden="true"
  ></div>
{:else if ring && offscreen === 'above'}
  <!-- Target scrolled out above the viewport: pin a "scroll up" arrow
       to the top of the visible area so the user can find it. -->
  <div
    class="pointer-events-none fixed inset-0 z-20 bg-slate-950/55"
    aria-hidden="true"
  ></div>
  <button
    type="button"
    onclick={() => window.scrollBy({ top: -window.innerHeight * 0.7, behavior: 'smooth' })}
    class="pointer-events-auto fixed left-1/2 top-20 z-1015 inline-flex -translate-x-1/2 items-center gap-2 rounded-full border border-brand-300 bg-white px-4 py-2 text-xs font-semibold text-brand-800 shadow-lg shadow-slate-950/30 animate-pulse hover:bg-brand-50"
    aria-label="Scroll up to see highlighted element"
  >
    <span aria-hidden="true">&uarr;</span>
    <span>Highlight is above &mdash; click to scroll up</span>
  </button>
{:else if ring && offscreen === 'below'}
  <div
    class="pointer-events-none fixed inset-0 z-20 bg-slate-950/55"
    aria-hidden="true"
  ></div>
  <button
    type="button"
    onclick={() => window.scrollBy({ top: window.innerHeight * 0.7, behavior: 'smooth' })}
    class="pointer-events-auto fixed left-1/2 bottom-24 z-1015 inline-flex -translate-x-1/2 items-center gap-2 rounded-full border border-brand-300 bg-white px-4 py-2 text-xs font-semibold text-brand-800 shadow-lg shadow-slate-950/30 animate-pulse hover:bg-brand-50"
    aria-label="Scroll down to see highlighted element"
  >
    <span>Highlight is below &mdash; click to scroll down</span>
    <span aria-hidden="true">&darr;</span>
  </button>
{:else}
  <!-- No target: dim the whole screen so the panel reads as a foreground
       modal rather than a passive sidebar. Pointer events pass through
       so the rest of the app stays interactive. -->
  <div
    class="pointer-events-none fixed inset-0 z-20 bg-slate-950/55"
    aria-hidden="true"
  ></div>
{/if}
