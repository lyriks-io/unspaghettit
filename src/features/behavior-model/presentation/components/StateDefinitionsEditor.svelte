<script lang="ts">
  import type { Surface } from '$features/behavior-model/domain/entities/Surface';
  import type {
    StateDefinitionId,
    SurfaceId
  } from '$features/behavior-model/domain/value-objects/ids';
  import type { StateType } from '$features/behavior-model/domain/value-objects/StateValue';
  import type { StateValue } from '$features/behavior-model/domain/value-objects/StateValue';
  import { isStatePath } from '$features/behavior-model/domain/value-objects/StatePath';
  import { featureStore } from '$features/behavior-model/presentation/stores/featureStore.svelte';
  import {
    addStateDefinition,
    removeStateDefinition,
    updateStateDefinition
  } from '$features/behavior-model/domain/services/FeatureTransforms';
  import { newStateDefinition } from '$features/behavior-model/presentation/view-models/factories';
  import { cryptoIdGenerator } from '$shared/domain/IdGenerator';
  import {
    humanizeStatePath,
    statePathFromName
  } from '$features/behavior-model/domain/value-objects/humanize';
  import { emit } from '$shared/events/eventBus';

  type Props = { surface: Surface; surfaces?: readonly Surface[] };
  let { surface, surfaces = [surface] }: Props = $props();

  let nameDraft = $state('');
  let typeDraft = $state<StateType>('string');
  let createError = $state<string | null>(null);
  let defaultErrors = $state<Record<string, string>>({});

  // Auto-derived dot path. Only shown when the user typed something other
  // than a canonical path, so power users typing "cart.itemCount" directly
  // don't see redundant noise.
  const derivedPath = $derived(statePathFromName(nameDraft));
  const showDerived = $derived(
    nameDraft.trim().length > 0 && derivedPath !== nameDraft.trim()
  );
  const otherSurfaces = $derived(surfaces.filter((s) => s.id !== surface.id));
  const incomingShared = $derived.by(() =>
    surfaces
      .filter((s) => s.id !== surface.id)
      .flatMap((source) =>
        source.stateDefinitions
          .filter((def) => def.sharedWith?.includes(surface.id))
          .map((def) => ({ source, def }))
      )
  );

  async function add() {
    createError = null;
    const path = derivedPath;
    if (path.length === 0) {
      createError = 'Type a name first.';
      return;
    }
    if (!isStatePath(path)) {
      createError =
        'Could not derive a valid path. Try "Cart item count" or type the path directly (cart.itemCount).';
      return;
    }
    if (surface.stateDefinitions.some((d) => d.path === path)) {
      createError = `State "${path}" is already defined on this surface.`;
      return;
    }
    const def = newStateDefinition(cryptoIdGenerator, {
      path,
      type: typeDraft
    });
    await featureStore.mutate((current) => addStateDefinition(current, surface.id, def));
    emit('editor.state.added', {
      surfaceId: String(surface.id),
      path,
      type: typeDraft
    });
    nameDraft = '';
  }

  async function remove(id: StateDefinitionId) {
    await featureStore.mutate((current) => removeStateDefinition(current, surface.id, id));
  }

  function defaultForType(type: StateType): StateValue {
    if (type === 'number') return 0;
    if (type === 'boolean') return false;
    if (type === 'object') return {};
    if (type === 'array') return [];
    return '';
  }

  function parseValue(raw: string, type: StateType): StateValue {
    if (type === 'number') {
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new Error('Use a finite number.');
      return value;
    }
    if (type === 'boolean') return raw === 'true';
    if (type === 'object' || type === 'array') {
      const value = JSON.parse(raw);
      if (type === 'object' && (value === null || typeof value !== 'object' || Array.isArray(value))) {
        throw new Error('Use a JSON object, for example {"enabled":true}.');
      }
      if (type === 'array' && !Array.isArray(value)) {
        throw new Error('Use a JSON array, for example [].');
      }
      return value as StateValue;
    }
    return raw;
  }

  async function updateDefault(id: StateDefinitionId, raw: string, type: StateType) {
    let value: StateValue;
    try {
      value = parseValue(raw, type);
      defaultErrors = { ...defaultErrors, [id]: '' };
    } catch (error) {
      defaultErrors = {
        ...defaultErrors,
        [id]: error instanceof Error ? error.message : 'Invalid default value.'
      };
      return;
    }
    await featureStore.mutate((current) =>
      updateStateDefinition(current, surface.id, id, { defaultValue: value })
    );
  }

  async function updateType(id: StateDefinitionId, type: StateType) {
    await featureStore.mutate((current) =>
      updateStateDefinition(current, surface.id, id, {
        type,
        defaultValue: defaultForType(type),
        enumValues: type === 'enum' ? [] : undefined
      })
    );
  }

  async function updateEnumValues(id: StateDefinitionId, raw: string) {
    const enumValues = raw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    await featureStore.mutate((current) =>
      updateStateDefinition(current, surface.id, id, { enumValues })
    );
  }

  async function updateSharedWith(id: StateDefinitionId, targetId: SurfaceId, checked: boolean) {
    const def = surface.stateDefinitions.find((d) => d.id === id);
    if (!def) return;
    const next = new Set<SurfaceId>(def.sharedWith ?? []);
    if (checked) next.add(targetId);
    else next.delete(targetId);
    const sharedWith = [...next];
    await featureStore.mutate((current) =>
      updateStateDefinition(current, surface.id, id, {
        sharedWith: sharedWith.length > 0 ? sharedWith : undefined
      })
    );
  }
