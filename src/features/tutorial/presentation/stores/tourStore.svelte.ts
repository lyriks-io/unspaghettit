import type { TourDefinition } from '$features/tutorial/domain/entities/TourDefinition';
import type { TourStep } from '$features/tutorial/domain/entities/TourStep';
import type { SpecEventBus } from '$features/tutorial/application/ports/SpecEventBus';
import { SharedSpecEventBusAdapter } from '$features/tutorial/infrastructure/adapters/SharedSpecEventBusAdapter';
import { onboardingStore } from './onboardingStore.svelte';

/**
 * Reactive runtime for a single-at-a-time tour.
 *
 * Responsibilities (and only these):
 *   - Holds the active TourDefinition and the index of the current step.
 *   - Subscribes to spec events from the application-level `SpecEventBus`
 *     port and advances the step when a step's `event` trigger matches.
 *   - Exposes `start / next / cancel / complete` as the public API.
 *
 * Out of scope (intentionally elsewhere):
 *   - DOM: target tracking, prefill, click capture, spotlight positioning
 *     all live in dedicated `.svelte.ts` adapters under `presentation/adapters`.
 *   - Bus transport: how a `feature.created` event physically arrives is
 *     the adapter's problem (see `SharedSpecEventBusAdapter`). The store
 *     only knows the port shape.
 *
 * Constructor accepts the port so unit tests can inject a fake bus and
 * drive the engine without touching the shared in-process bus.
 */
class TourStore {
  tour = $state<TourDefinition | null>(null);
  stepIndex = $state<number>(0);

  private eventUnsubscribe: (() => void) | null = null;

  constructor(private readonly events: SpecEventBus) {}

  get currentStep(): TourStep | null {
    if (!this.tour) return null;
    return this.tour.steps[this.stepIndex] ?? null;
  }

  get isActive(): boolean {
    return this.tour !== null;
  }

  get totalSteps(): number {
    return this.tour?.steps.length ?? 0;
  }

  start(tour: TourDefinition): void {
    this.tour = tour;
    this.stepIndex = 0;
    this.rewireEventTrigger();
  }

  next(): void {
    if (!this.tour) return;
    const lastIndex = this.tour.steps.length - 1;
    if (this.stepIndex >= lastIndex) {
      this.complete();
      return;
    }
    this.stepIndex += 1;
    this.rewireEventTrigger();
  }

  /**
   * Step back one position, clamped at the welcome step. Called by the
   * overlay when the active step's target disappeared after being found
   * (typically because the user cancelled a dialog that contained the
   * target). Rewires event subscriptions so the previous step's
   * trigger is live again.
   */
  previous(): void {
    if (!this.tour || this.stepIndex <= 0) return;
    this.stepIndex -= 1;
    this.rewireEventTrigger();
  }

  cancel(): void {
    this.teardown();
  }

  complete(): void {
    // Reaching the end of a tour permanently retires the getting-started
    // banner; exiting mid-way (cancel) leaves it up so the tour can be
    // retried from anywhere.
    onboardingStore.markCompleted();
    this.teardown();
  }

  private teardown(): void {
    this.eventUnsubscribe?.();
    this.eventUnsubscribe = null;
    this.tour = null;
    this.stepIndex = 0;
  }

  /**
   * Each step may want to advance on a spec event. We listen only while
   * the step that wants it is active, so an earlier step's event can't
   * leak into a later step's advance.
   */
  private rewireEventTrigger(): void {
    this.eventUnsubscribe?.();
    this.eventUnsubscribe = null;

    const step = this.currentStep;
    if (!step || step.advance.kind !== 'event') return;

    const wanted = step.advance.event;
    const matcher = step.advance.match;
    this.eventUnsubscribe = this.events.subscribe((evt) => {
      if (evt.name !== wanted) return;
      if (matcher && !matcher(evt.payload)) return;
      this.next();
    });
  }
}

/**
 * Singleton instance wired to the shared in-process event bus.
 * Components import this and never the class - keeps the store's
 * dependencies pinned in one place.
 */
export const tourStore = new TourStore(new SharedSpecEventBusAdapter());
