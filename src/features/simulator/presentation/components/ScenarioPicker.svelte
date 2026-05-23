<script lang="ts">
  import type { Action } from '$features/behavior-model/domain/entities/Action';
  import type { Feature } from '$features/behavior-model/domain/entities/Feature';
  import type { Scenario } from '$features/behavior-model/domain/entities/Scenario';
  import type { Surface } from '$features/behavior-model/domain/entities/Surface';
  import { simulatorStore } from '$features/simulator/presentation/stores/simulatorStore.svelte';

  type Props = {
    feature: Feature;
    surface: Surface;
    action: Action;
  };
  let { feature, surface, action }: Props = $props();

  const scenarios = $derived<readonly Scenario[]>(action.scenarios ?? []);
  const activeScenario = $derived<Scenario | null>(
    scenarios.find((s) => s.id === simulatorStore.scenarioId) ?? null
  );

  function pick(id: string) {
    if (!id) {
      simulatorStore.applyScenario(null, feature, action, surface);
      return;
    }
    const scenario = scenarios.find((s) => s.id === id);
    if (!scenario) return;
    simulatorStore.applyScenario(scenario, feature, action, surface);
  }
</script>

{#if scenarios.length > 0}
  <div class="space-y-0.5">
    <label class="text-[11px] font-medium text-neutral-700" for="scenario-select">Scenario</label>
    <select
      id="scenario-select"
      class="w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-100"
      onchange={(e) => pick((e.target as HTMLSelectElement).value)}
    >
      <option value="" selected={!simulatorStore.scenarioId}>- No scenario -</option>
      {#each scenarios as scenario (scenario.id)}
        <option value={scenario.id} selected={scenario.id === simulatorStore.scenarioId}>{scenario.name}</option>
      {/each}
    </select>
  </div>
{/if}