</script>

<div class="space-y-3">
  <!-- Inline create. Friendly name in, canonical dot path derived. -->
  <div class="rounded-lg border border-slate-200 bg-slate-50/60 p-2.5">
    <div class="flex flex-col gap-2 sm:flex-row sm:items-end">
      <label class="block flex-1 text-xs font-medium text-slate-600">
        Name
        <input
          type="text"
          bind:value={nameDraft}
          placeholder="Cart item count"
          class="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900"
          onkeydown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        {#if showDerived}
          <span class="mono mt-1 block text-[10px] text-slate-500" title="Canonical state path">
            → {derivedPath}
          </span>
        {/if}
      </label>
      <label class="block w-32 text-xs font-medium text-slate-600">
        Type
        <select
          bind:value={typeDraft}
          class="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm outline-none focus:border-slate-900"
        >
          <option value="string">string</option>
          <option value="number">number</option>
          <option value="boolean">boolean</option>
          <option value="enum">enum</option>
          <option value="object">object</option>
          <option value="array">array</option>
        </select>
      </label>
      <button
        type="button"
        class="h-9 inline-flex items-center gap-1 rounded-md bg-slate-900 px-3 text-xs font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
        onclick={add}
        disabled={derivedPath.length === 0}
      >
        <span class="text-base leading-none">+</span> Add state
      </button>
    </div>
    {#if createError}
      <p class="mt-2 text-xs text-red-600">{createError}</p>
    {/if}
  </div>

  {#if surface.stateDefinitions.length === 0}
    <div class="rounded-lg border border-dashed border-slate-300 bg-slate-50/30 p-6 text-center">
      <p class="text-sm font-medium text-slate-700">No state defined yet</p>
      <p class="mx-auto mt-1 max-w-sm text-xs text-slate-500">
        State is the typed data this surface reads and writes. Rules and effects refer to it
        by its dotted path. Add a slot above to get started.
      </p>
    </div>
  {:else}
    <ul class="divide-y divide-slate-100 rounded-lg border border-hairline bg-white">
      {#each surface.stateDefinitions as def (def.id)}
        <li class="px-3 py-2 text-sm">
          <div class="flex items-center gap-2">
            <div class="min-w-0 flex-1">
              <div class="truncate text-slate-950">{humanizeStatePath(def.path)}</div>
              <div class="mono truncate text-[10px] text-slate-400" title="Canonical state path">
                {def.path}
              </div>
            </div>
            <select
              class="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-xs"
              value={def.type}
              onchange={(e) => updateType(def.id, (e.target as HTMLSelectElement).value as StateType)}
            >
              <option value="string">string</option>
              <option value="number">number</option>
              <option value="boolean">boolean</option>
              <option value="enum">enum</option>
              <option value="object">object</option>
              <option value="array">array</option>
            </select>
            {#if def.type === 'boolean'}
              <select
                class="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-xs"
                value={String(def.defaultValue)}
                onchange={(e) => updateDefault(def.id, (e.target as HTMLSelectElement).value, def.type)}
              >
                <option value="false">false</option>
                  <option value="true">true</option>
              </select>
            {:else if def.type === 'object' || def.type === 'array'}
              <textarea
                class="mono min-h-16 w-48 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
                value={JSON.stringify(def.defaultValue ?? defaultForType(def.type), null, 2)}
                onchange={(e) =>
                  updateDefault(def.id, (e.target as HTMLTextAreaElement).value, def.type)}
              ></textarea>
            {:else}
              <input
                type={def.type === 'number' ? 'number' : 'text'}
                class="w-32 rounded-md border border-slate-300 bg-white px-2 py-0.5 text-xs"
                value={String(def.defaultValue ?? '')}
                onchange={(e) => updateDefault(def.id, (e.target as HTMLInputElement).value, def.type)}
              />
            {/if}
            <button
              type="button"
              class="rounded px-2 py-1 text-xs text-slate-400 hover:bg-red-50 hover:text-red-600"
              onclick={() => remove(def.id)}
              aria-label="Remove state"
            >
              x
            </button>
          </div>
          <div class="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label class="block text-[11px] font-medium text-slate-600">
              Description
              <input
                type="text"
                class="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
                value={def.description ?? ''}
                placeholder="What does this state represent?"
                onblur={(e) =>
                  featureStore.mutate((current) =>
                    updateStateDefinition(current, surface.id, def.id, {
                      description: (e.target as HTMLInputElement).value || undefined
                    })
                  )}
              />
            </label>
            {#if def.type === 'enum'}
              <label class="block text-[11px] font-medium text-slate-600">
                Enum values
                <input
                  type="text"
                  class="mono mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
                  value={(def.enumValues ?? []).join(', ')}
                  placeholder="draft, published, archived"
                  onblur={(e) =>
                    updateEnumValues(def.id, (e.target as HTMLInputElement).value)}
                />
              </label>
            {/if}
          </div>
          {#if defaultErrors[def.id]}
            <p class="mt-1 text-xs text-red-600">{defaultErrors[def.id]}</p>
          {/if}
          {#if otherSurfaces.length > 0}
            <div class="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2">
              <span class="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                Shared with
              </span>
              {#each otherSurfaces as other (other.id)}
                <label class="inline-flex max-w-full items-center gap-1 rounded-md border border-hairline px-2 py-1 text-[11px] text-slate-700">
                  <input
                    type="checkbox"
                    checked={def.sharedWith?.includes(other.id) ?? false}
                    aria-label={`Share ${String(def.path)} with ${other.name}`}
                    onchange={(e) =>
                      updateSharedWith(
                        def.id,
                        other.id,
                        (e.target as HTMLInputElement).checked
                      )}
                  />
                  <span class="truncate">{other.name}</span>
                </label>
              {/each}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if incomingShared.length > 0}
    <section class="rounded-md border border-emerald-200 bg-emerald-50/50 p-3">
      <h3 class="text-xs font-semibold text-emerald-900">Shared onto this surface</h3>
      <ul class="mt-2 space-y-1">
        {#each incomingShared as item (`${item.source.id}:${item.def.id}`)}
          <li class="flex items-center justify-between gap-3 text-xs">
            <span class="min-w-0">
              <span class="text-slate-950">{humanizeStatePath(item.def.path)}</span>
              <span class="mono ml-1 text-[10px] text-slate-500">{item.def.path}</span>
            </span>
            <span class="shrink-0 text-[11px] text-emerald-800">{item.source.name}</span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</div>
