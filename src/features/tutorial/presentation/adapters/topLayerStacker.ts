/**
 * Adapter for keeping a `[popover="manual"]` element (the tour panel)
 * above any `<dialog>[open]` that opens later in the page.
 *
 * Browsers maintain a "top layer" for popovers and dialogs that sits
 * above every regular DOM node regardless of z-index. Elements stack
 * inside the top layer in open-order — last-opened wins. So when the
 * app opens a modal `<dialog>` (LibraryDialog, AppDialog, etc) AFTER
 * our tour panel showed, the modal lands on top, with our panel
 * dimmed and blurred behind its `::backdrop`.
 *
 * Solution: watch the DOM for any other `<dialog>` gaining the `open`
 * attribute, and when one does, hide+show our popover to bump it
 * back to the top of the top-layer stack.
 *
 * Loop trap: our own re-show also propagates DOM mutations. If we
 * re-react to them, the observer fires infinitely (microtask storm,
 * browser tab effectively frozen). We dedupe by remembering each
 * other dialog we've already restacked above; only a NEW open
 * triggers another bump.
 */
export type TopLayerStacker = {
  dispose(): void;
};

export const createTopLayerStacker = (panel: HTMLElement): TopLayerStacker => {
  const seen = new WeakSet<HTMLDialogElement>();

  const bumpToTop = (): void => {
    // Hiding then showing a manual popover re-adds it to the top of
    // the top-layer stack. Safe to call when not currently showing
    // (hidePopover is a no-op on a closed popover).
    if (panel.matches(':popover-open')) {
      panel.hidePopover();
    }
    panel.showPopover();
  };

  const observer = new MutationObserver((mutations) => {
    if (!panel.matches(':popover-open')) return;
    let needsRestack = false;
    for (const m of mutations) {
      if (m.type !== 'attributes' || m.attributeName !== 'open') continue;
      const el = m.target;
      if (!(el instanceof HTMLDialogElement)) continue;
      if (el.hasAttribute('open')) {
        if (!seen.has(el)) {
          seen.add(el);
          needsRestack = true;
        }
      } else {
        seen.delete(el);
      }
    }
    if (needsRestack) bumpToTop();
  });

  observer.observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ['open']
  });

  return {
    dispose() {
      observer.disconnect();
    }
  };
};
