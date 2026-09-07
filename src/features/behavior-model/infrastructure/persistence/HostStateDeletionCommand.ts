import type {
  StateDeletionCommand,
  StateDeletionInput,
  StateDeletionResult
} from '../../application/ports/StateDeletionCommand';

/** The host's authenticated command is the sole writer when this editor belongs to Lyriks. */
export class HostStateDeletionCommand implements StateDeletionCommand {
  constructor(
    private readonly hostUrl: string,
    private readonly cookie: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async execute(input: StateDeletionInput): Promise<StateDeletionResult> {
    if (!this.hostUrl || !input.projectId)
      throw new Error('The host deletion service is not configured. Nothing was deleted.');
    const endpoint = new URL('/api/behavior/state/delete', this.hostUrl);
    const response = await this.fetchImpl(endpoint, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
      headers: { 'content-type': 'application/json', cookie: this.cookie, origin: endpoint.origin },
      body: JSON.stringify(input)
    });
    const body = await response.json();
    if (!response.ok || typeof body.ok !== 'boolean')
      throw new Error(
        body.message ?? 'The host did not authorize the deletion. Nothing was deleted.'
      );
    return body as StateDeletionResult;
  }
}
