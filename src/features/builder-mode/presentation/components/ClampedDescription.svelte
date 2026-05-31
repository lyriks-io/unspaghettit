<script lang="ts">
  let {
    text,
    class: className = ''
  }: {
    readonly text: string;
    readonly class?: string;
  } = $props();

  let expanded = $state(false);
  let overflowing = $state(false);
  let animating = $state(false);
  let el = $state<HTMLParagraphElement | null>(null);

  // Open feels expansive (easeOutExpo — fast then a long, soft settle); close
  // is a touch quicker and symmetric (easeInOutCubic). The values are tuned to
  // read as one physical motion rather than a linear height tween.
  const OPEN = '560ms cubic-bezier(0.16, 1, 0.3, 1)';
  const CLOSE = '440ms cubic-bezier(0.65, 0, 0.35, 1)';
  const SOFT_EDGE = 'linear-gradient(to bottom, #000 calc(100% - 1.3em), transparent)';

  const prefersReducedMotion = (): boolean =>
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const clampedHeight = (node: HTMLElement): number => {
    const lineHeight = parseFloat(getComputedStyle(node).lineHeight) || 20;
    return lineHeight * 2;
  };

  // Cancels the in-flight animation's transitionend listener so a mid-flight
  // re-toggle doesn't get its cleanup stomped by the previous run.
  let cancelPending: (() => void) | null = null;

  // Reveal only carries a toggle when the clamped text actually overflows.
  // While clamped, scrollHeight (full content) exceeds clientHeight (2 lines).
  // Re-measured on text changes and width changes (the columns resize).
  $effect(() => {
    const node = el;
    if (!node) return;
    void text;
    const measure = () => {
      if (expanded || animating) return; // clientHeight === scrollHeight once open
      overflowing = node.scrollHeight > node.clientHeight + 1;
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  });

  function toggle(): void {
    const node = el;
    if (!node) return;
    if (expanded) collapse(node);
    else expand(node);
  }

  /**
   * Run `max-height` from `startPx` to `endPx` with `timing`. The caller must
   * already have the clamp in the right state; we pin the start height (no
   * transition), commit it, then transition to the end. Starting from a caller-
   * supplied height — captured BEFORE any clamp change — is what makes both
   * directions animate, and makes mid-flight re-toggles reverse seamlessly.
   */
  function animateHeight(
    node: HTMLElement,
    startPx: number,
    endPx: number,
    timing: string,
    onDone: () => void
  ): void {
    cancelPending?.();
    animating = true;
    node.style.overflow = 'hidden';
    node.style.webkitMaskImage = SOFT_EDGE;
    node.style.maskImage = SOFT_EDGE;
    node.style.transition = 'none';
    node.style.maxHeight = `${startPx}px`;
    void node.offsetHeight; // commit the start frame before transitioning
    node.style.transition = `max-height ${timing}`;
    node.style.maxHeight = `${endPx}px`;

    const done = (event: TransitionEvent) => {
      if (event.propertyName !== 'max-height') return;
      node.removeEventListener('transitionend', done);
      cancelPending = null;
      animating = false;
      onDone();
    };
    node.addEventListener('transitionend', done);
    cancelPending = () => node.removeEventListener('transitionend', done);
  }

  function expand(node: HTMLElement): void {
    // Capture the clamped (2-line) height BEFORE unclamping — otherwise the
    // element is already at full height and start === end (the instant-open bug).
    const startPx = node.clientHeight;
    expanded = true;
    // Drop the line-clamp so content can exceed two lines; the pinned start
    // height keeps it visually at two lines until the transition takes over.
    node.classList.remove('clamp-2');
    if (prefersReducedMotion()) return;
    void node.offsetHeight; // let scrollHeight reflect the now-unclamped content
    animateHeight(node, startPx, node.scrollHeight, OPEN, () => {
      // Fully open: release every constraint so later reflow can't clip it.
      node.style.transition = '';
      node.style.maxHeight = 'none';
      node.style.overflow = '';
      node.style.webkitMaskImage = '';
      node.style.maskImage = '';
    });
  }

  function collapse(node: HTMLElement): void {
    const startPx = node.clientHeight; // current (expanded / mid-animation) height
    expanded = false;
    if (prefersReducedMotion()) {
      node.classList.add('clamp-2');
      node.style.maxHeight = '';
      return;
    }
    animateHeight(node, startPx, clampedHeight(node), CLOSE, () => {
      // Restore the resting clamp (with its ellipsis) and drop inline overrides.
      node.classList.add('clamp-2');
      node.style.transition = '';
      node.style.maxHeight = '';
      node.style.overflow = '';
      node.style.webkitMaskImage = '';
      node.style.maskImage = '';
    });
  }
</script>

<div class={className}>
  <p bind:this={el} class="clamp-2 text-sm leading-5 text-slate-400">{text}</p>
  {#if overflowing || expanded || animating}
    <button
      type="button"
      class="relative z-20 mt-1 inline-flex items-center gap-1 text-xs font-semibold text-brand-400 transition hover:text-brand-300"
      onclick={toggle}
      aria-expanded={expanded}
    >
      <span>{expanded ? 'View less' : 'View more'}</span>
      <svg
        viewBox="0 0 16 16"
        class="h-3 w-3 transition-transform duration-500 ease-out {expanded ? 'rotate-180' : ''}"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        aria-hidden="true"
      >
        <path d="M4 6l4 4 4-4" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>
  {/if}
</div>

<style>
  /*
   * Resting two-line clamp with ellipsis. Toggled imperatively (not via a
   * reactive class) because the open/close animation needs the clamp gone for
   * the exact frame it swaps to a max-height transition — line-clamp itself
   * can't be animated, and a deferred reactive update would race the freeze
   * frame. Kept in the markup's initial class so the scoped rule isn't pruned.
   */
  .clamp-2 {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
  }
</style>
