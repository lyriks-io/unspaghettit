/**
 * One declared CORE FEATURE in a project's registry: a curated product pillar
 * that member features are grouped under (e.g. "Authentication", "Billing").
 * This is the controlled vocabulary that keeps core-feature tags precise: a
 * feature joins a core feature by carrying a reserved `core:<value>` tag (see
 * CORE_TAG_TYPE), and that tag only "counts" when its value matches a declared
 * entry here. Declaring the set once, at the project level, is the difference
 * between a filterable group of features and a sea of free-form tags.
 *
 * `value` is the tag value / group key, normalized lowercase like every tag.
 * `description` is mandatory, like every authored element.
 */
export type CoreFeature = {
  readonly value: string;
  readonly description: string;
};
