import type { BehavioralIndexReader } from '../../application/ports/BehavioralIndexReader';
import type { IndexedImplementation } from '../../domain/IndexedImplementation';
import { toIndexedImplementations, type RawIndexEntry } from './FileBehavioralIndexReader';

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

/**
 * A reader over a raw index map a caller handed us — the same object shape that
 * lives under `index` in `.unspa.json`, but supplied inline. This is the path
 * for a host that runs this server without access to the checkout: it holds the
 * index file, we hold the spec, and drift still resolves.
 */
export const inlineBehavioralIndexReader = (
  index: Record<string, RawIndexEntry>
): BehavioralIndexReader => staticBehavioralIndexReader(toIndexedImplementations(index));
