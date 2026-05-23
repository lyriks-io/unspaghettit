/**
 * In-place reconciliation of a `target` object/array to match `next`, with
 * **id-keyed array reordering**. Use this when you need Svelte's `{#each ... (id)}`
 * blocks to preserve DOM identity across a structural change. Naively applying
 * a JSON patch field-by-field briefly produces duplicate ids (Svelte throws
 * `each_key_duplicate` mid-flush) and rewrites every leaf bound to a moved row.
 *
 * Rules:
 *   - Arrays whose every item has an `id` string are reconciled by id:
 *       splice items into their new positions, then recurse into each pair.
 *   - Other arrays are reconciled by index (length-first, then per-element).
 *   - Plain objects recurse key-by-key; keys missing from `next` are deleted.
 *   - Primitives or type mismatches are replaced via the parent's setter.
 *
 * Returns the mutated target for convenience.
 */

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

const isIdItem = (v: unknown): v is { id: string } =>
  !!v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'string';

const reconcileObject = (
  target: Record<string, unknown>,
  next: Record<string, unknown>
): void => {
  for (const key of Object.keys(target)) {
    if (!(key in next)) delete target[key];
  }
  for (const key of Object.keys(next)) {
    const nv = next[key];
    if (!(key in target)) {
      target[key] = nv;
      continue;
    }
    const tv = target[key];
    if (Array.isArray(tv) && Array.isArray(nv)) {
      reconcileArray(tv, nv);
    } else if (isPlainObject(tv) && isPlainObject(nv)) {
      reconcileObject(tv, nv);
    } else if (tv !== nv) {
      target[key] = nv;
    }
  }
};

const reconcileArray = (target: unknown[], next: unknown[]): void => {
  const targetKeyed = target.every(isIdItem);
  const nextKeyed = next.every(isIdItem);

  if (targetKeyed && nextKeyed) {
    const targetItems = target as { id: string }[];
    const nextItems = next as { id: string }[];
    const byId = new Map<string, { id: string }>();
    for (const it of targetItems) byId.set(it.id, it);

    // Walk next in order, slotting each id into the right index.
    for (let i = 0; i < nextItems.length; i += 1) {
      const desired = nextItems[i]!;
      const existing = byId.get(desired.id);
      const here = targetItems[i] as { id: string } | undefined;

      if (existing && here && here.id === desired.id) {
        // Already in place. Recurse into contents.
        reconcileObject(
          existing as unknown as Record<string, unknown>,
          desired as unknown as Record<string, unknown>
        );
        continue;
      }

      if (existing) {
        // Existing item but wrong position. Remove from current slot, splice
        // into position `i`. The single `splice` keeps the array's items'
        // identities. Svelte's keyed each sees a move, not a remove+insert.
        const fromIdx = targetItems.indexOf(existing);
        if (fromIdx !== i) {
          targetItems.splice(fromIdx, 1);
          targetItems.splice(i, 0, existing);
        }
        reconcileObject(
          existing as unknown as Record<string, unknown>,
          desired as unknown as Record<string, unknown>
        );
      } else {
        // New item. Insert. Recurse so any nested arrays/objects are normalized
        // (defensive; new items are usually leaves with no shared identity to
        // preserve).
        targetItems.splice(i, 0, desired);
        byId.set(desired.id, desired);
      }
    }
    // Drop extras at the end.
    if (targetItems.length > nextItems.length) {
      targetItems.splice(nextItems.length, targetItems.length - nextItems.length);
    }
    return;
  }

  // Index-based: shrink/grow then per-element recurse.
  if (target.length > next.length) target.splice(next.length, target.length - next.length);
  for (let i = 0; i < next.length; i += 1) {
    const nv = next[i];
    if (i >= target.length) {
      target.push(nv);
      continue;
    }
    const tv = target[i];
    if (Array.isArray(tv) && Array.isArray(nv)) {
      reconcileArray(tv, nv);
    } else if (isPlainObject(tv) && isPlainObject(nv)) {
      reconcileObject(tv, nv);
    } else if (tv !== nv) {
      target[i] = nv;
    }
  }
};

export const reconcileInPlace = <T extends object>(target: T, next: T): T => {
  if (Array.isArray(target) && Array.isArray(next)) {
    reconcileArray(target, next);
  } else if (isPlainObject(target) && isPlainObject(next)) {
    reconcileObject(
      target as unknown as Record<string, unknown>,
      next as unknown as Record<string, unknown>
    );
  }
  return target;
};

/**
 * Deep-clone an object built from a mix of Svelte $state proxies and plain
 * objects to a fully plain POJO tree. Cheap, safe, and breaks proxy identity
 * sharing. Critical before handing the value to in-place mutation or to a
 * Yjs setter (which serializes the value and would otherwise see the live,
 * shared proxy state).
 */
export const deepClonePlain = <T>(value: T): T =>
  JSON.parse(JSON.stringify(value)) as T;
