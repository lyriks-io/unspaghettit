/**
 * Svelte action: size the element to fill the viewport below its own document
 * position, desktop (lg) only.
 *
 * Fixed-height pages (the graph pages) used to hard-code
 * `calc(100dvh - header)`, which leaves a window scrollbar the moment anything
 * else renders above the element: the getting-started banner, a future notice
 * strip, a taller header. Measuring the element's real offset instead makes
 * the page always end exactly at the viewport's bottom edge.
 *
 * Re-measures when the body's layout changes (banner appears or is
 * dismissed), on window resize, and when crossing the lg breakpoint (below
 * it the height is released so the page scrolls normally).
 */
export const fillViewportHeight = (node: HTMLElement): { destroy(): void } => {
  const media = window.matchMedia('(min-width: 1024px)');

  const apply = (): void => {
    if (!media.matches) {
      node.style.height = '';
      return;
    }
    const top = Math.max(0, Math.round(node.getBoundingClientRect().top + window.scrollY));
    node.style.height = `calc(100dvh - ${top}px)`;
  };

  apply();
  // Body layout shifts (e.g. the onboarding banner mounting after hydration or
  // being dismissed) move the element's offset without a window resize.
  const observer = new ResizeObserver(apply);
  observer.observe(document.body);
  window.addEventListener('resize', apply);
  media.addEventListener('change', apply);

  return {
    destroy(): void {
      observer.disconnect();
      window.removeEventListener('resize', apply);
      media.removeEventListener('change', apply);
    }
  };
};
