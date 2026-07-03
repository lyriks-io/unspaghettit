/**
 * The neutral, format-independent intermediate representation the digest
 * projector emits and every renderer / exporter consumes. `buildDigest` turns a
 * scope of the behavior model into a `DigestSpec`; the dashboard panel draws it;
 * the Markdown exporter serializes it. Same seam as `DiagramSpec`, but the
 * target is plain-language prose instead of nodes and edges.
 *
 * Pure data, no IO. Every line carries the id of the model element it was
 * derived from, so a reader can click a sentence and reveal that element.
 */

/** Which slice of the model a digest summarizes. */
export type DigestScope = 'project' | 'feature' | 'surface' | 'action';

/**
 * How much the summary says. A projector parameter that gates which sections
 * and how much per line, never a separate code path:
 *   - `glance`:   the purpose plus a single line naming what you can do.
 *   - `standard`: one line per action (name, intent, guards) plus guardrails.
 *   - `full`:     the above plus each action's effects and events, plus
 *                 the navigation paths out of the scope.
 */
export type DigestDetailLevel = 'glance' | 'standard' | 'full';

export type DigestSectionKind = 'features' | 'capabilities' | 'guardrails' | 'navigation';

/** The kind of model element a line was derived from, for click-to-reveal. */
export type DigestSourceElementType =
  | 'feature'
  | 'surface'
  | 'action'
  | 'invariant'
  | 'transition';

export type DigestLine = {
  /** An emphasized lead, e.g. an action or invariant name. Optional. */
  readonly label?: string;
  /** The plain-language sentence shown to the reader. */
  readonly text: string;
  /**
   * Sub-facts belonging to this line, each a short phrase (an effect, an emitted
   * event, a guard). Rendered as a nested list, never concatenated into `text`,
   * so a capability's effects and guards read as bullets instead of a run-on.
   */
  readonly details?: readonly string[];
  /** The id of the model element this line came from, for reveal / jump. */
  readonly sourceElementId?: string;
  readonly sourceElementType?: DigestSourceElementType;
  /** The feature the element lives in, so a jump can open the right editor. */
  readonly sourceFeatureId?: string;
  /** The enclosing surface, so a jump can open the right surface + panel. */
  readonly sourceSurfaceId?: string;
};

export type DigestSection = {
  readonly kind: DigestSectionKind;
  readonly heading: string;
  readonly lines: readonly DigestLine[];
};

export type DigestSpec = {
  readonly scope: DigestScope;
  readonly detailLevel: DigestDetailLevel;
  /** The name of the summarized feature, surface, or action. */
  readonly title: string;
  /** One-sentence statement of what this scope is for. May be empty. */
  readonly purposeLine: string;
  readonly sections: readonly DigestSection[];
};

/** Total number of plain-language lines across every section. */
export const digestLineCount = (spec: DigestSpec): number =>
  spec.sections.reduce((sum, section) => sum + section.lines.length, 0);

/**
 * Whether the digest carries anything worth reading. The purpose line alone
 * does not count: a scope with a description but no actions, guardrails, or
 * navigation is "empty" and mirrors the feature spec's `digest.hasContent`
 * rule (a scope with no behavior generates but has no content).
 */
export const digestHasContent = (spec: DigestSpec): boolean => digestLineCount(spec) > 0;
