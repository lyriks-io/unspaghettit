<script lang="ts">
  import type { Action } from '$features/behavior-model/domain/entities/Action';
  import type {
    Scenario,
    ScenarioAssertion
  } from '$features/behavior-model/domain/entities/Scenario';
  import type { Surface } from '$features/behavior-model/domain/entities/Surface';
  import {
    asScenarioId,
    type ScenarioId
  } from '$features/behavior-model/domain/value-objects/ids';
  import {
    asStatePath,
    isStatePath,
    type StatePath
  } from '$features/behavior-model/domain/value-objects/StatePath';
  import type { StateValue } from '$features/behavior-model/domain/value-objects/StateValue';
  import {
    ALL_OPERATORS,
    operatorLabel,
    operatorRequiresRightOperand,
    type Operator
  } from '$features/behavior-model/domain/value-objects/Operator';
  import {
    updateAction,
    addScenarioToCapability,
    updateScenarioOnCapability,
    removeScenarioFromCapability
  } from '$features/behavior-model/domain/services/FeatureTransforms';
  import { featureStore } from '$features/behavior-model/presentation/stores/featureStore.svelte';
  import { cryptoIdGenerator } from '$shared/domain/IdGenerator';
  import StatePathSelect from './StatePathSelect.svelte';
  import ParameterNameSelect from './ParameterNameSelect.svelte';
  import ConditionRightEditor from './ConditionRightEditor.svelte';

  type Props = {
    surface: Surface;
    action: Action;
  };
  let { surface, action }: Props = $props();

  // All sibling surfaces for the expectedTransition dropdown, a scenario
  // can assert the action lands on any surface in the feature, not just the
  // one the action lives on. featureStore.feature is the live, post-mutation
  // tree, so this stays in sync as the user adds/renames surfaces.
  const allSurfaces = $derived(featureStore.feature?.surfaces ?? []);

  const scenarios = $derived(action.scenarios ?? []);
  const availablePaths = $derived(surface.stateDefinitions.map((d) => d.path));
  const parameterNames = $derived(action.parameters.map((p) => p.name));
  let expandedId = $state<ScenarioId | null>(null);

  function parseValue(raw: string): StateValue {
    if (raw === 'true' || raw === 'false') return raw === 'true';
    if (raw === 'null') return null;
    if (raw !== '' && !Number.isNaN(Number(raw))) return Number(raw);
    return raw;
  }

  async function addScenario() {
    const scenario: Scenario = {
      id: asScenarioId(cryptoIdGenerator()),
      name: `Scenario ${(action.scenarios?.length ?? 0) + 1}`,
      stateOverrides: [],
      parameterOverrides: []
    };
    await featureStore.mutate((current) =>
      addScenarioToCapability(current, surface.id, action.id, scenario)
    );
    expandedId = scenario.id;
  }

  async function patchScenario(id: ScenarioId, patch: Partial<Scenario>) {
    await featureStore.mutate((current) =>
      updateScenarioOnCapability(current, surface.id, action.id, id, patch)
    );
  }

  async function replaceScenarios(next: readonly Scenario[]) {
    await featureStore.mutate((current) =>
      updateAction(current, surface.id, action.id, { scenarios: next })
    );
  }

  async function removeScenario(id: ScenarioId) {
    if (!confirm('Delete this scenario?')) return;
    await featureStore.mutate((current) =>
      removeScenarioFromCapability(current, surface.id, action.id, id)
    );
  }

  function addStateOverride(scenario: Scenario) {
    const path = availablePaths[0] ?? asStatePath('state.path');
    patchScenario(scenario.id, {
      stateOverrides: [...scenario.stateOverrides, { path, value: '' }]
    });
  }

  function updateStateOverride(scenario: Scenario, index: number, path: StatePath, value: StateValue) {
    patchScenario(scenario.id, {
      stateOverrides: scenario.stateOverrides.map((override, i) =>
        i === index ? { path, value } : override
      )
    });
  }

  function removeStateOverride(scenario: Scenario, index: number) {
    patchScenario(scenario.id, {
      stateOverrides: scenario.stateOverrides.filter((_, i) => i !== index)
    });
  }

  function addParameterOverride(scenario: Scenario) {
    patchScenario(scenario.id, {
      parameterOverrides: [
        ...scenario.parameterOverrides,
        { parameterName: parameterNames[0] ?? 'parameter', value: '' }
      ]
    });
  }

  function updateParameterOverride(scenario: Scenario, index: number, name: string, value: StateValue) {
    patchScenario(scenario.id, {
      parameterOverrides: scenario.parameterOverrides.map((override, i) =>
        i === index ? { parameterName: name, value } : override
      )
    });
  }

  function removeParameterOverride(scenario: Scenario, index: number) {
    patchScenario(scenario.id, {
      parameterOverrides: scenario.parameterOverrides.filter((_, i) => i !== index)
    });
  }

  function addAssertion(scenario: Scenario) {
    const path = availablePaths[0] ?? asStatePath('state.path');
    const assertion: ScenarioAssertion = { path, operator: 'equals', value: '' };
    patchScenario(scenario.id, {
      expectedAssertions: [...(scenario.expectedAssertions ?? []), assertion]
    });
  }

  function updateAssertion(scenario: Scenario, index: number, patch: Partial<ScenarioAssertion>) {
    const assertions = scenario.expectedAssertions ?? [];
    patchScenario(scenario.id, {
      expectedAssertions: assertions.map((assertion, i) =>
        i === index ? { ...assertion, ...patch } : assertion
      )
    });
  }

  function removeAssertion(scenario: Scenario, index: number) {
    const next = (scenario.expectedAssertions ?? []).filter((_, i) => i !== index);
    patchScenario(scenario.id, { expectedAssertions: next.length > 0 ? next : undefined });
  }

  function moveScenario(scenario: Scenario, direction: -1 | 1) {
    const index = scenarios.findIndex((s) => s.id === scenario.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= scenarios.length) return;
    const next = scenarios.slice();
    const [item] = next.splice(index, 1);
    if (!item) return;
    next.splice(target, 0, item);
    replaceScenarios(next);
  }
