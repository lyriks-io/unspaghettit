<script lang="ts">
  import type { Feature } from '$features/behavior-model/domain/entities/Feature';
  import type { StateType, StateValue } from '$features/behavior-model/domain/value-objects/StateValue';
  import type {
    StateVariable,
    StateVariableProjection
  } from '$features/projects/domain/entities/StateVariable';
  import { statePathFromName } from '$features/behavior-model/domain/value-objects/humanize';
  import { isStatePath } from '$features/behavior-model/domain/value-objects/StatePath';

  type DeclareInput = {
    path: string;
    type: StateType;
    defaultValue: StateValue;
    description: string;
    owner: StateVariableProjection;
  };

  type Props = {
    features: readonly Feature[];
    stateVariables: readonly StateVariable[];
    saving: boolean;
    onDeclare: (input: DeclareInput) => void | Promise<void>;
    onUpdate: (id: string, patch: Partial<Omit<StateVariable, 'id'>>) => void | Promise<void>;
    onRemove: (id: string) => void | Promise<void>;
  };

  let { features, stateVariables, saving, onDeclare, onUpdate, onRemove }: Props = $props();

  const STATE_TYPES: readonly StateType[] = ['string', 'number', 'boolean', 'enum', 'object', 'array'];

  function defaultForType(type: StateType): StateValue {
    if (type === 'number') return 0;
    if (type === 'boolean') return false;
    if (type === 'object') return {};
    if (type === 'array') return [];
    return '';
  }

  // Owner surfaces per feature, for the two linked dropdowns.
  const ownerFeature = $derived(features.find((f) => String(f.id) === ownerFeatureId) ?? null);
  const ownerSurfaces = $derived(ownerFeature?.surfaces ?? []);

  // How many surfaces across the project project each canonical (by explicit
  // back-ref id or by matching path) — so a declared-but-unused identity reads
  // as such instead of looking adopted.
  function usageCount(state: StateVariable): number {
    let count = 0;
    for (const feature of features) {
      for (const surface of feature.surfaces) {
        for (const def of surface.stateDefinitions) {
          if (
            (def.stateVariableId && String(def.stateVariableId) === String(state.id)) ||
            String(def.path) === String(state.path)
          ) {
            count += 1;
          }
        }
      }
    }
    return count;
  }

  let nameDraft = $state('');
  let typeDraft = $state<StateType>('string');
  let descriptionDraft = $state('');
  let ownerFeatureId = $state('');
  let ownerSurfaceId = $state('');
  let createError = $state<string | null>(null);

  const derivedPath = $derived(statePathFromName(nameDraft));
  const showDerived = $derived(nameDraft.trim().length > 0 && derivedPath !== nameDraft.trim());

  const existingPaths = $derived(new Set(stateVariables.map((s) => String(s.path))));

  async function declare() {
    createError = null;
    const path = derivedPath;
    if (path.length === 0) {
      createError = 'Type a name first.';
      return;
    }
    if (!isStatePath(path)) {
      createError = 'Could not derive a valid path. Try "Cart item count" or type cart.itemCount.';
      return;
    }
    if (existingPaths.has(path)) {
      createError = `"${path}" already has a canonical identity in this project.`;
      return;
    }
    if (descriptionDraft.trim().length === 0) {
      createError = 'Add a description so the shared identity is clear.';
      return;
    }
    if (!ownerFeatureId || !ownerSurfaceId) {
      createError = 'Pick the feature and surface that owns this state.';
      return;
    }
    await onDeclare({
      path,
      type: typeDraft,
      defaultValue: defaultForType(typeDraft),
      description: descriptionDraft.trim(),
      owner: {
        featureId: ownerFeatureId as StateVariableProjection['featureId'],
        surfaceId: ownerSurfaceId as StateVariableProjection['surfaceId']
      }
    });
    nameDraft = '';
    descriptionDraft = '';
    ownerSurfaceId = '';
  }

  function ownerLabel(state: StateVariable): string {
    const feature = features.find((f) => String(f.id) === String(state.owner.featureId));
    const surface = feature?.surfaces.find((s) => String(s.id) === String(state.owner.surfaceId));
    return feature ? `${feature.name}${surface ? ` · ${surface.name}` : ''}` : 'Unknown owner';
  }
</script>

