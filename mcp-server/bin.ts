#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { JsonFolderFeatureRepository } from '../src/features/behavior-model/infrastructure/persistence/JsonFolderFeatureRepository';
import { discoverSnapshotDirectory } from '../src/features/behavior-model/infrastructure/persistence/snapshot-discovery';
import { JsonFolderImplementationStatusRepository } from '../src/features/implementation-status/infrastructure/persistence/JsonFolderImplementationStatusRepository';
import { JsonFolderProvenanceRepository } from '../src/features/source-provenance/infrastructure/persistence/JsonFolderProvenanceRepository';
import { JsonFolderProjectSourceRepository } from '../src/features/source-provenance/infrastructure/persistence/JsonFolderProjectSourceRepository';
import { migrateEmbeddedSourceDocsAndLog } from '../src/features/source-provenance/infrastructure/persistence/migrateEmbeddedSourceDocs';
import { JsonFolderProjectRepository } from '../src/features/projects/infrastructure/persistence/JsonFolderProjectRepository';
import { migrateFlatLayoutAndLog } from '../src/shared/infrastructure/persistence/snapshotLayout';
import { discoverRepoLink } from './repo-link';
import { buildServer } from './server';
import {
  SyncAwareFeatureRepository,
  SyncAwareImplementationStatusRepository,
  SyncAwareProjectRepository
} from './sync-aware-repos';

const parseArgs = (argv: readonly string[]): { override?: string; link?: string } => {
  const out: { override?: string; link?: string } = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--snapshots' || arg === '-s') {
      const next = argv[i + 1];
      if (!next) throw new Error('--snapshots requires a directory path');
      out.override = next;
      i += 1;
      continue;
    }
    if (arg && arg.startsWith('--snapshots=')) {
      out.override = arg.slice('--snapshots='.length);
      continue;
    }
    if (arg === '--link' || arg === '-l') {
      const next = argv[i + 1];
      if (!next) throw new Error('--link requires a path to .unspa.json or its parent folder');
      out.link = next;
      i += 1;
      continue;
    }
    if (arg && arg.startsWith('--link=')) {
      out.link = arg.slice('--link='.length);
      continue;
    }
  }
  return out;
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  const override = args.override ?? process.env.UNSPA_SNAPSHOTS;
  const { directory, source } = discoverSnapshotDirectory({ override });
  const linkOverride = args.link ?? process.env.UNSPA_LINK;

  // Snapshot the link state once for the startup banner; the live repoContext
  // below re-resolves on every property access, so subsequent `unspa link` /
  // file edits are picked up without restarting the MCP server.
  const initialLink = discoverRepoLink(process.cwd(), linkOverride);

  // Diagnostics go to stderr. Stdout is reserved for the JSON-RPC stream.
  process.stderr.write(`[unspa-mcp] snapshots: ${directory} (${source})\n`);
  migrateFlatLayoutAndLog(directory, 'unspa-mcp');
  migrateEmbeddedSourceDocsAndLog(directory, 'unspa-mcp');
  if (initialLink.link) {
    process.stderr.write(
      `[unspa-mcp] repo linked to project: ${initialLink.link.projectName ?? '(unknown)'} (${initialLink.link.projectId})\n`
    );
  }

  const repo = new SyncAwareFeatureRepository(new JsonFolderFeatureRepository(directory));
  const statusRepo = new SyncAwareImplementationStatusRepository(
    new JsonFolderImplementationStatusRepository(directory)
  );
  const projectRepo = new SyncAwareProjectRepository(new JsonFolderProjectRepository(directory));
  // Provenance sidecars and source documents are read fresh from disk by the
  // dashboard on each fetch, so they don't need the Yjs live-broadcast
  // wrapper the others use.
  const provenanceRepo = new JsonFolderProvenanceRepository(directory);
  const sourceRepo = new JsonFolderProjectSourceRepository(directory);

  // Live `.unspa.json` lookup. Tools read `repoContext.link` / `.linkPath`
  // on every invocation, so if the developer runs `unspa link` while the AI
  // client is connected the next tool call sees the new state — no restart
  // required. Per-access stat walk is a few microseconds; cheap enough that
  // we don't memoize.
  const cwd = process.cwd();
  const repoContext = {
    get cwd() {
      return cwd;
    },
    get link() {
      return discoverRepoLink(cwd, linkOverride).link;
    },
    get linkPath() {
      return discoverRepoLink(cwd, linkOverride).path;
    }
  };

  const server = buildServer(repo, {
    statusRepo,
    provenanceRepo,
    sourceRepo,
    projectRepo,
    repoContext
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
};

main().catch((err) => {
  process.stderr.write(`[unspa-mcp] fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
