/** Host-managed removals must use the command, never a snapshot replacement or Yjs update. */
export class StateDeletionCommandRequiredError extends Error {}

export function assertStateDefinitionsPreserved(before: unknown, after: unknown): void {
  const ids = (value: unknown): Set<string> => {
    const feature = value as { surfaces?: { stateDefinitions?: { id: string }[] }[] } | null;
    return new Set(
      (feature?.surfaces ?? []).flatMap((s) => (s.stateDefinitions ?? []).map((d) => d.id))
    );
  };
  const next = ids(after);
  if ([...ids(before)].some((id) => !next.has(id))) {
    throw new StateDeletionCommandRequiredError(
      'State removal must use the checked deletion command. Use the Remove state button.'
    );
  }
}
