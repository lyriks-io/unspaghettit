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
