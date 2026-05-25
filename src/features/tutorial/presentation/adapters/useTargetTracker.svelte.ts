/**
 * Live tracker for a tour step's target element. Resolves a CSS
 * selector to a current HTMLElement and keeps an up-to-date `DOMRect`
 * available reactively, so the spotlight component can position itself
 * by reading state instead of running its own DOM observers.
 *
 * Two reasons it isn't a one-shot `querySelector`:
 *   - SvelteKit panels routinely mount, unmount (during an async data
 *     fetch's loading state), and remount with a brand-new DOM node for
 *     the same logical element. Holding a stale reference and calling
 *     `getBoundingClientRect()` on a detached node gives `0x0` at (0,0)
 *     — the classic "stuck top-left spotlight" symptom.
 *   - The target's rect changes with every scroll, resize, content
 *     reflow. We coalesce updates via rAF so we get frame-rate-accurate
 *     tracking without thrashing layout.
 *
 * Returned API exposes `element` and `rect` as plain getters backed by
 * `$state`, so callers can use them directly in `$derived` expressions
 * without re-engineering the reactivity graph.
 */
export type TargetTracker = {
  readonly element: HTMLElement | null;
  readonly rect: DOMRect | null;
  /** Tear down all observers and listeners. Idempotent. */
  dispose(): void;
};

export const createTargetTracker = (selector: string | null): TargetTracker => {
  let element = $state<HTMLElement | null>(null);
  let rect = $state<DOMRect | null>(null);

  if (!selector) {
    return {
      get element() {
        return element;
      },
      get rect() {
        return rect;
      },
      dispose() {}
    };
  }

  // Holding the "last seen" reference outside reactive state keeps the
  // mutation observer's resolve() free of self-fire loops (reading the
  // reactive state from within a callback that writes to it would
  // make this effect depend on its own writes).
  let cachedEl: HTMLElement | null = null;

  const setRect = (el: HTMLElement | null): void => {
    rect = el ? el.getBoundingClientRect() : null;
  };

  const resolve = (): void => {
    const found = document.querySelector<HTMLElement>(selector);
    if (found !== cachedEl) {
      cachedEl = found;
      element = found;
    }
    setRect(found);
  };

  // Initial pass + ongoing DOM watch. We never disconnect the observer
  // until dispose() so panel remounts that recreate the target produce
  // a fresh reference, not a stale one.
  resolve();
  const childObserver = new MutationObserver(resolve);
  childObserver.observe(document.body, { childList: true, subtree: true });

  // Scroll / resize / intrinsic-size changes only need the rect
  // refreshed, not the element re-resolved. rAF coalesces multiple
  // events fired in one frame into one rect read.
  let rafId = 0;
  const scheduleRectUpdate = (): void => {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      if (cachedEl) setRect(cachedEl);
    });
  };
  const resizeObserver = new ResizeObserver(scheduleRectUpdate);
  if (cachedEl) resizeObserver.observe(cachedEl);
  // Whenever the element identity changes we also need to swap which
  // node ResizeObserver watches.
  const elementSwapObserver = new MutationObserver(() => {
    resizeObserver.disconnect();
    if (cachedEl) resizeObserver.observe(cachedEl);
  });
  // We re-observe via the same body-wide childObserver — easier than
  // wiring a second observer specifically for "element identity
  // changed". The cost is one extra ResizeObserver swap per DOM change
  // that affects our tree, which is negligible.
  elementSwapObserver.observe(document.body, { childList: true, subtree: true });

  const onScroll = (): void => scheduleRectUpdate();
  const onResize = (): void => scheduleRectUpdate();
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', onResize);

  return {
    get element() {
      return element;
    },
    get rect() {
      return rect;
    },
    dispose() {
      if (rafId) cancelAnimationFrame(rafId);
      childObserver.disconnect();
      elementSwapObserver.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    }
  };
};
