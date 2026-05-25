<script lang="ts">
  import type { Feature } from '$features/behavior-model/domain/entities/Feature';
  import { scoreFeatureBreakdown } from '$features/maturity/domain/MaturityScorer';
  import { computeImplementationBreakdown } from '$features/implementation-status/domain/ImplementationBreakdown';
  import { implementationStatusStore } from '$features/implementation-status/presentation/stores/implementationStatusStore.svelte';
  import { editorStore } from '$features/behavior-model/presentation/stores/editorStore.svelte';

  type Props = { feature: Feature };
  let { feature }: Props = $props();

  const maturity = $derived(scoreFeatureBreakdown(feature).global);
  const impl = $derived(
    computeImplementationBreakdown(feature, implementationStatusStore.status)
  );

  function pctColor(percentage: number): string {
    const hue = (percentage / 100) * 120;
    return `hsl(${Math.round(hue)}, 70%, 45%)`;
  }

  function maturityColor(): string {
    const critical = maturity.criticalIssues.length;
    if (critical === 0) return pctColor(maturity.percentage);
    const hue = Math.max(0, 35 - (critical - 1) * 18);
    return `hsl(${Math.round(hue)}, 75%, 50%)`;
  }
</script>

<div class="flex flex-wrap items-stretch gap-2">
  <!-- Maturity health -->
  <button
    type="button"
    data-tour="maturity-toggle"
    class="group flex min-w-[10rem] flex-1 items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left shadow-sm shadow-slate-950/5 transition hover:border-slate-300 hover:bg-slate-50"
    onclick={() => editorStore.openRail('maturity')}
    title="Open Maturity panel"
  >
    <span
      class="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white"
      style="background-color: {maturityColor()}"
    >
      {maturity.percentage}%
    </span>
    <span class="min-w-0">
      <span class="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Maturity</span>
      <span class="flex items-center gap-1.5 text-xs font-medium text-slate-700">
        {#if maturity.criticalIssues.length > 0}
          <span class="rounded-md bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-800">
            {maturity.criticalIssues.length} critical
          </span>
        {/if}
        {#if maturity.recommendedIssues.length > 0}
          <span class="rounded-md bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-800">
            {maturity.recommendedIssues.length} suggestion{maturity.recommendedIssues.length === 1 ? '' : 's'}
          </span>
        {/if}
        {#if maturity.criticalIssues.length === 0 && maturity.recommendedIssues.length === 0}
          <span class="text-emerald-700">All checks pass</span>
        {/if}
      </span>
    </span>
  </button>

  <!-- Implementation health -->
  <button
    type="button"
    data-tour="implementation-toggle"
    class="group flex min-w-[10rem] flex-1 items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left shadow-sm shadow-slate-950/5 transition hover:border-slate-300 hover:bg-slate-50"
    onclick={() => editorStore.openRail('implementation')}
    title="Open Implementation panel"
  >
    <span
      class="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white"
      style="background-color: {impl.expectedCount === 0 ? 'hsl(220, 10%, 70%)' : pctColor(impl.percentage)}"
    >
      {impl.expectedCount === 0 ? '-' : `${impl.percentage}%`}
    </span>
    <span class="min-w-0">
      <span class="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Implementation</span>
      <span class="text-xs font-medium text-slate-700">
        {#if !impl.hasReport}
          <span class="text-slate-500">no report yet</span>
        {:else}
          {impl.foundCount}/{impl.expectedCount} tagged
          {#if impl.missingCount > 0}
            · <span class="text-red-700">{impl.missingCount} missing</span>
          {/if}
        {/if}
      </span>
    </span>
  </button>

  <!-- Simulator quick-open -->
  <button
    type="button"
    data-tour="simulator-toggle"
    class="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left shadow-sm shadow-slate-950/5 transition hover:border-slate-300 hover:bg-slate-50"
    onclick={() => editorStore.openRail('simulator')}
    title="Open Simulator panel"
  >
    <span class="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-100 text-brand-800" aria-hidden="true">
      <span class="text-sm">▶</span>
    </span>
    <span class="min-w-0">
      <span class="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Simulator</span>
      <span class="text-xs font-medium text-slate-700">Run an action</span>
    </span>
  </button>

</div>
