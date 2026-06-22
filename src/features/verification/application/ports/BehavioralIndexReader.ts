import type { IndexedImplementation } from '../../domain/IndexedImplementation';

/**
 * Driven port: where the audited `.unspa.json` entries come from. The use case
 * depends on this interface, never on a file path or the MCP transport — the
 * CLI provides a file-backed adapter, the MCP server provides one over the
 * link it already holds in memory, and tests provide a literal array.
 */
export interface BehavioralIndexReader {
  /** All audited entries for the targeted project. Empty (not throwing) when there is no index. */
  read(): Promise<readonly IndexedImplementation[]>;
}
