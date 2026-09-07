import type {
  StateDeletionCommand,
  StateDeletionInput,
  StateDeletionResult
} from '../../application/ports/StateDeletionCommand';
import { apiFetch } from '$shared/security/apiFetch';

export class HttpStateDeletionCommand implements StateDeletionCommand {
  async execute(input: StateDeletionInput): Promise<StateDeletionResult> {
    const response = await apiFetch(
      `/api/snapshots/${encodeURIComponent(input.featureId)}/state-deletion`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input)
      }
    );
    const body = await response.json();
    if (!response.ok)
      throw new Error(body.message ?? 'The deletion was not confirmed. Reload before retrying.');
    return body as StateDeletionResult;
  }
}
