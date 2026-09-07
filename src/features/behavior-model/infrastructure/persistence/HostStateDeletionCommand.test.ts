import { it, expect, vi } from 'vitest';
import { HostStateDeletionCommand } from './HostStateDeletionCommand';
const input = { projectId: 'p', featureId: 'f', surfaceId: 's', stateDefinitionId: 'd' };

it('forwards the authenticated command and preserves the host DPO refusal', async () => {
  const refusal = {
    ok: false,
    message: 'Action Save still depends on this state.',
    code: 'GLUING_CONDITION',
    formalChecked: true
  };
  const fetchImpl = vi.fn().mockResolvedValue(Response.json(refusal));
  const command = new HostStateDeletionCommand(
    'http://platform:3000',
    'lyriks-session=session',
    fetchImpl
  );
  expect(await command.execute(input)).toEqual(refusal);
  expect(String(fetchImpl.mock.calls[0]![0])).toBe(
    'http://platform:3000/api/behavior/state/delete'
  );
  expect(fetchImpl.mock.calls[0]![1]).toMatchObject({
    method: 'POST',
    redirect: 'error',
    headers: { cookie: 'lyriks-session=session' }
  });
});

it('never falls back to a local write if the host is missing or unreachable', async () => {
  const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
  await expect(new HostStateDeletionCommand('', '', fetchImpl).execute(input)).rejects.toThrow(
    'not configured'
  );
  expect(fetchImpl).not.toHaveBeenCalled();
  await expect(
    new HostStateDeletionCommand('http://platform:3000', '', fetchImpl).execute(input)
  ).rejects.toThrow('offline');
});

it('lets Community use exactly the same command without inventing a formal verdict', async () => {
  const result = { ok: true, message: 'State deleted.', code: 'DELETED', formalChecked: false };
  expect(
    await new HostStateDeletionCommand(
      'http://platform:3000',
      '',
      vi.fn().mockResolvedValue(Response.json(result))
    ).execute(input)
  ).toEqual(result);
});
