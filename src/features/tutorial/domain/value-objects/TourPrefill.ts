/**
 * A single input the tour engine should seed when its owning step
 * becomes active. The user can still edit it afterward; this just
 * removes tedious boilerplate (descriptions) so the user can focus on
 * the meaningful field (the name).
 *
 * `selector` is a CSS selector — conventionally a `data-tour="..."`
 * attribute on the input — so the tour layer never depends on Tailwind
 * class strings or DOM structure that may churn.
 */
export type TourPrefill = {
  readonly selector: string;
  readonly value: string;
};
