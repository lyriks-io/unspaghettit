<script lang="ts">
  import type { Resource } from '$features/behavior-model/domain/entities/Resource';
  import type { Surface } from '$features/behavior-model/domain/entities/Surface';
  import type { Action } from '$features/behavior-model/domain/entities/Action';
  import type { Parameter } from '$features/behavior-model/domain/entities/Parameter';
  import type { ParameterId, ResourceId } from '$features/behavior-model/domain/value-objects/ids';
  import { asParameterId, asResourceId } from '$features/behavior-model/domain/value-objects/ids';
  import {
    PARAMETER_TYPES,
    parameterTypeToStateType
  } from '$features/behavior-model/domain/value-objects/ParameterType';
  import type { StateValue } from '$features/behavior-model/domain/value-objects/StateValue';
  import {
    resourceKindLabel,
    sensitivityLabel
  } from '$features/behavior-model/domain/value-objects/Resource';
  import { tick } from 'svelte';
  import { featureStore } from '$features/behavior-model/presentation/stores/featureStore.svelte';
  import {
    updateAction,
    updateParameter
  } from '$features/behavior-model/domain/services/FeatureTransforms';
  import { cryptoIdGenerator } from '$shared/domain/IdGenerator';
  import ParameterValidationsEditor from './ParameterValidationsEditor.svelte';
  import StatePathSelect from './StatePathSelect.svelte';
  import {
    asStatePath,
    isStatePath
  } from '$features/behavior-model/domain/value-objects/StatePath';

  type Props = {
    surface: Surface;
    action: Action;
    resources: readonly Resource[];
  };
  let { surface, action, resources }: Props = $props();

  let expandedId = $state<ParameterId | null>(null);
  let defaultErrors = $state<Record<string, string>>({});

  const availablePaths = $derived(surface.stateDefinitions.map((d) => d.path));

  async function add() {
    const parameter: Parameter = {
      id: asParameterId(cryptoIdGenerator()),
      name: '',
      type: 'string',
      required: true
    };
    await featureStore.mutate((current) =>
      updateAction(current, surface.id, action.id, {
        parameters: [...action.parameters, parameter]
      })
    );
    expandedId = parameter.id;
    // Focus the name input of the just-added row so the user can type
    // straight away without clicking.
    await tick();
    const input = document.querySelector<HTMLInputElement>(
      `[data-parameter-id="${parameter.id}"] input[type="text"]`
    );
    input?.focus();
  }

  async function update(id: ParameterId, patch: Partial<Parameter>) {
    await featureStore.mutate((current) =>
      updateParameter(current, surface.id, action.id, id, patch)
    );
  }

  async function remove(id: ParameterId) {
    await featureStore.mutate((current) =>
      updateAction(current, surface.id, action.id, {
        parameters: action.parameters.filter((p) => p.id !== id)
      })
    );
  }

  function setBinding(parameter: Parameter, raw: string) {
    if (raw.length === 0) {
      update(parameter.id, { bindToStatePath: undefined });
      return;
    }
    if (!isStatePath(raw)) return;
    update(parameter.id, { bindToStatePath: asStatePath(raw) });
  }

  function setResource(parameter: Parameter, raw: string) {
    if (raw.length === 0) {
      update(parameter.id, { resourceId: undefined });
      return;
    }
    update(parameter.id, { resourceId: asResourceId(raw) });
  }

  function findResource(id: ResourceId | undefined): Resource | undefined {
    if (!id) return undefined;
    return resources.find((r) => r.id === id);
  }

  function parseDefaultValue(parameter: Parameter, raw: string): StateValue {
    const stateType = parameterDefaultShape(parameter);
    if (stateType === 'number') {
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new Error('Use a finite number.');
      return value;
    }
    if (stateType === 'boolean') return raw === 'true';
    if (stateType === 'object' || stateType === 'array') {
      const value = JSON.parse(raw);
      if (stateType === 'object' && (value === null || typeof value !== 'object' || Array.isArray(value))) {
        throw new Error('Use a JSON object.');
      }
      if (stateType === 'array' && !Array.isArray(value)) {
        throw new Error('Use a JSON array.');
      }
      return value as StateValue;
    }
    return raw;
  }

  async function updateDefaultValue(parameter: Parameter, raw: string) {
    try {
      const defaultValue = parseDefaultValue(parameter, raw);
      defaultErrors = { ...defaultErrors, [parameter.id]: '' };
      await update(parameter.id, { defaultValue });
    } catch (error) {
      defaultErrors = {
        ...defaultErrors,
        [parameter.id]: error instanceof Error ? error.message : 'Invalid default value.'
      };
    }
  }

  async function updateEnumValues(parameter: Parameter, raw: string) {
    const enumValues = raw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    await update(parameter.id, { enumValues });
  }

  function parameterDefaultShape(parameter: Parameter) {
    return parameterTypeToStateType(parameter.type);
  }
