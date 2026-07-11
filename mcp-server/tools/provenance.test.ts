import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { fixedClock } from '../../src/shared/domain/Clock';
import {
  asActionId,
  asFeatureId,
  asSurfaceId
} from '../../src/features/behavior-model/domain/value-objects/ids';
import type { Feature } from '../../src/features/behavior-model/domain/entities/Feature';
import { InMemoryFeatureRepository } from '../../src/features/behavior-model/infrastructure/persistence/InMemoryFeatureRepository';
import { buildServer } from '../server';

/**
 * End-to-end coverage for the Source Provenance tools through the MCP envelope:
 * attach a file, stamp each extracted element with a span, and prove the
 * finalize gate refuses to lock until every element is traced.
 */

let nextId = 0;
const fixedIds = () => `prov-id-${nextId++}`;

// Two extracted elements: one surface + one action.
const tinyFeature: Feature = {
  id: asFeatureId('feat-prov'),
  name: 'Tiny',
  surfaces: [
    {
      id: asSurfaceId('surf-1'),
      name: 'Home',
      type: 'screen',
      stateDefinitions: [],
      actions: [
        {
          id: asActionId('act-1'),
          name: 'Click',
          intent: 'Do a thing.',
          parameters: [],
          requiredStates: [],
          rules: [],
          invariants: [],
          effects: [],
          emittedEvents: [],
          transitions: []
        }
      ],
      rules: [],
      invariants: [],
      transitions: []
    }
  ],
  personas: [],
  resources: [],
  entities: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
};

const rawText = (r: unknown): string => {
  const content = (r as { content?: readonly { type: string; text: string }[] }).content;
  const first = content?.[0];
  if (!first || first.type !== 'text') throw new Error('expected text content');
  return first.text;
};
const parse = <T = Record<string, unknown>>(r: unknown): T => JSON.parse(rawText(r)) as T;
const isErr = (r: unknown): boolean => (r as { isError?: boolean }).isError === true;

