<script lang="ts">
  import type {
    Persona,
    PersonaParameterOverride,
    PersonaStateOverride
  } from '$features/behavior-model/domain/entities/Persona';
  import {
    isStatePath,
    asStatePath,
    type StatePath
  } from '$features/behavior-model/domain/value-objects/StatePath';
  import type { StateValue } from '$features/behavior-model/domain/value-objects/StateValue';
  import StatePathSelect from './StatePathSelect.svelte';
  import ParameterNameSelect from './ParameterNameSelect.svelte';

  type Props = {
    persona: Persona;
    availablePaths: readonly StatePath[];
    availableParameterNames: readonly string[];
    onChange: (next: Persona) => void;
  };
  let { persona, availablePaths, availableParameterNames, onChange }: Props = $props();

  function patch(p: Partial<Persona>) {
    onChange({ ...persona, ...p });
  }

  function coerce(raw: string): StateValue {
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    if (raw === '') return '';
    if (!Number.isNaN(Number(raw)) && raw.trim() !== '') return Number(raw);
    return raw;
  }

  // ── State overrides ────────────────────────────────────────────────────
  function addStateOverride() {
    const seed = availablePaths[0] ?? asStatePath('state.path');
    patch({
      stateOverrides: [...persona.stateOverrides, { path: seed, value: '' }]
    });
  }

  function updateStateOverride(index: number, next: PersonaStateOverride) {
    patch({
      stateOverrides: persona.stateOverrides.map((o, i) => (i === index ? next : o))
    });
  }

  function removeStateOverride(index: number) {
    patch({ stateOverrides: persona.stateOverrides.filter((_, i) => i !== index) });
  }

  function setStateOverridePath(index: number, raw: string) {
    if (!isStatePath(raw)) return;
    const current = persona.stateOverrides[index];
    if (!current) return;
    updateStateOverride(index, { ...current, path: asStatePath(raw) });
  }

  function setStateOverrideValue(index: number, raw: string) {
    const current = persona.stateOverrides[index];
    if (!current) return;
    updateStateOverride(index, { ...current, value: coerce(raw) });
  }

  // ── Parameter overrides ────────────────────────────────────────────────
  function addParameterOverride() {
    const seed = availableParameterNames[0] ?? 'param';
    patch({
      parameterOverrides: [
        ...persona.parameterOverrides,
        { parameterName: seed, value: '' }
      ]
    });
  }

  function updateParameterOverride(index: number, next: PersonaParameterOverride) {
    patch({
      parameterOverrides: persona.parameterOverrides.map((o, i) => (i === index ? next : o))
    });
  }

  function removeParameterOverride(index: number) {
    patch({ parameterOverrides: persona.parameterOverrides.filter((_, i) => i !== index) });
  }

  function setParameterName(index: number, raw: string) {
    const current = persona.parameterOverrides[index];
    if (!current) return;
    updateParameterOverride(index, { ...current, parameterName: raw });
  }

  function setParameterValue(index: number, raw: string) {
    const current = persona.parameterOverrides[index];
    if (!current) return;
    updateParameterOverride(index, { ...current, value: coerce(raw) });
  }
</script>

