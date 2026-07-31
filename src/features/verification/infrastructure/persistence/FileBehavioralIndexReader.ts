import { existsSync, readFileSync } from 'node:fs';
import { join, parse, resolve } from 'node:path';
import type { BehavioralIndexReader } from '../../application/ports/BehavioralIndexReader';
import type {
  IndexedImplementation,
  IndexedImplementationStatus
} from '../../domain/IndexedImplementation';

const LINK_FILENAME = '.unspa.json';
const VALID_STATUS = new Set<IndexedImplementationStatus>(['implemented', 'partial', 'missing']);

export type RawIndexEntry = {
  readonly status?: string;
  readonly specVersion?: string;
  readonly verifiedAt?: string;
};
type RawLink = { readonly index?: Record<string, RawIndexEntry> };

/**
 * Map the persisted `.unspa.json` index onto the domain's
 * {@link IndexedImplementation}, dropping the fields drift doesn't need. Shared
 * with the inline reader so an index handed over by a host maps identically to
 * one read off disk — a divergence here would make drift depend on transport.
 */
export const toIndexedImplementations = (
  index: Record<string, RawIndexEntry>
): readonly IndexedImplementation[] =>
  Object.entries(index).map(([key, raw]) => {
    const status: IndexedImplementationStatus =
      raw?.status && VALID_STATUS.has(raw.status as IndexedImplementationStatus)
        ? (raw.status as IndexedImplementationStatus)
        : 'missing';
    return {
      key,
      status,
      ...(typeof raw?.specVersion === 'string' ? { auditedSpecVersion: raw.specVersion } : {}),
      ...(typeof raw?.verifiedAt === 'string' ? { verifiedAt: raw.verifiedAt } : {})
    };
  });

/** Walk up from `cwd` to the nearest `.unspa.json`, mirroring the MCP/CLI link discovery. */
const discover = (cwd: string): string | null => {
  let current = resolve(cwd);
  const { root } = parse(current);
  for (;;) {
    const candidate = join(current, LINK_FILENAME);
    if (existsSync(candidate)) return candidate;
    if (current === root) break;
    const parent = resolve(current, '..');
    if (parent === current) break;
    current = parent;
  }
  return null;
};

export type FileBehavioralIndexReaderOptions = {
  /** Explicit path to a `.unspa.json` (file, or a directory containing one). When omitted, walks up from `cwd`. */
  readonly path?: string;
  readonly cwd?: string;
};

/**
 * Reads the audited entries out of a repo's `.unspa.json`. A missing or
 * malformed file is treated as "no index" (empty), never an error — a repo that
 * has never run an implementation audit should still verify cleanly. Maps the
 * on-disk entry onto the domain's {@link IndexedImplementation}, dropping the
 * fields drift doesn't need.
 */
export const fileBehavioralIndexReader = (
  options: FileBehavioralIndexReaderOptions = {}
): BehavioralIndexReader => ({
  async read(): Promise<readonly IndexedImplementation[]> {
    const cwd = options.cwd ?? process.cwd();
    const explicit = options.path
      ? options.path.endsWith(LINK_FILENAME)
        ? options.path
        : join(options.path, LINK_FILENAME)
      : null;
    const filePath = explicit ?? discover(cwd);
    if (!filePath || !existsSync(filePath)) return [];

    let link: RawLink;
    try {
      link = JSON.parse(readFileSync(filePath, 'utf8')) as RawLink;
    } catch {
      return [];
    }

    return toIndexedImplementations(link.index ?? {});
  }
});