const setup = async () => {
  nextId = 0;
  const repo = new InMemoryFeatureRepository();
  await repo.save(tinyFeature);
  const server = buildServer(repo, {
    ids: fixedIds,
    clock: fixedClock('2026-05-09T00:00:00.000Z')
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
};

describe('source provenance tools', () => {
  it('stores a file, records spans, and gates finalize on full tracing', async () => {
    const { client, server } = await setup();

    const attached = parse<{ ok: boolean; elementCount: number; spanCount: number }>(
      await client.callTool({
        name: 'attach_source_file',
        arguments: { featureId: 'feat-prov', fileName: 'home.ts', content: 'AB\nCD' }
      })
    );
    expect(attached.ok).toBe(true);
    expect(attached.elementCount).toBe(2);
    expect(attached.spanCount).toBe(0);

    const span1 = parse<{ ok: boolean; spanCount: number; remaining: number; elementType: string }>(
      await client.callTool({
        name: 'record_element_span',
        arguments: { featureId: 'feat-prov', elementId: 'surf-1', startOffset: 0, endOffset: 2 }
      })
    );
    expect(span1.ok).toBe(true);
    expect(span1.elementType).toBe('surface');
    expect(span1.spanCount).toBe(1);
    expect(span1.remaining).toBe(1);

    // One element still untraced → finalize is blocked.
    const blocked = await client.callTool({
      name: 'finalize_analysis',
      arguments: { featureId: 'feat-prov' }
    });
    expect(isErr(blocked)).toBe(true);
    expect(rawText(blocked)).toMatch(/untraced|no source span/i);

    const span2 = parse<{ ok: boolean; remaining: number }>(
      await client.callTool({
        name: 'record_element_span',
        arguments: { featureId: 'feat-prov', elementId: 'act-1', startOffset: 3, endOffset: 5 }
      })
    );
    expect(span2.ok).toBe(true);
    expect(span2.remaining).toBe(0);

    const finalized = parse<{ ok: boolean; finalized: boolean; spanCount: number }>(
      await client.callTool({ name: 'finalize_analysis', arguments: { featureId: 'feat-prov' } })
    );
    expect(finalized.ok).toBe(true);
    expect(finalized.finalized).toBe(true);
    expect(finalized.spanCount).toBe(2);

    const got = parse<{ finalized: boolean; spanCount: number; untracedCount: number }>(
      await client.callTool({ name: 'get_provenance', arguments: { featureId: 'feat-prov' } })
    );
    expect(got.finalized).toBe(true);
    expect(got.spanCount).toBe(2);
    expect(got.untracedCount).toBe(0);

    await server.close();
  });

  it('blocks recording a span before a source is stored', async () => {
    const { client, server } = await setup();
    const result = await client.callTool({
      name: 'record_element_span',
      arguments: { featureId: 'feat-prov', elementId: 'surf-1', startOffset: 0, endOffset: 2 }
    });
    expect(isErr(result)).toBe(true);
    expect(rawText(result)).toMatch(/no source stored/i);
    await server.close();
  });

  it('stores attaches as deduplicated project sources and reads them back', async () => {
    const { client, server } = await setup();

    const first = parse<{ ok: boolean; sourceId: string; deduped: boolean }>(
      await client.callTool({
        name: 'attach_source_file',
        arguments: { featureId: 'feat-prov', fileName: 'home.ts', content: 'AB\nCD' }
      })
    );
    expect(first.ok).toBe(true);
    expect(first.deduped).toBe(false);

    // Same content again → same source, no duplicate stored.
    const again = parse<{ sourceId: string; deduped: boolean }>(
      await client.callTool({
        name: 'attach_source_file',
        arguments: { featureId: 'feat-prov', fileName: 'copy.ts', content: 'AB\nCD' }
      })
    );
    expect(again.deduped).toBe(true);
    expect(again.sourceId).toBe(first.sourceId);

    // The feature is unassigned, so the source lists under the null project bucket
    // only; get_source reads it back by id with paging metadata.
    const got = parse<{ content: string; totalChars: number; truncated: boolean }>(
      await client.callTool({ name: 'get_source', arguments: { sourceId: first.sourceId } })
    );
    expect(got.content).toBe('AB\nCD');
    expect(got.totalChars).toBe(5);
    expect(got.truncated).toBe(false);

    const provenance = parse<{ sources: readonly { id: string }[] }>(
      await client.callTool({ name: 'get_provenance', arguments: { featureId: 'feat-prov' } })
    );
    expect(provenance.sources.map((s) => s.id)).toEqual([first.sourceId]);

    await server.close();
  });

  it('requires an explicit sourceId when several sources are linked', async () => {
    const { client, server } = await setup();
    const a = parse<{ sourceId: string }>(
      await client.callTool({
        name: 'attach_source_file',
        arguments: { featureId: 'feat-prov', fileName: 'a.md', content: 'first doc' }
      })
    );
    await client.callTool({
      name: 'attach_source_file',
      arguments: { featureId: 'feat-prov', fileName: 'b.md', content: 'second doc' }
    });

    const ambiguous = await client.callTool({
      name: 'record_element_span',
      arguments: { featureId: 'feat-prov', elementId: 'surf-1', startOffset: 0, endOffset: 5 }
    });
    expect(isErr(ambiguous)).toBe(true);
    expect(rawText(ambiguous)).toMatch(/pass sourceId/i);

    const explicit = parse<{ ok: boolean; sourceId: string }>(
      await client.callTool({
        name: 'record_element_span',
        arguments: {
          featureId: 'feat-prov',
          elementId: 'surf-1',
          startOffset: 0,
          endOffset: 5,
          sourceId: a.sourceId
        }
      })
    );
    expect(explicit.ok).toBe(true);
    expect(explicit.sourceId).toBe(a.sourceId);

    await server.close();
  });

  it('reset_analysis discards spans (with confirm) and remove_source deletes the doc', async () => {
    const { client, server } = await setup();
    const attached = parse<{ sourceId: string }>(
      await client.callTool({
        name: 'attach_source_file',
        arguments: { featureId: 'feat-prov', fileName: 'a.md', content: 'first doc' }
      })
    );
    await client.callTool({
      name: 'record_element_span',
      arguments: { featureId: 'feat-prov', elementId: 'surf-1', startOffset: 0, endOffset: 5 }
    });

    const unconfirmed = await client.callTool({
      name: 'reset_analysis',
      arguments: { featureId: 'feat-prov', confirm: false }
    });
    expect(isErr(unconfirmed)).toBe(true);

    const reset = parse<{ ok: boolean; discardedSpans: number }>(
      await client.callTool({
        name: 'reset_analysis',
        arguments: { featureId: 'feat-prov', confirm: true }
      })
    );
    expect(reset.ok).toBe(true);
    expect(reset.discardedSpans).toBe(1);

    // The stored document survives a reset; remove_source deletes it for real.
    const stillThere = parse<{ content: string }>(
      await client.callTool({ name: 'get_source', arguments: { sourceId: attached.sourceId } })
    );
    expect(stillThere.content).toBe('first doc');

    const removed = parse<{ ok: boolean }>(
      await client.callTool({
        name: 'remove_source',
        arguments: { sourceId: attached.sourceId, confirm: true }
      })
    );
    expect(removed.ok).toBe(true);

    const gone = await client.callTool({
      name: 'get_source',
      arguments: { sourceId: attached.sourceId }
    });
    expect(isErr(gone)).toBe(true);

    await server.close();
  });

  it('record_element_spans applies a batch in one save and reports per-item failures', async () => {
    const { client, server } = await setup();
    await client.callTool({
      name: 'attach_source_file',
      arguments: { featureId: 'feat-prov', fileName: 'home.ts', content: 'AB\nCD' }
    });

    const batch = parse<{
      ok: boolean;
      recorded: number;
      failed: number;
      results: readonly { elementId: string; ok: boolean; error?: string }[];
      spanCount: number;
      remaining: number;
    }>(
      await client.callTool({
        name: 'record_element_spans',
        arguments: {
          featureId: 'feat-prov',
          spans: [
            { elementId: 'surf-1', startOffset: 0, endOffset: 2 },
            { elementId: 'act-1', startOffset: 3, endOffset: 5 },
            { elementId: 'nope-9', startOffset: 0, endOffset: 1 }
          ]
        }
      })
    );
    expect(batch.ok).toBe(false);
    expect(batch.recorded).toBe(2);
    expect(batch.failed).toBe(1);
    expect(batch.results[2]?.error).toMatch(/no element/i);
    expect(batch.spanCount).toBe(2);
    expect(batch.remaining).toBe(0);

    // The two good spans persisted, so finalize goes through.
    const finalized = parse<{ ok: boolean }>(
      await client.callTool({ name: 'finalize_analysis', arguments: { featureId: 'feat-prov' } })
    );
    expect(finalized.ok).toBe(true);
    await server.close();
  });

  it('attach kind:"code" normalizes the path and rejects non-repo-relative ones', async () => {
    const { client, server } = await setup();

    const attached = parse<{ ok: boolean; fileName: string; kind: string }>(
      await client.callTool({
        name: 'attach_source_file',
        arguments: {
          featureId: 'feat-prov',
          fileName: 'src\\lib\\cart.ts',
          content: 'export const x = 1;',
          kind: 'code'
        }
      })
    );
    expect(attached.ok).toBe(true);
    expect(attached.kind).toBe('code');
    expect(attached.fileName).toBe('src/lib/cart.ts');

    const absolute = await client.callTool({
      name: 'attach_source_file',
      arguments: {
        featureId: 'feat-prov',
        fileName: 'C:\\repo\\src\\cart.ts',
        content: 'export const x = 1;',
        kind: 'code'
      }
    });
    expect(isErr(absolute)).toBe(true);
    expect(rawText(absolute)).toMatch(/repo-relative/i);

    await server.close();
  });

  it('ranks a source at attach time, derives from artifact, and re-tags with classify_source', async () => {
    const { client, server } = await setup();

    // Explicit authority is echoed back and surfaced on reads.
    const tagged = parse<{ ok: boolean; authority: string; artifact: string }>(
      await client.callTool({
        name: 'attach_source_file',
        arguments: {
          featureId: 'feat-prov',
          fileName: 'contract.md',
          content: 'the contract',
          authority: 'normative',
          artifact: 'contract'
        }
      })
    );
    expect(tagged.ok).toBe(true);
    expect(tagged.authority).toBe('normative');
    expect(tagged.artifact).toBe('contract');

    // artifact:'interview' with no explicit authority → derived 'observed'.
    const derived = parse<{ sourceId: string; authority: string }>(
      await client.callTool({
        name: 'attach_source_file',
        arguments: {
          featureId: 'feat-prov',
          fileName: 'call.md',
          content: 'a user interview transcript',
          artifact: 'interview'
        }
      })
    );
    expect(derived.authority).toBe('observed');

    // Re-tag the derived source; classify_source is metadata-only.
    const reclassified = parse<{ ok: boolean; authority: string; artifact: string; contentHash: string }>(
      await client.callTool({
        name: 'classify_source',
        arguments: { sourceId: derived.sourceId, authority: 'normative' }
      })
    );
    expect(reclassified.ok).toBe(true);
    expect(reclassified.authority).toBe('normative');
    expect(reclassified.artifact).toBe('interview');

    const read = parse<{ authority: string; artifact: string; content: string }>(
      await client.callTool({ name: 'get_source', arguments: { sourceId: derived.sourceId } })
    );
    expect(read.authority).toBe('normative');
    expect(read.content).toBe('a user interview transcript');

    await server.close();
  });

  it('keeps the stored classification on a dedupe and flags that the new one was ignored', async () => {
    const { client, server } = await setup();
    const first = parse<{ sourceId: string; authority: string }>(
      await client.callTool({
        name: 'attach_source_file',
        arguments: {
          featureId: 'feat-prov',
          fileName: 'doc.md',
          content: 'shared text',
          authority: 'normative'
        }
      })
    );
    const again = parse<{ sourceId: string; authority: string; classificationIgnored?: string }>(
      await client.callTool({
        name: 'attach_source_file',
        arguments: {
          featureId: 'feat-prov',
          fileName: 'doc-copy.md',
          content: 'shared text',
          authority: 'observed'
        }
      })
    );
    expect(again.sourceId).toBe(first.sourceId);
    expect(again.authority).toBe('normative');
    expect(again.classificationIgnored).toMatch(/classify_source/i);

    await server.close();
  });

  it('flags a source conflict, suggests the higher-authority winner, and resolves it', async () => {
    const { client, server } = await setup();

    const contract = parse<{ sourceId: string }>(
      await client.callTool({
        name: 'attach_source_file',
        arguments: {
          featureId: 'feat-prov',
          fileName: 'prd.md',
          content: 'the cart caps at 20',
          artifact: 'contract'
        }
      })
    );
    const code = parse<{ sourceId: string }>(
      await client.callTool({
        name: 'attach_source_file',
        arguments: {
          featureId: 'feat-prov',
          fileName: 'cart.ts',
          content: 'const CAP = 10',
          kind: 'code',
          artifact: 'implementation'
        }
      })
    );

    const flagged = parse<{
      ok: boolean;
      conflictId: string;
      status: string;
      openConflictCount: number;
      suggestedResolution: { kind: string; sourceId?: string; authority?: string };
    }>(
      await client.callTool({
        name: 'flag_conflict',
        arguments: {
          featureId: 'feat-prov',
          summary: 'Cart item cap disagreement',
          claims: [
            { sourceId: contract.sourceId, statement: 'caps at 20' },
            { sourceId: code.sourceId, statement: 'caps at 10' }
          ],
          affectedElements: ['act-1']
        }
      })
    );
    expect(flagged.ok).toBe(true);
    expect(flagged.status).toBe('open');
    expect(flagged.openConflictCount).toBe(1);
    // The contract (normative) outranks the implementation (supporting).
    expect(flagged.suggestedResolution.kind).toBe('winner');
    expect(flagged.suggestedResolution.sourceId).toBe(contract.sourceId);
    expect(flagged.suggestedResolution.authority).toBe('normative');

    // get_provenance surfaces the open conflict.
    const prov = parse<{ openConflictCount: number; conflicts: readonly { id: string; status: string }[] }>(
      await client.callTool({ name: 'get_provenance', arguments: { featureId: 'feat-prov' } })
    );
    expect(prov.openConflictCount).toBe(1);
    expect(prov.conflicts[0]?.id).toBe(flagged.conflictId);

    const resolved = parse<{ ok: boolean; status: string; openConflictCount: number }>(
      await client.callTool({
        name: 'resolve_conflict',
        arguments: {
          featureId: 'feat-prov',
          conflictId: flagged.conflictId,
          status: 'resolved',
          resolution: 'The contract governs; cap is 20.',
          resolvedInFavorOf: contract.sourceId
        }
      })
    );
    expect(resolved.ok).toBe(true);
    expect(resolved.status).toBe('resolved');
    expect(resolved.openConflictCount).toBe(0);

    await server.close();
  });

  it('stages behavior candidates and disposes them, tracking the unreviewed count', async () => {
    const { client, server } = await setup();
    const src = parse<{ sourceId: string }>(
      await client.callTool({
        name: 'attach_source_file',
        arguments: { featureId: 'feat-prov', fileName: 'prd.md', content: 'The user can click. And scroll.' }
      })
    );

    const batch = parse<{ ok: boolean; staged: number; failed: number; unreviewedCount: number }>(
      await client.callTool({
        name: 'stage_candidates',
        arguments: {
          featureId: 'feat-prov',
          sourceId: src.sourceId,
          candidates: [
            { startOffset: 0, endOffset: 18, proposedKind: 'action', summary: 'User can click' },
            { startOffset: 19, endOffset: 31, proposedKind: 'action', summary: 'User can scroll', confidence: 0.8 }
          ]
        }
      })
    );
    expect(batch.ok).toBe(true);
    expect(batch.staged).toBe(2);
    expect(batch.unreviewedCount).toBe(2);

    // One more staged singly, so we have a candidate id to dispose.
    const single = parse<{ candidateId: string; unreviewedCount: number }>(
      await client.callTool({
        name: 'stage_candidate',
        arguments: {
          featureId: 'feat-prov',
          sourceId: src.sourceId,
          startOffset: 0,
          endOffset: 4,
          proposedKind: 'surface',
          summary: 'The screen'
        }
      })
    );
    expect(single.unreviewedCount).toBe(3);

    // Accept it against a real element; the unreviewed count drops.
    const accepted = parse<{ ok: boolean; disposition: string; elementId: string; unreviewedCount: number }>(
      await client.callTool({
        name: 'dispose_candidate',
        arguments: {
          featureId: 'feat-prov',
          candidateId: single.candidateId,
          disposition: 'accepted',
          elementId: 'surf-1',
          rationale: 'Modeled as the Home surface.'
        }
      })
    );
    expect(accepted.ok).toBe(true);
    expect(accepted.disposition).toBe('accepted');
    expect(accepted.elementId).toBe('surf-1');
    expect(accepted.unreviewedCount).toBe(2);

    // Accepting without an element is refused.
    const noElement = await client.callTool({
      name: 'dispose_candidate',
      arguments: { featureId: 'feat-prov', candidateId: single.candidateId, disposition: 'merged' }
    });
    expect(isErr(noElement)).toBe(true);

    const prov = parse<{ candidateCount: number; unreviewedCandidateCount: number }>(
      await client.callTool({ name: 'get_provenance', arguments: { featureId: 'feat-prov' } })
    );
    expect(prov.candidateCount).toBe(3);
    expect(prov.unreviewedCandidateCount).toBe(2);

    await server.close();
  });

  it('reports bidirectional source coverage from staged candidates', async () => {
    const { client, server } = await setup();
    const src = parse<{ sourceId: string }>(
      await client.callTool({
        name: 'attach_source_file',
        arguments: { featureId: 'feat-prov', fileName: 'prd.md', content: 'aaaa bbbb cccc dddd' }
      })
    );

    // Four candidates: accept one, reject one, leave two unreviewed.
    const staged = parse<{ results: readonly { candidateId: string }[] }>(
      await client.callTool({
        name: 'stage_candidates',
        arguments: {
          featureId: 'feat-prov',
          sourceId: src.sourceId,
          candidates: [
            { startOffset: 0, endOffset: 4, proposedKind: 'action', summary: 'A' },
            { startOffset: 5, endOffset: 9, proposedKind: 'action', summary: 'B' },
            { startOffset: 10, endOffset: 14, proposedKind: 'action', summary: 'C' },
            { startOffset: 15, endOffset: 19, proposedKind: 'action', summary: 'D' }
          ]
        }
      })
    );
    await client.callTool({
      name: 'dispose_candidate',
      arguments: {
        featureId: 'feat-prov',
        candidateId: staged.results[0]!.candidateId,
        disposition: 'accepted',
        elementId: 'act-1'
      }
    });
    await client.callTool({
      name: 'dispose_candidate',
      arguments: {
        featureId: 'feat-prov',
        candidateId: staged.results[1]!.candidateId,
        disposition: 'rejected',
        rationale: 'Not a behavior.'
      }
    });

    const coverage = parse<{
      ok: boolean;
      candidateCount: number;
      overall: { total: number; modeled: number; excluded: number; unresolved: number; unresolvedShare: number };
      sources: readonly { sourceId: string; name?: string; total: number; unresolved: number }[];
      unresolved: readonly { summary: string }[];
    }>(
      await client.callTool({ name: 'get_source_coverage', arguments: { featureId: 'feat-prov' } })
    );
    expect(coverage.ok).toBe(true);
    expect(coverage.candidateCount).toBe(4);
    expect(coverage.overall.modeled).toBe(1);
    expect(coverage.overall.excluded).toBe(1);
    expect(coverage.overall.unresolved).toBe(2);
    expect(coverage.overall.unresolvedShare).toBe(0.5);
    expect(coverage.sources[0]?.name).toBe('prd.md');
    expect(coverage.unresolved.map((u) => u.summary).sort()).toEqual(['C', 'D']);

    await server.close();
  });

  it('reports empty coverage when nothing is staged', async () => {
    const { client, server } = await setup();
    const empty = parse<{ ok: boolean; candidateCount: number; hint?: string }>(
      await client.callTool({ name: 'get_source_coverage', arguments: { featureId: 'feat-prov' } })
    );
    expect(empty.ok).toBe(true);
    expect(empty.candidateCount).toBe(0);
    expect(empty.hint).toMatch(/stage_candidate/i);
    await server.close();
  });

  it('rejects a conflict with under two claims or an unknown source', async () => {
    const { client, server } = await setup();
    const src = parse<{ sourceId: string }>(
      await client.callTool({
        name: 'attach_source_file',
        arguments: { featureId: 'feat-prov', fileName: 'a.md', content: 'doc' }
      })
    );

    const tooFew = await client.callTool({
      name: 'flag_conflict',
      arguments: {
        featureId: 'feat-prov',
        summary: 's',
        claims: [{ sourceId: src.sourceId, statement: 'x' }]
      }
    });
    expect(isErr(tooFew)).toBe(true);

    const ghost = await client.callTool({
      name: 'flag_conflict',
      arguments: {
        featureId: 'feat-prov',
        summary: 's',
        claims: [
          { sourceId: src.sourceId, statement: 'x' },
          { sourceId: 'no-such-source', statement: 'y' }
        ]
      }
    });
    expect(isErr(ghost)).toBe(true);
    expect(rawText(ghost)).toMatch(/no stored source/i);

    await server.close();
  });

  it('rejects a span past the end of the file and an unknown element', async () => {
    const { client, server } = await setup();
    await client.callTool({
      name: 'attach_source_file',
      arguments: { featureId: 'feat-prov', fileName: 'home.ts', content: 'AB\nCD' }
    });

    const pastEnd = await client.callTool({
      name: 'record_element_span',
      arguments: { featureId: 'feat-prov', elementId: 'surf-1', startOffset: 0, endOffset: 999 }
    });
    expect(isErr(pastEnd)).toBe(true);
    expect(rawText(pastEnd)).toMatch(/past the end/i);

    const unknown = await client.callTool({
      name: 'record_element_span',
      arguments: { featureId: 'feat-prov', elementId: 'nope-9', startOffset: 0, endOffset: 2 }
    });
    expect(isErr(unknown)).toBe(true);
    expect(rawText(unknown)).toMatch(/no element/i);

    await server.close();
  });
});

describe('seed_index_from_analysis (codebase adoption)', () => {
  const CODE = 'const a = 1;\nexport const addToCart = () => {};\n';

  const setupLinked = async () => {
    nextId = 0;
    const repoRoot = mkdtempSync(join(tmpdir(), 'unspa-adopt-'));
    const linkPath = join(repoRoot, '.unspa.json');
    writeFileSync(linkPath, JSON.stringify({ projectId: 'proj-x', index: {} }), 'utf8');
    mkdirSync(join(repoRoot, 'src'), { recursive: true });
    writeFileSync(join(repoRoot, 'src', 'cart.ts'), CODE, 'utf8');

    const repo = new InMemoryFeatureRepository();
    await repo.save(tinyFeature);
    const server = buildServer(repo, {
      ids: fixedIds,
      clock: fixedClock('2026-05-09T00:00:00.000Z'),
      repoContext: { cwd: repoRoot, linkPath, link: { projectId: 'proj-x' } }
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return { client, server, linkPath, repoRoot };
  };

  it('attach_source_path reads the file server-side, normalizes path and EOL', async () => {
    const { client, server, repoRoot } = await setupLinked();

    const attached = parse<{
      ok: boolean;
      fileName: string;
      kind: string;
      totalChars: number;
      normalizedEol: boolean;
      contentHash: string;
    }>(
      await client.callTool({
        name: 'attach_source_path',
        arguments: { featureId: 'feat-prov', path: 'src\\cart.ts' }
      })
    );
    expect(attached.ok).toBe(true);
    expect(attached.fileName).toBe('src/cart.ts');
    expect(attached.kind).toBe('code');
    expect(attached.totalChars).toBe(CODE.length);
    expect(attached.normalizedEol).toBe(false);

    // A CRLF file is stored LF so span offsets are OS-independent.
    writeFileSync(join(repoRoot, 'src', 'win.ts'), 'const a = 1;\r\nconst b = 2;\r\n', 'utf8');
    const win = parse<{ sourceId: string; totalChars: number; normalizedEol: boolean }>(
      await client.callTool({
        name: 'attach_source_path',
        arguments: { featureId: 'feat-prov', path: 'src/win.ts' }
      })
    );
    expect(win.normalizedEol).toBe(true);
    expect(win.totalChars).toBe('const a = 1;\nconst b = 2;\n'.length);
    const stored = parse<{ content: string }>(
      await client.callTool({ name: 'get_source', arguments: { sourceId: win.sourceId } })
    );
    expect(stored.content).not.toContain('\r');

    await server.close();
  });

  it('attach_source_path refuses escapes, missing files, and a server with no repo context', async () => {
    const linked = await setupLinked();

    const escape = await linked.client.callTool({
      name: 'attach_source_path',
      arguments: { featureId: 'feat-prov', path: '../outside.ts' }
    });
    expect(isErr(escape)).toBe(true);
    expect(rawText(escape)).toMatch(/must not contain/i);

    const missing = await linked.client.callTool({
      name: 'attach_source_path',
      arguments: { featureId: 'feat-prov', path: 'src/ghost.ts' }
    });
    expect(isErr(missing)).toBe(true);
    expect(rawText(missing)).toMatch(/no file at/i);
    await linked.server.close();

    // No repoContext at all: actionable fallback pointing at attach_source_file.
    const bare = await setup();
    const noContext = await bare.client.callTool({
      name: 'attach_source_path',
      arguments: { featureId: 'feat-prov', path: 'src/cart.ts' }
    });
    expect(isErr(noContext)).toBe(true);
    expect(rawText(noContext)).toMatch(/attach_source_file instead/i);
    await bare.server.close();
  });

  it('turns code-source spans into .unspa.json entries; doc spans stay provenance-only', async () => {
    const { client, server, linkPath } = await setupLinked();

    const code = parse<{ sourceId: string }>(
      await client.callTool({
        name: 'attach_source_file',
        arguments: { featureId: 'feat-prov', fileName: 'src/cart.ts', content: CODE, kind: 'code' }
      })
    );
    const doc = parse<{ sourceId: string }>(
      await client.callTool({
        name: 'attach_source_file',
        arguments: { featureId: 'feat-prov', fileName: 'notes.md', content: 'the surface is home' }
      })
    );

    // Action traced to line 2 of the code file; surface traced to the doc.
    await client.callTool({
      name: 'record_element_span',
      arguments: {
        featureId: 'feat-prov',
        elementId: 'act-1',
        startOffset: 13,
        endOffset: 48,
        sourceId: code.sourceId
      }
    });
    await client.callTool({
      name: 'record_element_span',
      arguments: {
        featureId: 'feat-prov',
        elementId: 'surf-1',
        startOffset: 0,
        endOffset: 19,
        sourceId: doc.sourceId
      }
    });

    const seeded = parse<{
      ok: boolean;
      written: number;
      writtenKeys: readonly string[];
      nonCodeSpans: number;
      missingFiles: readonly string[];
    }>(
      await client.callTool({
        name: 'seed_index_from_analysis',
        arguments: { featureId: 'feat-prov' }
      })
    );
    expect(seeded.ok).toBe(true);
    expect(seeded.written).toBe(1);
    expect(seeded.writtenKeys).toEqual(['action:act-1']);
    expect(seeded.nonCodeSpans).toBe(1);
    expect(seeded.missingFiles).toEqual([]);

    const link = JSON.parse(readFileSync(linkPath, 'utf8')) as {
      projectId: string;
      index: Record<string, { status: string; file: string; line: number; signature: string; specVersion: string }>;
    };
    expect(link.projectId).toBe('proj-x');
    expect(link.index['action:act-1']).toEqual({
      status: 'implemented',
      file: 'src/cart.ts',
      line: 2,
      signature: 'export const addToCart = () => {};',
      auditedAt: '2026-05-09T00:00:00.000Z',
      specVersion: tinyFeature.updatedAt
    });

    // Re-seeding never clobbers an existing entry unless overwrite:true.
    const again = parse<{ written: number; keptExisting: readonly string[] }>(
      await client.callTool({
        name: 'seed_index_from_analysis',
        arguments: { featureId: 'feat-prov' }
      })
    );
    expect(again.written).toBe(0);
    expect(again.keptExisting).toEqual(['action:act-1']);

    const forced = parse<{ written: number }>(
      await client.callTool({
        name: 'seed_index_from_analysis',
        arguments: { featureId: 'feat-prov', overwrite: true }
      })
    );
    expect(forced.written).toBe(1);

    await server.close();
  });

  it('dryRun previews without touching .unspa.json', async () => {
    const { client, server, linkPath } = await setupLinked();
    const code = parse<{ sourceId: string }>(
      await client.callTool({
        name: 'attach_source_file',
        arguments: { featureId: 'feat-prov', fileName: 'src/cart.ts', content: CODE, kind: 'code' }
      })
    );
    await client.callTool({
      name: 'record_element_span',
      arguments: {
        featureId: 'feat-prov',
        elementId: 'act-1',
        startOffset: 13,
        endOffset: 48,
        sourceId: code.sourceId
      }
    });

    const preview = parse<{ ok: boolean; dryRun: boolean; written: number }>(
      await client.callTool({
        name: 'seed_index_from_analysis',
        arguments: { featureId: 'feat-prov', dryRun: true }
      })
    );
    expect(preview.dryRun).toBe(true);
    expect(preview.written).toBe(1);

    const link = JSON.parse(readFileSync(linkPath, 'utf8')) as { index: Record<string, unknown> };
    expect(link.index).toEqual({});
    await server.close();
  });

  it('errors without a repo link and without recorded spans', async () => {
    // No repoContext at all → actionable error.
    const bare = await setup();
    const noLink = await bare.client.callTool({
      name: 'seed_index_from_analysis',
      arguments: { featureId: 'feat-prov' }
    });
    expect(isErr(noLink)).toBe(true);
    expect(rawText(noLink)).toMatch(/unspa link/i);
    await bare.server.close();

    // Linked but nothing recorded → actionable error.
    const linked = await setupLinked();
    const noSpans = await linked.client.callTool({
      name: 'seed_index_from_analysis',
      arguments: { featureId: 'feat-prov' }
    });
    expect(isErr(noSpans)).toBe(true);
    expect(rawText(noSpans)).toMatch(/no spans recorded/i);
    await linked.server.close();
  });
});
