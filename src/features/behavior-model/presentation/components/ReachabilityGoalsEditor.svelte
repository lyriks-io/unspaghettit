<script lang="ts">
  import type { Feature } from '$features/behavior-model/domain/entities/Feature';
  import type { ReachabilityGoal } from '$features/behavior-model/domain/entities/ReachabilityGoal';
  import { featureStore } from '$features/behavior-model/presentation/stores/featureStore.svelte';
  import {
    addReachabilityGoal,
    removeReachabilityGoal,
    updateReachabilityGoal
  } from '$features/behavior-model/domain/services/FeatureTransforms';
  import { newReachabilityGoal } from '$features/behavior-model/presentation/view-models/factories';
  import { cryptoIdGenerator } from '$shared/domain/IdGenerator';
  import ReachabilityGoalEditor from './ReachabilityGoalEditor.svelte';

  type Props = { feature: Feature };
  let { feature }: Props = $props();

  // Goals are feature-level, so the state-path picker spans every surface.
  const availablePaths = $derived(
    feature.surfaces.flatMap((s) => s.stateDefinitions.map((d) => d.path))
  );
  const goals = $derived(feature.reachabilityGoals ?? []);

  async function add() {
    const fallbackPath = availablePaths[0] ?? ('state.path' as unknown as never);
    const goal = newReachabilityGoal(cryptoIdGenerator, {
      name: 'New reachability goal',
      kind: 'reachable',
      left: fallbackPath as string
    });
    await featureStore.mutate((current) => addReachabilityGoal(current, goal));
  }

  async function update(next: ReachabilityGoal) {
    await featureStore.mutate((current) => updateReachabilityGoal(current, next.id, next));
  }

  async function remove(id: ReachabilityGoal['id']) {
    await featureStore.mutate((current) => removeReachabilityGoal(current, id));
  }
</script>

<div class="space-y-3">
  <div class="rounded-md border border-lime-200 bg-lime-50/50 p-3 text-xs text-lime-900">
    <p class="font-semibold">Reachability goals (liveness)</p>
    <p class="mt-0.5 text-[11px] leading-relaxed">
      The complement to invariants: invariants say "nothing bad ever happens", goals say
      "something good stays reachable". <span class="font-medium">Reachable</span> — some reachable
      state satisfies the target (catches a state the product can never get to).
      <span class="font-medium">Always reachable</span> — the target stays reachable from every
      state (catches a flow that can get permanently stuck). Checked by the model checker
      (Verify / <span class="font-mono">unspa check --model-check</span>), which returns the
      shortest action path to any trap.
    </p>
  </div>

  <div class="flex justify-end">
    <button
      type="button"
      class="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
      onclick={add}
    >
      <span class="text-base leading-none">+</span> Add reachability goal
    </button>
  </div>

  {#if goals.length === 0}
    <div class="rounded-lg border border-dashed border-slate-300 bg-slate-50/30 p-6 text-center">
      <p class="text-sm font-medium text-slate-700">No reachability goals yet</p>
      <p class="mx-auto mt-1 max-w-md text-xs text-slate-500">
        Optional — add one when a key state must stay reachable (e.g. "an order can always reach
        delivered or cancelled"). Run a model check to see them verified with counterexample paths.
      </p>
    </div>
  {:else}
    <div class="space-y-2">
      {#each goals as goal (goal.id)}
        <ReachabilityGoalEditor
          {goal}
          {availablePaths}
          onChange={(next) => update(next)}
          onRemove={() => remove(goal.id)}
        />
      {/each}
    </div>
  {/if}
</div>
