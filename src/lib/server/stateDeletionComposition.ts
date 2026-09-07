import { HostStateDeletionCommand } from '../../features/behavior-model/infrastructure/persistence/HostStateDeletionCommand';
import { DeleteStateDefinitionUseCase } from '../../features/behavior-model/application/use-cases/DeleteStateDefinition';
import type { StateDeletionCommand } from '../../features/behavior-model/application/ports/StateDeletionCommand';
import { systemClock } from '../../shared/domain/Clock';
import { hostOwnsStateDeletion } from './hostIntegration';
import { getSnapshotRepository } from './snapshotRepository';
import { createSyncAwareFeatureRepository } from './syncAwareRepositories';
import { withProjectLibrary } from '../../features/projects/infrastructure/persistence/ProjectScopedFeatureRepository';

export function stateDeletionCommand(request: Request): StateDeletionCommand {
  if (hostOwnsStateDeletion()) {
    return new HostStateDeletionCommand(
      process.env.UNSPA_HOST_URL?.trim() ?? '',
      request.headers.get('cookie') ?? ''
    );
  }
  const { repo, projectRepo } = getSnapshotRepository();
  return new DeleteStateDefinitionUseCase(
    withProjectLibrary(createSyncAwareFeatureRepository(repo), projectRepo),
    systemClock
  );
}
