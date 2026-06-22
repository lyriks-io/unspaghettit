import type { BehavioralIndexReader } from '../../application/ports/BehavioralIndexReader';
import type { IndexedImplementation } from '../../domain/IndexedImplementation';

/**
 * A reader over an already-loaded set of entries. Used by the MCP server, which
 * holds the parsed `.unspa.json` link in memory, and by tests that supply a
 * literal index — neither needs to touch the filesystem.
 */
export const staticBehavioralIndexReader = (
  entries: readonly IndexedImplementation[]
): BehavioralIndexReader => ({
  async read(): Promise<readonly IndexedImplementation[]> {
    return entries;
  }
});
