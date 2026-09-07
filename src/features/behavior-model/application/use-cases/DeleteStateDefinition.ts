import type {
  StateDeletionCommand,
  StateDeletionInput,
  StateDeletionResult
} from '../ports/StateDeletionCommand';
import type { FeatureRepository } from '../ports/FeatureRepository';
import type { Clock } from '$shared/domain/Clock';
import { asFeatureId, asSurfaceId, asStateDefinitionId } from '../../domain/value-objects/ids';
import { removeStateDefinition } from '../../domain/services/FeatureTransforms';
import { mutateFeatureUseCase } from './MutateFeature';

/** Standalone composition: local validation only, through the same mutation primitive as MCP. */
export class DeleteStateDefinitionUseCase implements StateDeletionCommand {
  constructor(
    private readonly repository: FeatureRepository,
    private readonly clock: Clock
  ) {}
  async execute(input: StateDeletionInput): Promise<StateDeletionResult> {
    try {
      await mutateFeatureUseCase({ repository: this.repository, clock: this.clock })({
        featureId: asFeatureId(input.featureId),
        transform: (feature) =>
          removeStateDefinition(
            feature,
            asSurfaceId(input.surfaceId),
            asStateDefinitionId(input.stateDefinitionId)
          )
      });
      return {
        ok: true,
        code: 'DELETED',
        formalChecked: false,
        message: 'State deleted. Local validation passed.'
      };
    } catch (cause) {
      const e = cause as Error & { errors?: readonly string[] };
      return {
        ok: false,
        code: 'BEHAVIOR',
        formalChecked: false,
        message: e.errors?.join('\n') ?? e.message
      };
    }
  }
}
