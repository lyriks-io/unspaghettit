<script lang="ts">
  /**
   * Reusable maturity / implementation progress bar.
   *
   * Designed to replace the "single flat colored fill" pattern that was
   * scattered across FeatureCard / MaturityPanel / FeatureHealthStrip.
   * Adds:
   *   - tier-based color (red < 50%, amber < 80%, emerald >= 80%) when no
   *     explicit `color` is passed. The tier breakpoints match the
   *     existing scorer thresholds so the visual identity stays in step
   *     with the textual "critical / recommended" semantics.
   *   - optional threshold ticks (50% + 80% by default). They anchor the
   *     bar to the same tiers as the color, so a 65% bar visibly reads
   *     "past the red zone, not yet in the green zone" instead of just
   *     "amber".
   *   - smooth width transition so live edits (Yjs reconcile, MCP
   *     writes) animate from old → new value instead of teleporting.
   *   - subtle inner shadow on the track + gradient overlay on the fill
   *     so the bar feels like a control, not a flat rectangle.
   *
   * Props are deliberately minimal so the bar can be dropped anywhere
   * without forcing the caller to learn a wide API.
   */

  type Size = 'xs' | 'sm' | 'md';

  type Props = {
    /** 0–100. Clamped defensively so a malformed score can't break layout. */
    percentage: number;
    /**
     * Optional explicit fill color (CSS color string). When omitted, the
     * bar picks one from the tier table below based on `percentage`. Use
     * this when the caller already computes an "adaptive" color from a
     * MaturityReport (e.g. shifting on critical-issue count).
     */
    color?: string;
    /** Bar height. xs=4, sm=6, md=10. Default sm. */
    size?: Size;
    /**
     * Show the small "65%" label to the right of the bar. Off by
     * default — most callers pair the bar with their own surrounding
     * percentage badge, so adding a duplicate would crowd the row.
     */
    showLabel?: boolean;
    /**
     * Draw thin vertical ticks at these percentages. Default [50, 80]
     * mirrors the tier breakpoints. Pass [] to suppress.
     */
    ticks?: readonly number[];
    /** Accessible label for screen readers. */
    ariaLabel?: string;
  };

  let {
    percentage,
    color,
    size = 'sm',
    showLabel = false,
    ticks = [50, 80],
    ariaLabel
  }: Props = $props();

  const clamped = $derived(Math.max(0, Math.min(100, Math.round(percentage))));

  const tierColor = $derived(
    clamped >= 80
      ? '#10b981'   // emerald-500
      : clamped >= 50
        ? '#f59e0b' // amber-500
        : '#ef4444' // red-500
  );

  const fillColor = $derived(color ?? tierColor);

  const trackHeightClass = $derived(
    size === 'md' ? 'h-2.5' : size === 'sm' ? 'h-1.5' : 'h-1'
  );
</script>

<div class="flex w-full items-center gap-2">
  <div
    class="relative w-full overflow-hidden rounded-full bg-slate-100 {trackHeightClass}"
    style="box-shadow: inset 0 1px 1px rgba(15, 23, 42, 0.06);"
    role="progressbar"
    aria-valuenow={clamped}
    aria-valuemin={0}
    aria-valuemax={100}
    aria-label={ariaLabel}
  >
    <div
      class="h-full rounded-full transition-[width,background-color] duration-300 ease-out"
      style="
        width: {clamped}%;
        background-color: {fillColor};
        background-image: linear-gradient(180deg, rgba(255,255,255,0.18) 0%, rgba(0,0,0,0.06) 100%);
      "
    ></div>
    {#each ticks as tickPct (tickPct)}
      {#if tickPct > 0 && tickPct < 100}
        <span
          class="pointer-events-none absolute top-0 bottom-0 w-px bg-slate-300/70"
          style="left: {tickPct}%;"
          aria-hidden="true"
        ></span>
      {/if}
    {/each}
  </div>
  {#if showLabel}
    <span
      class="shrink-0 text-[10px] font-semibold tabular-nums text-slate-600"
      style="min-width: 2.25rem; text-align: right;"
    >
      {clamped}%
    </span>
  {/if}
</div>
