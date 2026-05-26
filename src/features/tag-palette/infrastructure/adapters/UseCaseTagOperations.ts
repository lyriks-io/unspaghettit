import type { TagOperations } from '$features/tag-palette/application/ports/TagOperations';
import type {
  RenameTagInput,
  RenameTagResult
} from '$features/tag-palette/application/use-cases/RenameTag';
import { renameTagUseCase } from '$features/tag-palette/application/use-cases/RenameTag';

/**
 * Wraps the renameTag use case as a TagOperations port. Used by callers
 * (tests, in-memory environments) that already hold the cross-aggregate
 * repositories and don't need an HTTP round trip.
 */
export class UseCaseTagOperations implements TagOperations {
  private readonly run: ReturnType<typeof renameTagUseCase>;
  constructor(deps: Parameters<typeof renameTagUseCase>[0]) {
    this.run = renameTagUseCase(deps);
  }
  renameTag(input: RenameTagInput): Promise<RenameTagResult> {
    return this.run(input);
  }
}
