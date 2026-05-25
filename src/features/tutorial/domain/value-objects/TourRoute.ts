/**
 * The route a tour step expects the user to be on before its target is
 * resolvable. The overlay shows a "Go to {label}" CTA in the side panel
 * until `pathname` matches — this is how a cross-page tour bridges a
 * navigation without losing the user partway through.
 */
export type TourRoute = {
  readonly pathname: string;
  readonly label: string;
};
