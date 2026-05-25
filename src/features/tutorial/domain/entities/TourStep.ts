import type { TourPrefill } from '../value-objects/TourPrefill';
import type { TourRequireExact } from '../value-objects/TourRequireExact';
import type { TourRoute } from '../value-objects/TourRoute';
import type { TourTrigger } from '../value-objects/TourTrigger';

/**
 * One step in a guided tour. Composed of:
 *   - identity + copy (`id`, `title`, `body`)
 *   - optional spatial cues (`target`, `route`) the overlay uses to
 *     position the spotlight and prompt the user toward the right page
 *   - optional form-side affordances (`prefill`, `requireExact`) that
 *     remove tedious typing and prevent off-script names
 *   - exactly one `advance` trigger declaring how the engine knows the
 *     step is done
 *
 * No methods — entities here are data + invariants enforced at the
 * boundaries (tour validation when authoring, predicate checks at
 * runtime). Behavior lives in the domain services / application use
 * cases that operate on this shape.
 */
export type TourStep = {
  readonly id: string;
  readonly title: string;
  /** Short body shown in the side panel. Plain text; no HTML. */
  readonly body: string;
  /**
   * CSS selector for the element to spotlight. When omitted the panel
   * sits on its own and the screen is dimmed — used for the opening
   * "welcome" step and the closing "you're done" step.
   */
  readonly target?: string;
  readonly route?: TourRoute;
  readonly prefill?: readonly TourPrefill[];
  readonly requireExact?: TourRequireExact;
  /**
   * Optional CSS selector for an input the overlay should focus when
   * this step becomes active. Saves the user a click — the input they
   * need to type into is ready to receive keystrokes.
   */
  readonly focusSelector?: string;
  /**
   * When true, body scrolling is locked while this step is active.
   * Used for the closing "you're done" step so the user can't scroll
   * around the page and miss the final spotlight.
   */
  readonly lockScroll?: boolean;
  /**
   * Optional pure predicate the engine calls to decide whether the
   * "Next" button is enabled on a `manual` step. When omitted, Next is
   * always enabled on manual steps. Use for "the user must have done
   * the form work" steps so they can't skip past without actually
   * completing the action. Predicate runs reactively — keep it cheap.
   */
  readonly canAdvance?: () => boolean;
  /**
   * Where to dock the side panel on screen.
   *   - `bottom-right` (default): pinned to the bottom-right corner.
   *   - `avoid-target`: bottom-right normally, but flips to bottom-LEFT
   *     when the target is in the right half of the viewport. Used for
   *     simulator steps where the panel would otherwise overlap the
   *     side rail the user is reading.
   *   - `below-target`: positioned directly below the highlighted
   *     element (centered on it), with a fallback to bottom-right when
   *     placing below would overflow the viewport. Used for narration
   *     steps where the panel should explicitly relate to the thing
   *     it's pointing at.
   */
  readonly panelPosition?: 'bottom-right' | 'avoid-target' | 'below-target';
  readonly advance: TourTrigger;
};
