<script lang="ts">
  import type { Feature } from '$features/behavior-model/domain/entities/Feature';
  import type { Persona } from '$features/behavior-model/domain/entities/Persona';
  import type { PersonaId } from '$features/behavior-model/domain/value-objects/ids';
  import { asPersonaId } from '$features/behavior-model/domain/value-objects/ids';
  import {
    addPersona,
    removePersona,
    updatePersona
  } from '$features/behavior-model/domain/services/FeatureTransforms';
  import { featureStore } from '$features/behavior-model/presentation/stores/featureStore.svelte';
  import { cryptoIdGenerator } from '$shared/domain/IdGenerator';
  import PersonaEditor from './PersonaEditor.svelte';

  type Props = { feature: Feature };
  let { feature }: Props = $props();

  let expandedId = $state<PersonaId | null>(null);

  // Pull every state path defined anywhere in the feature and every
  // parameter name used by any action. So persona authors can pick
  // from real, existing identifiers instead of typing free text.
  const availablePaths = $derived.by(() => {
    const seen = new Set<string>();
    const out: (typeof feature.surfaces)[number]['stateDefinitions'][number]['path'][] = [];
    for (const surface of feature.surfaces) {
      for (const def of surface.stateDefinitions) {
        if (seen.has(def.path)) continue;
        seen.add(def.path);
        out.push(def.path);
      }
    }
    return out;
  });

  const availableParameterNames = $derived.by(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const surface of feature.surfaces) {
      for (const cap of surface.actions) {
        for (const param of cap.parameters) {
          if (seen.has(param.name)) continue;
          seen.add(param.name);
          out.push(param.name);
        }
      }
    }
    return out.sort();
  });

  async function add() {
    const persona: Persona = {
      id: asPersonaId(cryptoIdGenerator()),
      name: 'New persona',
      description: '',
      stateOverrides: [],
      parameterOverrides: []
    };
    await featureStore.mutate((current) => addPersona(current, persona));
    expandedId = persona.id;
  }

  async function update(persona: Persona) {
    await featureStore.mutate((current) => updatePersona(current, persona));
  }

  async function remove(id: PersonaId) {
    if (!confirm('Delete this persona?')) return;
    await featureStore.mutate((current) => removePersona(current, id));
  }
</script>

<div class="space-y-3 text-sm">
  <p class="text-xs text-neutral-500">
    Personas are named "fake users" with preset state and parameter values. Pick one in the
    Simulator tab to auto-fill state and action inputs.
  </p>

  <button
    type="button"
    class="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50"
    onclick={add}
  >
    + New persona
  </button>

  {#if feature.personas.length === 0}
    <p class="rounded-md border border-dashed border-neutral-300 p-3 text-center text-xs text-neutral-500">
      No personas yet. Add one to test the simulator with predefined state.
    </p>
  {:else}
    <ul class="space-y-2">
      {#each feature.personas as persona (persona.id)}
        <li class="rounded-md border {expandedId === persona.id ? 'border-brand-300 ring-1 ring-brand-200' : 'border-neutral-200'}">
          <header class="flex items-center justify-between gap-2 px-3 py-2">
            <button
              type="button"
              class="flex flex-1 items-center gap-2 text-left"
              onclick={() => (expandedId = expandedId === persona.id ? null : persona.id)}
            >
              <span class="text-xs text-neutral-400">{expandedId === persona.id ? '▾' : '▸'}</span>
              <span class="font-medium text-neutral-900">{persona.name}</span>
              <span class="text-xs text-neutral-500">
                {persona.stateOverrides.length} state · {persona.parameterOverrides.length} params
              </span>
            </button>
            <button
              type="button"
              class="text-xs text-neutral-400 hover:text-red-600"
              onclick={() => remove(persona.id)}
              aria-label="Remove persona"
            >
              ✕
            </button>
          </header>
          {#if expandedId === persona.id}
            <div class="border-t border-neutral-200 p-3">
              <PersonaEditor
                {persona}
                {availablePaths}
                {availableParameterNames}
                onChange={(next) => update(next)}
              />
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>
