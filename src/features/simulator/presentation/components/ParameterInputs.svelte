<script lang="ts">
  import type { Action } from '$features/behavior-model/domain/entities/Action';
  import type {
    ParameterId,
    SurfaceId
  } from '$features/behavior-model/domain/value-objects/ids';
  import type { StatePath } from '$features/behavior-model/domain/value-objects/StatePath';
  import type { StateValue } from '$features/behavior-model/domain/value-objects/StateValue';
  import type { ParameterType } from '$features/behavior-model/domain/value-objects/ParameterType';
  import { featureStore } from '$features/behavior-model/presentation/stores/featureStore.svelte';
  import { moveParameterBy } from '$features/behavior-model/domain/services/FeatureTransforms';
  import { simulatorStore } from '$features/simulator/presentation/stores/simulatorStore.svelte';

  type Props = { surfaceId: SurfaceId; action: Action };
  let { surfaceId, action }: Props = $props();

  function coerce(raw: string, type: ParameterType): StateValue {
    if (type === 'boolean') return raw === 'true';
    if (type === 'number') {
      const n = Number(raw);
      return Number.isFinite(n) ? n : 0;
    }
    if (type === 'object' || type === 'array') {
      if (raw.trim().length === 0) return type === 'array' ? [] : {};
      try {
        const parsed = JSON.parse(raw) as StateValue;
        return parsed;
      } catch {
        return type === 'array' ? [] : {};
      }
    }
    // date / time / timestamp / url / email / string / enum: keep as string
    return raw;
  }

  function setValue(name: string, value: StateValue, bindToStatePath?: StatePath) {
    simulatorStore.setParameter(name, value, bindToStatePath);
  }

  function update(name: string, raw: string, type: ParameterType, bindToStatePath?: StatePath) {
    setValue(name, coerce(raw, type), bindToStatePath);
  }

  function readGeo(value: unknown): { lat: string; lng: string } {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const v = value as Record<string, unknown>;
      const lat = typeof v.lat === 'number' ? String(v.lat) : '';
      const lng = typeof v.lng === 'number' ? String(v.lng) : '';
      return { lat, lng };
    }
    return { lat: '', lng: '' };
  }

  function updateGeo(
    name: string,
    field: 'lat' | 'lng',
    raw: string,
    current: unknown,
    bindToStatePath?: StatePath
  ) {
    const prev = readGeo(current);
    const merged = { ...prev, [field]: raw };
    const lat = Number(merged.lat);
    const lng = Number(merged.lng);
    const value: StateValue = {
      lat: Number.isFinite(lat) ? lat : 0,
      lng: Number.isFinite(lng) ? lng : 0
    };
    setValue(name, value, bindToStatePath);
  }

  function htmlInputType(type: ParameterType): string {
    switch (type) {
      case 'number':
        return 'number';
      case 'date':
        return 'date';
      case 'time':
        return 'time';
      case 'timestamp':
        return 'datetime-local';
      case 'url':
        return 'url';
      case 'email':
        return 'email';
      default:
        return 'text';
    }
  }

  function jsonString(value: unknown): string {
    if (value === undefined || value === null) return '';
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return '';
    }
  }

  async function move(parameterId: ParameterId, delta: -1 | 1) {
    await featureStore.mutate((current) =>
      moveParameterBy(current, surfaceId, action.id, parameterId, delta)
    );
  }
</script>

