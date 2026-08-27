<script lang="ts">
  import type { Surface } from '$features/behavior-model/domain/entities/Surface';
  import type { StateDefinitionId } from '$features/behavior-model/domain/value-objects/ids';
  import { featureStore } from '$features/behavior-model/presentation/stores/featureStore.svelte';
  import { moveStateDefinitionBy } from '$features/behavior-model/domain/services/FeatureTransforms';
  import { simulatorStore } from '$features/simulator/presentation/stores/simulatorStore.svelte';
  import { readPath, type StatePath } from '$features/behavior-model/domain/value-objects/StatePath';
  import type { StateValue } from '$features/behavior-model/domain/value-objects/StateValue';
  import { humanizeStatePath } from '$features/behavior-model/domain/value-objects/humanize';

  type Props = { surface: Surface };
  let { surface }: Props = $props();

  // The sentinel `undefined` means "invalid input, do not write". Writing the
  // raw STRING for an array/object path used to corrupt the snapshot: every
  // list effect and `contains` check then silently no-oped against "[1,2]".
  function coerce(raw: string, type: string): StateValue | undefined {
    if (type === 'boolean') return raw === 'true';
    if (type === 'number') {
      const n = Number(raw);
      return Number.isFinite(n) ? n : 0;
    }
    if (type === 'array' || type === 'object') {
      try {
        // JSON.parse output is a StateValue by construction.
        const parsed = JSON.parse(raw) as StateValue;
        if (type === 'array' && Array.isArray(parsed)) return parsed;
        if (type === 'object' && parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed;
        }
      } catch {
        // fall through: not valid JSON of the declared shape
      }
      return undefined;
    }
    return raw;
  }

  function update(path: StatePath, raw: string, type: string) {
    const value = coerce(raw, type);
    if (value === undefined) return;
    simulatorStore.setStatePath(path, value);
  }

  function display(value: unknown, type: string): string {
    if (value === undefined || value === null) return '';
    if (type === 'array' || type === 'object') return JSON.stringify(value);
    return String(value);
  }

  async function move(definitionId: StateDefinitionId, delta: -1 | 1) {
    await featureStore.mutate((current) =>
      moveStateDefinitionBy(current, surface.id, definitionId, delta)
    );
  }
</script>

{#if surface.stateDefinitions.length === 0}
  <p class="rounded-md border border-dashed border-neutral-200 bg-neutral-50/50 p-2 text-center text-[11px] italic text-neutral-500">
    No state on this surface.
  </p>
{:else}
  <ul class="divide-y divide-neutral-100 rounded-md border border-neutral-200">
    {#each surface.stateDefinitions as def, index (def.id)}
      {@const value = readPath(simulatorStore.snapshot, def.path)}
      {@const canMoveUp = index > 0}
      {@const canMoveDown = index < surface.stateDefinitions.length - 1}
      <li class="group flex items-center gap-1.5 px-2 py-1" title={def.path}>
        <div class="min-w-0 flex-1 truncate text-[11px] text-neutral-800">
          {humanizeStatePath(def.path)}
        </div>

        {#if def.type === 'boolean'}
          <select
            class="w-20 shrink-0 rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-[11px] focus:border-brand-500 focus:outline-none"
            value={String(value ?? false)}
            onchange={(e) => update(def.path, (e.target as HTMLSelectElement).value, def.type)}
          >
            <option value="false">No</option>
            <option value="true">Yes</option>
          </select>
        {:else if def.type === 'enum' && def.enumValues}
          <select
            class="w-28 shrink-0 rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-[11px] focus:border-brand-500 focus:outline-none"
            value={String(value ?? '')}
            onchange={(e) => update(def.path, (e.target as HTMLSelectElement).value, def.type)}
          >
            {#each def.enumValues as v}
              <option value={v}>{v}</option>
            {/each}
          </select>
        {:else}
          <input
            type={def.type === 'number' ? 'number' : 'text'}
            class="w-28 shrink-0 rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-[11px] focus:border-brand-500 focus:outline-none"
            value={display(value, def.type)}
            placeholder={def.type === 'array' ? '[]' : def.type === 'object' ? '{}' : ''}
            onchange={(e) => update(def.path, (e.target as HTMLInputElement).value, def.type)}
          />
        {/if}

        <div class="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            class="rounded px-0.5 text-[10px] text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 disabled:cursor-not-allowed disabled:opacity-30"
            onclick={() => move(def.id, -1)}
            disabled={!canMoveUp}
            aria-label="Move up"
            title="Move up"
          >
            ▲
          </button>
          <button
            type="button"
            class="rounded px-0.5 text-[10px] text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 disabled:cursor-not-allowed disabled:opacity-30"
            onclick={() => move(def.id, 1)}
            disabled={!canMoveDown}
            aria-label="Move down"
            title="Move down"
          >
            ▼
          </button>
        </div>
      </li>
    {/each}
  </ul>
{/if}
