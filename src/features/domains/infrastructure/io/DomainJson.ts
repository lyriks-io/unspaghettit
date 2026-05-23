import type { ProjectId } from '$features/projects/domain/value-objects/ids';
import type { Domain } from '$features/domains/domain/entities/Domain';

const CANONICAL_FORMAT = 'unspaghettit-domain';
const ACCEPTED_FORMATS = new Set<string>([CANONICAL_FORMAT]);

export type DomainExportEnvelope = {
  readonly format: typeof CANONICAL_FORMAT;
  readonly version: 1;
  readonly domain: Domain;
};

export const exportDomainToJson = (domain: Domain): string => {
  const envelope: DomainExportEnvelope = {
    format: CANONICAL_FORMAT,
    version: 1,
    domain
  };
  return JSON.stringify(envelope, null, 2);
};

export const importDomainFromJson = (raw: string): Domain => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON: ${(error as Error).message}`);
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Expected a domain export object');
  }
  const envelope = parsed as Partial<DomainExportEnvelope> & { format?: string };
  if (!envelope.format || !ACCEPTED_FORMATS.has(envelope.format)) {
    throw new Error('Not an Unspaghettit domain export (missing or unrecognized format field)');
  }
  if (envelope.version !== 1) {
    throw new Error(`Unsupported export version: ${envelope.version}`);
  }
  if (!envelope.domain) {
    throw new Error('Export envelope is missing a domain');
  }
  return {
    ...envelope.domain,
    projectIds: (envelope.domain.projectIds ?? []) as readonly ProjectId[]
  };
};