<section class="mb-5 rounded-lg border border-hairline bg-white p-4">
  <div class="mb-3 flex flex-wrap items-end justify-between gap-2">
    <div>
      <h2 class="text-sm font-semibold text-slate-950">Canonical state variables</h2>
      <p class="mt-0.5 max-w-2xl text-xs text-slate-500">
        Reusable state identities for this project. Declare one here, then bind a surface's state to
        it from the feature's <span class="font-medium">States</span> editor ("Reuse from project") so
        the same value has one shared definition across features.
      </p>
    </div>
    <span class="text-xs text-slate-500">{stateVariables.length} declared</span>
  </div>

  <!-- Declare form -->
  <div class="rounded-lg border border-slate-200 bg-slate-50/60 p-2.5">
    <div class="flex flex-col gap-2 lg:flex-row lg:items-end">
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
              declare();
            }
          }}
        />
        {#if showDerived}
          <span class="mono mt-1 block text-[10px] text-slate-500" title="Canonical state path">
            → {derivedPath}
          </span>
        {/if}
      </label>
      <label class="block w-28 text-xs font-medium text-slate-600">
        Type
        <select
          bind:value={typeDraft}
          class="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm outline-none focus:border-slate-900"
        >
          {#each STATE_TYPES as type (type)}
            <option value={type}>{type}</option>
          {/each}
        </select>
      </label>
      <label class="block w-40 text-xs font-medium text-slate-600">
        Owner feature
        <select
          bind:value={ownerFeatureId}
          onchange={() => (ownerSurfaceId = '')}
          class="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm outline-none focus:border-slate-900"
        >
          <option value="">Select…</option>
          {#each features as feature (feature.id)}
            <option value={String(feature.id)}>{feature.name}</option>
          {/each}
        </select>
      </label>
      <label class="block w-40 text-xs font-medium text-slate-600">
        Owner surface
        <select
          bind:value={ownerSurfaceId}
          disabled={!ownerFeatureId}
          class="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm outline-none focus:border-slate-900 disabled:opacity-50"
        >
          <option value="">Select…</option>
          {#each ownerSurfaces as surface (surface.id)}
            <option value={String(surface.id)}>{surface.name}</option>
          {/each}
        </select>
      </label>
    </div>
    <div class="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
      <label class="block flex-1 text-xs font-medium text-slate-600">
        Description
        <input
          type="text"
          bind:value={descriptionDraft}
          placeholder="What does this shared state represent?"
          class="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900"
        />
      </label>
      <button
        type="button"
        class="h-9 inline-flex items-center gap-1 rounded-md bg-slate-900 px-3 text-xs font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
        onclick={declare}
        disabled={saving || derivedPath.length === 0}
      >
        <span class="text-base leading-none">+</span> Declare
      </button>
    </div>
    {#if createError}
      <p class="mt-2 text-xs text-red-600">{createError}</p>
    {/if}
  </div>

  {#if stateVariables.length > 0}
    <ul class="mt-3 divide-y divide-slate-100 rounded-lg border border-hairline">
      {#each stateVariables as state (state.id)}
        {@const uses = usageCount(state)}
        <li class="flex items-start gap-3 px-3 py-2">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class="mono text-sm font-medium text-slate-900">{state.path}</span>
              <span class="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">{state.type}</span>
              <span
                class="rounded-full px-2 py-0.5 text-[10px] font-medium {uses > 0
                  ? 'bg-brand-50 text-brand-700'
                  : 'bg-amber-50 text-amber-700'}"
                title="Surfaces that project this canonical"
              >
                {uses > 0 ? `used in ${uses} surface${uses === 1 ? '' : 's'}` : 'declared, unused'}
              </span>
            </div>
            <input
              type="text"
              value={state.description}
              onblur={(e) => {
                const next = (e.target as HTMLInputElement).value.trim();
                if (next && next !== state.description) onUpdate(String(state.id), { description: next });
              }}
              class="mt-1 w-full max-w-2xl rounded-md border border-transparent bg-transparent px-1 py-0.5 text-xs text-slate-600 outline-none hover:border-slate-200 focus:border-slate-300 focus:bg-white"
            />
            <p class="mt-0.5 text-[10px] text-slate-400">Owned by {ownerLabel(state)}</p>
          </div>
          <button
            type="button"
            class="rounded px-2 py-1 text-xs text-slate-400 hover:bg-red-50 hover:text-red-600"
            onclick={() => onRemove(String(state.id))}
            disabled={saving}
            aria-label={`Remove canonical ${String(state.path)}`}
          >
            Remove
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>
