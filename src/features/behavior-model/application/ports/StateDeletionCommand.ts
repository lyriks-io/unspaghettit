export interface StateDeletionInput {
  readonly projectId: string | null;
  readonly featureId: string;
  readonly surfaceId: string;
  readonly stateDefinitionId: string;
}

export interface StateDeletionResult {
  readonly ok: boolean;
  readonly message: string;
  readonly code: string;
  readonly formalChecked: boolean;
}

/** A command, not an optimistic snapshot edit. The server owns the deletion policy. */
export interface StateDeletionCommand {
  execute(input: StateDeletionInput): Promise<StateDeletionResult>;
}
