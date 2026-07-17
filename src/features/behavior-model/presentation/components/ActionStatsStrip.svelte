<script lang="ts">
  import type { ActionRollup } from '$features/behavior-model/domain/services/ActionRollup';

  type Props = {
    rollup: ActionRollup;
    label: string;
  };
  let { rollup, label }: Props = $props();

  const reused = $derived(rollup.concepts.filter((concept) => concept.occurrences > 1).length);
  const crossFeature = $derived(rollup.concepts.filter((concept) => concept.crossFeature).length);
</script>

<section class="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm shadow-slate-950/5">
  <div class="flex flex-wrap items-center gap-x-5 gap-y-2">
    <div class="mr-auto min-w-40">
      <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p class="text-sm font-semibold text-slate-900">
        {rollup.stats.actions} action{rollup.stats.actions === 1 ? '' : 's'}
        {#if rollup.stats.evolutions > 0}
          <span class="font-normal text-slate-500">· {rollup.stats.evolutions} proposed</span>
        {/if}
      </p>
    </div>
    {#each [['Parameters', rollup.stats.parameters], ['Rules', rollup.stats.rules], ['Effects', rollup.stats.effects], ['Scenarios', rollup.stats.scenarios], ['State paths', rollup.stats.uniqueStatePaths], ['Events', rollup.stats.uniqueEvents]] as item (item[0])}
      <div class="min-w-14 text-center">
        <div class="text-sm font-semibold tabular-nums text-slate-900">{item[1]}</div>
        <div class="text-[10px] text-slate-500">{item[0]}</div>
      </div>
    {/each}
    <div class="min-w-20 border-l border-slate-200 pl-4 text-center">
      <div class="text-sm font-semibold tabular-nums text-brand-800">
        {crossFeature > 0 ? crossFeature : reused}
      </div>
      <div class="text-[10px] text-slate-500">
        {crossFeature > 0 ? 'cross-feature' : 'reused concepts'}
      </div>
    </div>
  </div>
</section>