<div class="space-y-3">
  <div class="grid grid-cols-1 gap-2">
    <label class="block text-xs font-medium text-neutral-600">
      Name
      <input
        type="text"
        class="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1 text-sm"
        value={persona.name}
        onblur={(e) => patch({ name: (e.target as HTMLInputElement).value })}
      />
    </label>
    <label class="block text-xs font-medium text-neutral-600">
      Description
      <textarea
        rows="2"
        class="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1 text-xs"
        value={persona.description ?? ''}
        onblur={(e) =>
          patch({ description: (e.target as HTMLTextAreaElement).value || undefined })}
      ></textarea>
    </label>
    <label class="flex items-start gap-2 rounded-md border border-neutral-200 bg-neutral-50 p-2 text-xs">
      <input
        type="checkbox"
        class="mt-0.5"
        checked={persona.persistAcrossSurfaces ?? false}
        onchange={(e) =>
          patch({
            persistAcrossSurfaces: (e.target as HTMLInputElement).checked || undefined
          })}
      />
      <span class="flex-1">
        <span class="block font-medium text-neutral-800">Persist across surfaces</span>
        <span class="block text-[11px] text-neutral-500">
          Re-apply this persona's state overrides whenever you switch surfaces in the simulator.
          Useful for "this is who I am" personas (e.g. signed-in admin) that should carry over
          the entire flow.
        </span>
      </span>
    </label>
  </div>

  <section>
    <header class="mb-1 flex items-center justify-between">
      <h4 class="text-xs font-semibold uppercase tracking-wide text-neutral-500">
        State overrides ({persona.stateOverrides.length})
      </h4>
      <button
        type="button"
        class="rounded-md border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-50"
        onclick={addStateOverride}
      >
        + Add
      </button>
    </header>
    {#if persona.stateOverrides.length === 0}
      <p class="text-[11px] text-neutral-500">No state overrides. Uses surface defaults.</p>
    {:else}
      <ul class="space-y-2">
        {#each persona.stateOverrides as override, i (i)}
          <li class="flex items-start gap-1.5 text-xs">
            <StatePathSelect
              value={override.path}
              {availablePaths}
              onCommit={(raw) => setStateOverridePath(i, raw)}
            />
            <span class="mt-1.5 text-neutral-500">=</span>
            <input
              type="text"
              class="mono mt-0.5 flex-1 rounded-md border border-neutral-300 px-1.5 py-0.5 text-[11px]"
              value={String(override.value ?? '')}
              onblur={(e) => setStateOverrideValue(i, (e.target as HTMLInputElement).value)}
              placeholder="value"
            />
            <button
              type="button"
              class="mt-1 text-neutral-400 hover:text-red-600"
              onclick={() => removeStateOverride(i)}
              aria-label="Remove override"
            >
              ✕
            </button>
          </li>
        {/each}
      </ul>
    {/if}
    {#if availablePaths.length === 0}
      <p class="mt-1 text-[11px] text-amber-700">
        No state defined yet. Add some on a surface's State tab so personas can target real
        paths.
      </p>
    {/if}
  </section>

  <section>
    <header class="mb-1 flex items-center justify-between">
      <h4 class="text-xs font-semibold uppercase tracking-wide text-neutral-500">
        Parameter values ({persona.parameterOverrides.length})
      </h4>
      <button
        type="button"
        class="rounded-md border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-50"
        onclick={addParameterOverride}
      >
        + Add
      </button>
    </header>
    <p class="mb-1 text-[11px] text-neutral-500">
      Matched against action parameter names. Values are auto-filled when this persona is
      applied in the simulator.
    </p>
    {#if persona.parameterOverrides.length === 0}
      <p class="text-[11px] text-neutral-500">No parameter overrides.</p>
    {:else}
      <ul class="space-y-2">
        {#each persona.parameterOverrides as override, i (i)}
          <li class="flex items-start gap-1.5 text-xs">
            <ParameterNameSelect
              value={override.parameterName}
              availableNames={availableParameterNames}
              onCommit={(raw) => setParameterName(i, raw)}
            />
            <span class="mt-1.5 text-neutral-500">=</span>
            <input
              type="text"
              class="mono mt-0.5 flex-1 rounded-md border border-neutral-300 px-1.5 py-0.5 text-[11px]"
              value={String(override.value ?? '')}
              onblur={(e) => setParameterValue(i, (e.target as HTMLInputElement).value)}
              placeholder="value"
            />
            <button
              type="button"
              class="mt-1 text-neutral-400 hover:text-red-600"
              onclick={() => removeParameterOverride(i)}
              aria-label="Remove parameter"
            >
              ✕
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</div>
