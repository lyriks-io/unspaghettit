/**
 * How a tour step decides it's done so the engine can move to the next.
 *
 *   - `manual`: the user clicks Next in the side panel. Used for the
 *     narrative framing steps that don't ask the user to do anything.
 *   - `click`: the user clicks an element matching `selector`. Captured
 *     at document level by the overlay so it works regardless of which
 *     handler the page itself wires.
 *   - `event`: a spec event flows through the in-process event bus
 *     (e.g. `feature.created`). The optional `match` lets a step refuse
 *     to advance unless the payload also matches — that's how the
 *     tutorial enforces a specific name without owning the form.
 *
 * Discriminated union: `kind` is the discriminator.
 */
export type TourTrigger =
  | { readonly kind: 'manual' }
  | { readonly kind: 'click'; readonly selector: string }
  | {
      readonly kind: 'event';
      readonly event: string;
      readonly match?: (payload: Record<string, unknown> | undefined) => boolean;
    };
