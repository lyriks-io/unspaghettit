import type { TourPrefill } from '../../domain/value-objects/TourPrefill';

/**
 * Adapter responsible for seeding form inputs the tour step nominates.
 *
 * Why writing `.value` isn't enough: Svelte's `bind:value` listens on
 * `input` events, not on property assignment. Setting `el.value = x`
 * leaves the framework's mirrored `$state` out of sync — the input
 * looks filled in the DOM, but the form submits an empty string. The
 * canonical fix is the native setter from the prototype, followed by
 * a synthetic `input` event so every binding library on the page sees
 * the change.
 *
 * `seedPending` returns a list of items it couldn't apply (selector
 * found nothing, or the input was already non-empty). Callers poll
 * with this until the pending set is empty, so a still-mounting modal
 * doesn't miss its prefill.
 */
export type PrefillItem = TourPrefill;

const setNativeValue = (
  el: HTMLInputElement | HTMLTextAreaElement,
  value: string
): void => {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
};

/**
 * Apply each pending prefill if its target input is present and empty.
 * Returns the items still pending — caller should retry on the next
 * animation frame (or DOM mutation) until the set is empty.
 */
export const seedPending = (items: readonly PrefillItem[]): PrefillItem[] => {
  const remaining: PrefillItem[] = [];
  for (const item of items) {
    const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      item.selector
    );
    if (!el) {
      remaining.push(item);
      continue;
    }
    if (el.value.length === 0) setNativeValue(el, item.value);
    // Don't keep retrying if the user already started typing — we
    // never want to clobber their input.
  }
  return remaining;
};