</script>

<section class="space-y-2">
  <div class="flex items-center justify-between gap-2">
    <p class="text-xs text-neutral-500">
      Named setups for simulator and CI-grade scenario runs.
    </p>
    <button
      type="button"
      class="rounded-md border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-50"
      onclick={addScenario}
    >
      + Scenario
    </button>
  </div>

  {#if scenarios.length === 0}
    <p class="rounded-md border border-dashed border-neutral-300 p-3 text-center text-xs text-neutral-500">
      No scenarios yet.
    </p>
  {:else}
    <ul class="space-y-2">
      {#each scenarios as scenario, index (scenario.id)}
        {@const isExpanded = expandedId === scenario.id}
        <li
          class="rounded-md border bg-white {isExpanded
            ? 'border-brand-300 ring-1 ring-brand-200'
            : 'border-neutral-200'}"
        >
          <header class="flex items-center gap-2 px-2 py-1 text-xs">
            <button
              type="button"
              class="text-neutral-400 hover:text-neutral-700"
              onclick={() => (expandedId = isExpanded ? null : scenario.id)}
              aria-label={isExpanded ? 'Collapse scenario' : 'Expand scenario'}
            >
              {isExpanded ? 'v' : '>'}
            </button>
            <span class="flex-1 font-medium text-neutral-900">{scenario.name}</span>
            {#if scenario.expectedStatus}
              <span class="rounded-md bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-700">
                expects {scenario.expectedStatus}
              </span>
            {/if}
            <button
              type="button"
              class="text-neutral-400 hover:text-neutral-700 disabled:opacity-30"
              onclick={() => moveScenario(scenario, -1)}
              disabled={index === 0}
              aria-label="Move scenario up"
            >
              up
            </button>
            <button
              type="button"
              class="text-neutral-400 hover:text-neutral-700 disabled:opacity-30"
              onclick={() => moveScenario(scenario, 1)}
              disabled={index === scenarios.length - 1}
              aria-label="Move scenario down"
            >
              down
            </button>
            <button
              type="button"
              class="text-neutral-400 hover:text-red-600"
              onclick={() => removeScenario(scenario.id)}
              aria-label="Remove scenario"
            >
              x
            </button>
          </header>

          {#if isExpanded}
            <div class="space-y-3 border-t border-neutral-200 p-3 text-xs">
              <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label class="block">
                  <span class="text-[10px] font-medium uppercase tracking-wide text-neutral-500">Name</span>
                  <input
                    type="text"
                    class="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1 text-xs"
                    value={scenario.name}
                    onblur={(e) =>
                      patchScenario(scenario.id, {
                        name: (e.target as HTMLInputElement).value || scenario.name
                      })}
                  />
                </label>
                <label class="block">
                  <span class="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                    Expected status
                  </span>
                  <select
                    class="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1 text-xs"
                    value={scenario.expectedStatus ?? ''}
                    onchange={(e) => {
                      const raw = (e.target as HTMLSelectElement).value;
                      patchScenario(scenario.id, {
                        expectedStatus: raw === '' ? undefined : (raw as 'success' | 'blocked')
                      });
                    }}
                  >
                    <option value="">No expectation</option>
                    <option value="success">success</option>
                    <option value="blocked">blocked</option>
                  </select>
                </label>
              </div>
              <label class="block">
                <span class="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                  Expected transition
                </span>
                <select
                  class="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1 text-xs"
                  value={scenario.expectedTransition === null
                    ? '__none__'
                    : (scenario.expectedTransition ?? '')}
                  onchange={(e) => {
                    const raw = (e.target as HTMLSelectElement).value;
                    if (raw === '') {
                      patchScenario(scenario.id, { expectedTransition: undefined });
                    } else if (raw === '__none__') {
                      patchScenario(scenario.id, { expectedTransition: null });
                    } else {
                      patchScenario(scenario.id, {
                        expectedTransition: raw as Scenario['expectedTransition']
                      });
                    }
                  }}
                >
                  <option value="">No expectation</option>
                  <option value="__none__">Asserts NO transition fires</option>
                  {#each allSurfaces as s (s.id)}
                    <option value={s.id}>→ {s.name}</option>
                  {/each}
                </select>
                <span class="mt-0.5 block text-[10px] text-neutral-500">
                  Run the action and confirm it lands on the chosen surface (or asserts none).
                </span>
              </label>
              <label class="block">
                <span class="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                  Description
                </span>
                <input
                  type="text"
                  class="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1 text-xs"
                  value={scenario.description ?? ''}
                  onblur={(e) =>
                    patchScenario(scenario.id, {
                      description: (e.target as HTMLInputElement).value || undefined
                    })}
                />
              </label>

              <section>
                <header class="mb-1 flex items-center justify-between">
                  <span class="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                    State overrides ({scenario.stateOverrides.length})
                  </span>
                  <button
                    type="button"
                    class="rounded-md border border-neutral-300 px-2 py-0.5 text-[11px] hover:bg-neutral-50"
                    onclick={() => addStateOverride(scenario)}
                  >
                    + State
                  </button>
                </header>
                <ul class="space-y-1">
                  {#each scenario.stateOverrides as override, i (i)}
                    <li class="flex flex-wrap items-start gap-1.5">
                      <StatePathSelect
                        value={override.path}
                        {availablePaths}
                        onCommit={(raw) => {
                          if (isStatePath(raw)) {
                            updateStateOverride(
                              scenario,
                              i,
                              asStatePath(raw),
                              override.value
                            );
                          }
                        }}
                      />
                      <input
                        type="text"
                        class="mono mt-0.5 w-32 rounded-md border border-neutral-300 px-2 py-1 text-xs"
                        value={String(override.value ?? '')}
                        onchange={(e) =>
                          updateStateOverride(
                            scenario,
                            i,
                            override.path,
                            parseValue((e.target as HTMLInputElement).value)
                          )}
                      />
                      <button
                        type="button"
                        class="mt-1 text-neutral-400 hover:text-red-600"
                        onclick={() => removeStateOverride(scenario, i)}
                      >
                        x
                      </button>
                    </li>
                  {/each}
                </ul>
              </section>

              <section>
                <header class="mb-1 flex items-center justify-between">
                  <span class="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                    Parameter values ({scenario.parameterOverrides.length})
                  </span>
                  <button
                    type="button"
                    class="rounded-md border border-neutral-300 px-2 py-0.5 text-[11px] hover:bg-neutral-50"
                    onclick={() => addParameterOverride(scenario)}
                  >
                    + Parameter
                  </button>
                </header>
                <ul class="space-y-1">
                  {#each scenario.parameterOverrides as override, i (i)}
                    <li class="flex flex-wrap items-center gap-1.5">
                      <ParameterNameSelect
                        value={override.parameterName}
                        availableNames={parameterNames}
                        onCommit={(name) =>
                          updateParameterOverride(scenario, i, name, override.value)}
                      />
                      <input
                        type="text"
                        class="mono w-32 rounded-md border border-neutral-300 px-2 py-1 text-xs"
                        value={String(override.value ?? '')}
                        onchange={(e) =>
                          updateParameterOverride(
                            scenario,
                            i,
                            override.parameterName,
                            parseValue((e.target as HTMLInputElement).value)
                          )}
                      />
                      <button
                        type="button"
                        class="text-neutral-400 hover:text-red-600"
                        onclick={() => removeParameterOverride(scenario, i)}
                      >
                        x
                      </button>
                    </li>
                  {/each}
                </ul>
              </section>

              <section>
                <header class="mb-1 flex items-center justify-between">
                  <span class="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                    Expected assertions ({scenario.expectedAssertions?.length ?? 0})
                  </span>
                  <button
                    type="button"
                    class="rounded-md border border-neutral-300 px-2 py-0.5 text-[11px] hover:bg-neutral-50"
                    onclick={() => addAssertion(scenario)}
                  >
                    + Assertion
                  </button>
                </header>
                <ul class="space-y-1">
                  {#each scenario.expectedAssertions ?? [] as assertion, i (i)}
                    <li class="flex flex-wrap items-start gap-1.5 rounded-md bg-neutral-50 p-2">
                      <StatePathSelect
                        value={assertion.path}
                        {availablePaths}
                        onCommit={(raw) => {
                          if (isStatePath(raw)) updateAssertion(scenario, i, { path: asStatePath(raw) });
                        }}
                      />
                      <select
                        class="mt-0.5 rounded-md border border-neutral-300 px-2 py-1 text-xs"
                        value={assertion.operator}
                        onchange={(e) => {
                          const op = (e.target as HTMLSelectElement).value as Operator;
                          updateAssertion(scenario, i, {
                            operator: op,
                            ...(operatorRequiresRightOperand(op)
                              ? { value: assertion.value ?? '' }
                              : { value: undefined })
                          });
                        }}
                      >
                        {#each ALL_OPERATORS as operator}
                          <option value={operator}>{operatorLabel(operator)}</option>
                        {/each}
                      </select>
                      {#if operatorRequiresRightOperand(assertion.operator)}
                        <ConditionRightEditor
                          value={assertion.value}
                          {availablePaths}
                          onChange={(value) => updateAssertion(scenario, i, { value })}
                        />
                      {/if}
                      <input
                        type="text"
                        class="min-w-40 flex-1 rounded-md border border-neutral-300 px-2 py-1 text-xs"
                        value={assertion.description ?? ''}
                        placeholder="Description"
                        onblur={(e) =>
                          updateAssertion(scenario, i, {
                            description: (e.target as HTMLInputElement).value || undefined
                          })}
                      />
                      <button
                        type="button"
                        class="mt-1 text-neutral-400 hover:text-red-600"
                        onclick={() => removeAssertion(scenario, i)}
                      >
                        x
                      </button>
                    </li>
                  {/each}
                </ul>
              </section>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>
