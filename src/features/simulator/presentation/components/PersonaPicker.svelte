<script lang="ts">
  import type { Action } from '$features/behavior-model/domain/entities/Action';
  import type { Feature } from '$features/behavior-model/domain/entities/Feature';
  import type { Persona } from '$features/behavior-model/domain/entities/Persona';
  import type { Surface } from '$features/behavior-model/domain/entities/Surface';
  import { simulatorStore } from '$features/simulator/presentation/stores/simulatorStore.svelte';

  type Props = {
    feature: Feature;
    surface: Surface;
    action: Action | null;
  };
  let { feature, surface, action }: Props = $props();

  const activePersona = $derived<Persona | null>(
    feature.personas.find((p) => p.id === simulatorStore.personaId) ?? null
  );

  function pick(id: string) {
    if (!id) {
      simulatorStore.applyPersona(null, action, surface);
      return;
    }
    const persona = feature.personas.find((p) => p.id === id);
    if (!persona) return;
    simulatorStore.applyPersona(persona, action, surface);
  }
</script>

<div class="space-y-0.5">
  <label class="text-[11px] font-medium text-neutral-700" for="persona-select">Test as</label>
  <select
    id="persona-select"
    class="w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-100"
    onchange={(e) => pick((e.target as HTMLSelectElement).value)}
    disabled={feature.personas.length === 0}
  >
    {#if feature.personas.length === 0}
      <option value="" selected>No personas defined</option>
    {:else}
      <option value="" selected={!simulatorStore.personaId}>- Manual setup -</option>
      {#each feature.personas as persona (persona.id)}
        <option value={persona.id} selected={persona.id === simulatorStore.personaId}>
          {persona.name}{persona.persistAcrossSurfaces ? ' · sticky' : ''}
        </option>
      {/each}
    {/if}
  </select>
  {#if activePersona?.persistAcrossSurfaces}
    <p class="text-[10px] font-medium text-emerald-700">Sticky across surfaces.</p>
  {/if}
</div>
