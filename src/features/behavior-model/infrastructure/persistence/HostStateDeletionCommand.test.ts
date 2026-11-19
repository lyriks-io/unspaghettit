import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { StateDeletionInput } from '../../application/ports/StateDeletionCommand';
import { HostStateDeletionCommand } from './HostStateDeletionCommand';

const input: StateDeletionInput = { projectId: 'p', featureId: 'f', surfaceId: 's', stateDefinitionId: 'd' };

type Received = { method?: string; url?: string; headers: IncomingHttpHeaders; body: unknown };

/** A real host on a free port: it answers each request with the next reply and keeps what it received. */
const host = async (...replies: { status?: number; headers?: Record<string, string>; body?: string }[]) => {
  const received: Received[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      received.push({ method: req.method, url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : undefined });
      const reply = replies.shift() ?? { status: 500, body: '{}' };
      res.writeHead(reply.status ?? 200, { 'content-type': 'application/json', ...reply.headers });
      res.end(reply.body ?? '');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  open.push(server);
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, received };
};

const open: Server[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((s) => new Promise((resolve) => s.close(resolve))));
});

describe('HostStateDeletionCommand', () => {
  it('posts the deletion to the host with the session cookie and its own origin, and returns its verdict', async () => {
    const verdict = { ok: true, message: 'State deleted.', code: 'DELETED', formalChecked: false };
    const h = await host({ body: JSON.stringify(verdict) });
    const result = await new HostStateDeletionCommand(h.url, 'lyriks-session=abc', fetch).execute(input);
    expect(result).toEqual(verdict);
    expect(h.received).toHaveLength(1);
    const [request] = h.received;
    expect(request).toMatchObject({ method: 'POST', url: '/api/behavior/state/delete', body: input });
    expect(request!.headers).toMatchObject({
      cookie: 'lyriks-session=abc',
      origin: h.url,
      'content-type': 'application/json'
    });
  });

  it('returns a refusal the host answers as such, its reason and formal check intact', async () => {
    const refusal = { ok: false, message: 'Action Save still depends on this state.', code: 'GLUING_CONDITION', formalChecked: true };
    const h = await host({ body: JSON.stringify(refusal) });
    expect(await new HostStateDeletionCommand(h.url, '', fetch).execute(input)).toEqual(refusal);
  });

  it('refuses without asking anyone when no host or no project is known', async () => {
    const h = await host();
    await expect(new HostStateDeletionCommand('', '', fetch).execute(input)).rejects.toThrow('Nothing was deleted');
    await expect(new HostStateDeletionCommand(h.url, '', fetch).execute({ ...input, projectId: null })).rejects.toThrow(
      'not configured'
    );
    expect(h.received).toEqual([]);
  });

  it('fails with the host message when the host turns the request down', async () => {
    const h = await host(
      { status: 403, body: JSON.stringify({ message: 'You may not edit this project.' }) },
      { status: 500, body: '{}' },
      // A failed answer is never a verdict, even one shaped like a success.
      { status: 502, body: JSON.stringify({ ok: true, message: 'Bad gateway.', code: 'DELETED', formalChecked: false }) }
    );
    const command = new HostStateDeletionCommand(h.url, '', fetch);
    await expect(command.execute(input)).rejects.toThrow('You may not edit this project.');
    await expect(command.execute(input)).rejects.toThrow('The host did not authorize the deletion. Nothing was deleted.');
    await expect(command.execute(input)).rejects.toThrow('Bad gateway.');
  });

  it('fails when the host answers something that is not a verdict', async () => {
    const h = await host({ body: JSON.stringify({ deleted: true }) });
    await expect(new HostStateDeletionCommand(h.url, '', fetch).execute(input)).rejects.toThrow('Nothing was deleted');
  });

  it('never follows a redirect, so the cookie only reaches the configured host', async () => {
    const elsewhere = await host({ body: JSON.stringify({ ok: true, message: '', code: 'DELETED', formalChecked: false }) });
    const h = await host({ status: 307, headers: { location: `${elsewhere.url}/api/behavior/state/delete` } });
    await expect(new HostStateDeletionCommand(h.url, 'lyriks-session=abc', fetch).execute(input)).rejects.toThrow();
    expect(elsewhere.received).toEqual([]);
  });

  it('fails when the host cannot be reached', async () => {
    const h = await host();
    const url = h.url;
    await Promise.all(open.splice(0).map((s) => new Promise((resolve) => s.close(resolve))));
    await expect(new HostStateDeletionCommand(url, '', fetch).execute(input)).rejects.toThrow();
  });
});