<ul class="space-y-1.5">
  {#each action.parameters as parameter, index (parameter.id)}
    {@const canMoveUp = index > 0}
    {@const canMoveDown = index < action.parameters.length - 1}
    <li class="group">
      <div class="mb-0.5 flex items-baseline justify-between gap-2">
        <label
          class="flex items-baseline gap-1.5 text-[11px] font-medium text-neutral-700"
          for="param-{parameter.id}"
        >
          <span>{parameter.name}</span>
          {#if parameter.required}
            <span class="text-red-500" title="Required">*</span>
          {/if}
          <span
            class="rounded-full bg-neutral-100 px-1 py-0 text-[9px] font-medium uppercase tracking-wide text-neutral-600"
          >
            {parameter.type}
          </span>
          {#if parameter.bindToStatePath}
            <span
              class="rounded-full bg-emerald-50 px-1 py-0 text-[9px] font-medium uppercase tracking-wide text-emerald-700"
              title="Bound to {parameter.bindToStatePath}"
            >
              bound
            </span>
          {/if}
        </label>
        <div class="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            class="rounded px-1 text-[10px] text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 disabled:cursor-not-allowed disabled:opacity-30"
            onclick={() => move(parameter.id, -1)}
            disabled={!canMoveUp}
            aria-label={`Move ${parameter.name} up`}
            title="Move up"
          >
            ▲
          </button>
          <button
            type="button"
            class="rounded px-1 text-[10px] text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 disabled:cursor-not-allowed disabled:opacity-30"
            onclick={() => move(parameter.id, 1)}
            disabled={!canMoveDown}
            aria-label={`Move ${parameter.name} down`}
            title="Move down"
          >
            ▼
          </button>
        </div>
      </div>

      {#if parameter.type === 'boolean'}
        <select
          id="param-{parameter.id}"
          class="w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-100"
          onchange={(e) =>
            update(
              parameter.name,
              (e.target as HTMLSelectElement).value,
              parameter.type,
              parameter.bindToStatePath
            )}
        >
          <option value="false" selected={String(simulatorStore.parameters[parameter.name] ?? false) !== 'true'}>No</option>
          <option value="true" selected={String(simulatorStore.parameters[parameter.name] ?? false) === 'true'}>Yes</option>
        </select>
      {:else if parameter.type === 'enum' && parameter.enumValues}
        <select
          id="param-{parameter.id}"
          class="w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-100"
          onchange={(e) =>
            update(
              parameter.name,
              (e.target as HTMLSelectElement).value,
              parameter.type,
              parameter.bindToStatePath
            )}
        >
          <option value="" selected={!simulatorStore.parameters[parameter.name]}></option>
          {#each parameter.enumValues as v}
            <option value={v} selected={v === String(simulatorStore.parameters[parameter.name] ?? '')}>{v}</option>
          {/each}
        </select>
      {:else if parameter.type === 'object' || parameter.type === 'array'}
        <textarea
          id="param-{parameter.id}"
          rows="3"
          placeholder={parameter.description ??
            (parameter.type === 'array' ? '[ ... ]' : '{ ... }')}
          class="w-full rounded-md border border-neutral-300 bg-white px-2 py-1 font-mono text-[11px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-100"
          value={jsonString(simulatorStore.parameters[parameter.name])}
          onchange={(e) =>
            update(
              parameter.name,
              (e.target as HTMLTextAreaElement).value,
              parameter.type,
              parameter.bindToStatePath
            )}
        ></textarea>
      {:else if parameter.type === 'geolocation'}
        {@const geo = readGeo(simulatorStore.parameters[parameter.name])}
        <div class="flex gap-1">
          <input
            id="param-{parameter.id}-lat"
            type="number"
            step="any"
            placeholder="lat"
            class="w-1/2 rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-100"
            value={geo.lat}
            onchange={(e) =>
              updateGeo(
                parameter.name,
                'lat',
                (e.target as HTMLInputElement).value,
                simulatorStore.parameters[parameter.name],
                parameter.bindToStatePath
              )}
          />
          <input
            id="param-{parameter.id}-lng"
            type="number"
            step="any"
            placeholder="lng"
            class="w-1/2 rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-100"
            value={geo.lng}
            onchange={(e) =>
              updateGeo(
                parameter.name,
                'lng',
                (e.target as HTMLInputElement).value,
                simulatorStore.parameters[parameter.name],
                parameter.bindToStatePath
              )}
          />
        </div>
      {:else}
        <input
          id="param-{parameter.id}"
          type={htmlInputType(parameter.type)}
          placeholder={parameter.description ?? `Enter ${parameter.name}`}
          class="w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-100"
          value={String(simulatorStore.parameters[parameter.name] ?? '')}
          onchange={(e) =>
            update(
              parameter.name,
              (e.target as HTMLInputElement).value,
              parameter.type,
              parameter.bindToStatePath
            )}
        />
      {/if}
    </li>
  {/each}
</ul>
