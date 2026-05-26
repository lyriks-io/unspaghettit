import type { RenameTagInput, RenameTagResult } from '$features/tag-palette/application/use-cases/RenameTag';

/**
 * Cross-aggregate tag operations exposed to the presentation layer. The
 * client-side adapter forwards to a single HTTP endpoint; a server-side
 * adapter can wire the same shape onto the use case directly when called
 * from in-process code (e.g. tests). Keeping this as its own port lets the
 * UI stay ignorant of whether the rename fans out across many entities or
 * happens in one network round trip.
 */
export interface TagOperations {
  renameTag(input: RenameTagInput): Promise<RenameTagResult>;
}
