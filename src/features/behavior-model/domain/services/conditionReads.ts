/** Every state path a condition reads: the left of each comparison and any state it compares to. */
export const statesReadBy = (condition: unknown): string[] => {
  const out = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const node = value as { [key: string]: unknown };
    if (typeof node.left === 'string' && 'operator' in node) out.add(node.left);
    if (node.kind === 'state' && typeof node.path === 'string') out.add(node.path);
    if (typeof node.overPath === 'string') out.add(node.overPath);
    for (const child of Object.values(node)) if (child && typeof child === 'object') visit(child);
  };
  visit(condition);
  return [...out];
};