</script>

<div class="space-y-2">
  <button
    type="button"
    class="rounded-md border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50"
    onclick={add}
  >
    + Parameter
  </button>

  {#if action.parameters.length === 0}
    <p class="rounded-md border border-dashed border-neutral-300 p-3 text-center text-xs text-neutral-500">
      No parameters.
    </p>
  {:else}
    <ul class="space-y-2">
      {#each action.parameters as parameter (parameter.id)}
        {@const isExpanded = expandedId === parameter.id}
        {@const validationCount = parameter.validations?.length ?? 0}
        <li
          data-parameter-id={parameter.id}
          class="rounded-md border bg-white {isExpanded
            ? 'border-brand-300 ring-1 ring-brand-200'
            : 'border-neutral-200'}"
        >
          <header class="flex flex-wrap items-center gap-2 px-2 py-1 text-xs">
            <button
              type="button"
              class="text-neutral-400 hover:text-neutral-700"
              onclick={() => (expandedId = isExpanded ? null : parameter.id)}
              aria-label={isExpanded ? 'Collapse' : 'Expand'}
            >
              {isExpanded ? '▾' : '▸'}
            </button>
            <input
              type="text"
              class="mono rounded-md border border-neutral-300 px-2 py-0.5 text-xs"
              value={parameter.name}
              onblur={(e) => update(parameter.id, { name: (e.target as HTMLInputElement).value })}
            />
            <select
              class="rounded-md border border-neutral-300 px-2 py-0.5 text-xs"
              value={parameter.type}
              onchange={(e) =>
                update(parameter.id, {
                  type: (e.target as HTMLSelectElement).value as Parameter['type']
                })}
            >
              {#each PARAMETER_TYPES as type}
                <option value={type}>{type}</option>
              {/each}
            </select>
            <label class="flex items-center gap-1 text-neutral-600">
              <input
                type="checkbox"
                checked={parameter.required}
                onchange={(e) =>
                  update(parameter.id, { required: (e.target as HTMLInputElement).checked })}
              />
              required
            </label>
            {#if validationCount > 0}
              <span class="rounded-md bg-sky-50 px-1.5 py-0.5 text-[10px] text-sky-800">
                {validationCount} validation{validationCount === 1 ? '' : 's'}
              </span>
            {/if}
            {#if parameter.bindToStatePath}
              <span class="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-800">
                bound
              </span>
            {/if}
            {#if findResource(parameter.resourceId)}
              {@const r = findResource(parameter.resourceId)}
              <span
                class="rounded-md bg-violet-50 px-1.5 py-0.5 text-[10px] text-violet-800"
                title={r?.provider ?? ''}>{r?.name}</span
              >
            {/if}
            <button
              type="button"
              class="ml-auto text-neutral-400 hover:text-red-600"
              onclick={() => remove(parameter.id)}
              aria-label="Remove parameter"
            >
              ✕
            </button>
          </header>

          {#if isExpanded}
            <div class="space-y-3 border-t border-neutral-200 p-3 text-xs">
              <label class="block">
                <span class="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                  Description
                </span>
                <input
                  type="text"
                  class="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1 text-xs"
                  value={parameter.description ?? ''}
                  placeholder="What does this parameter mean?"
                  onblur={(e) =>
                    update(parameter.id, {
                      description: (e.target as HTMLInputElement).value || undefined
                    })}
                  />
              </label>

              <section class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label class="block">
                  <span class="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                    Default value
                  </span>
                  {#if parameterDefaultShape(parameter) === 'boolean'}
                    <select
                      class="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1 text-xs"
                      value={String(parameter.defaultValue ?? false)}
                      onchange={(e) =>
                        updateDefaultValue(parameter, (e.target as HTMLSelectElement).value)}
                    >
                      <option value="false">false</option>
                      <option value="true">true</option>
                    </select>
                  {:else if parameterDefaultShape(parameter) === 'object' || parameterDefaultShape(parameter) === 'array'}
                    <textarea
                      class="mono mt-1 min-h-16 w-full rounded-md border border-neutral-300 px-2 py-1 text-xs"
                      value={JSON.stringify(
                        parameter.defaultValue ??
                          (parameterDefaultShape(parameter) === 'array' ? [] : {}),
                        null,
                        2
                      )}
                      onblur={(e) =>
                        updateDefaultValue(parameter, (e.target as HTMLTextAreaElement).value)}
                    ></textarea>
                  {:else}
                    <input
                      type={parameterDefaultShape(parameter) === 'number' ? 'number' : 'text'}
                      class="mono mt-1 w-full rounded-md border border-neutral-300 px-2 py-1 text-xs"
                      value={String(parameter.defaultValue ?? '')}
                      placeholder="optional default"
                      onblur={(e) =>
                        updateDefaultValue(parameter, (e.target as HTMLInputElement).value)}
                    />
                  {/if}
                  {#if defaultErrors[parameter.id]}
                    <span class="mt-1 block text-[10px] text-red-600">
                      {defaultErrors[parameter.id]}
                    </span>
                  {/if}
                </label>
                {#if parameter.type === 'enum'}
                  <label class="block">
                    <span class="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                      Enum values
                    </span>
                    <input
                      type="text"
                      class="mono mt-1 w-full rounded-md border border-neutral-300 px-2 py-1 text-xs"
                      value={(parameter.enumValues ?? []).join(', ')}
                      placeholder="small, medium, large"
                      onblur={(e) =>
                        updateEnumValues(parameter, (e.target as HTMLInputElement).value)}
                    />
                  </label>
                {/if}
              </section>

              <section>
                <header class="mb-1 flex items-center gap-2">
                  <span class="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                    Bind to state
                  </span>
                  {#if parameter.bindToStatePath}
                    <button
                      type="button"
                      class="text-[10px] text-neutral-400 hover:text-red-600"
                      onclick={() => setBinding(parameter, '')}
                    >
                      clear
                    </button>
                  {/if}
                </header>
                <p class="mb-1 text-[11px] text-neutral-500 leading-snug">
                  When the action runs, the parameter value is written into this state path
                  before rules evaluate. Useful for "the user picked X → store X in state".
                </p>
                {#if parameter.bindToStatePath || availablePaths.length > 0}
                  <StatePathSelect
                    value={parameter.bindToStatePath ?? ''}
                    {availablePaths}
                    onCommit={(raw) => setBinding(parameter, raw)}
                  />
                {:else}
                  <p class="text-[11px] text-neutral-400">
                    Define some state on the surface to make bindings available.
                  </p>
                {/if}
              </section>

              <section>
                <header class="mb-1 flex items-center gap-2">
                  <span class="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                    Linked resource
                  </span>
                  {#if parameter.resourceId}
                    <button
                      type="button"
                      class="text-[10px] text-neutral-400 hover:text-red-600"
                      onclick={() => setResource(parameter, '')}
                    >
                      clear
                    </button>
                  {/if}
                </header>
                <p class="mb-1 text-[11px] leading-snug text-neutral-500">
                  Where this parameter's value comes from or is persisted to. Define resources in
                  the Resources tab.
                </p>
                {#if resources.length === 0}
                  <p class="text-[11px] text-neutral-400">
                    No resources defined yet. Add some in the Resources tab.
                  </p>
                {:else}
                  <select
                    class="w-full rounded-md border border-neutral-300 px-2 py-1 text-xs"
                    value={parameter.resourceId ?? ''}
                    onchange={(e) => setResource(parameter, (e.target as HTMLSelectElement).value)}
                  >
                    <option value="">- No resource -</option>
                    {#each resources as r (r.id)}
                      <option value={r.id}>
                        {r.name} ({resourceKindLabel(r.kind)} · {sensitivityLabel(r.sensitivity)})
                      </option>
                    {/each}
                  </select>
                  {@const linked = findResource(parameter.resourceId)}
                  {#if linked}
                    <p class="mt-1 text-[11px] text-neutral-500">
                      {linked.provider}{linked.location ? ` · ${linked.location}` : ''}
                      {#if linked.containsPii}<span class="ml-1 text-red-700">· PII</span>{/if}
                      {#if linked.complianceTags.length > 0}
                        <span class="ml-1 mono text-neutral-500"
                          >· {linked.complianceTags.join(', ')}</span
                        >
                      {/if}
                    </p>
                  {/if}
                {/if}
              </section>

              <section>
                <header class="mb-1 text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                  Validations
                </header>
                <ParameterValidationsEditor
                  {parameter}
                  onChange={(next) => update(parameter.id, next)}
                />
              </section>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>
