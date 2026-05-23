<script lang="ts">
  import type { Feature } from '$features/behavior-model/domain/entities/Feature';
  import type { Surface } from '$features/behavior-model/domain/entities/Surface';
  import SimulatorPanel from './SimulatorPanel.svelte';
  import MaturityPanel from '$features/maturity/presentation/components/MaturityPanel.svelte';
  import ImplementationStatusPanel from '$features/implementation-status/presentation/components/ImplementationStatusPanel.svelte';
  import { editorStore, type InsightTab } from '$features/behavior-model/presentation/stores/editorStore.svelte';
  import { scoreFeatureBreakdown } from '$features/maturity/domain/MaturityScorer';
  import { computeImplementationBreakdown } from '$features/implementation-status/domain/ImplementationBreakdown';
  import { implementationStatusStore } from '$features/implementation-status/presentation/stores/implementationStatusStore.svelte';
  import { fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';

  type Props = { feature: Feature; surface: Surface | null };
  let { feature, surface }: Props = $props();

  const activeTab = $derived(editorStore.railTab);
  const collapsed = $derived(editorStore.railCollapsed);

  const maturity = $derived(scoreFeatureBreakdown(feature).global);
  const impl = $derived(
    computeImplementationBreakdown(feature, implementationStatusStore.status)
  );

  function pctColor(percentage: number): string {
    const hue = (percentage / 100) * 120;
    return `hsl(${Math.round(hue)}, 70%, 45%)`;
  }
  const maturityDot = $derived(
    maturity.criticalIssues.length > 0
      ? `hsl(${Math.max(0, 35 - (maturity.criticalIssues.length - 1) * 18)}, 75%, 50%)`
      : pctColor(maturity.percentage)
  );
  const implDot = $derived(
    impl.expectedCount === 0 ? 'hsl(220, 10%, 70%)' : pctColor(impl.percentage)
  );

  type TabDescriptor = {
    key: InsightTab;
    label: string;
    short: string;
    badge?: string;
    badgeTone?: 'red' | 'amber' | 'emerald' | 'slate';
    dot?: string;
  };

  const tabs = $derived<TabDescriptor[]>([
    { key: 'simulator', label: 'Simulator', short: 'Sim', badge: '▶', badgeTone: 'slate' },
    {
      key: 'maturity',
      label: 'Maturity',
      short: 'Mat',
      badge: `${maturity.percentage}%`,
      badgeTone:
        maturity.criticalIssues.length > 0
          ? 'red'
          : maturity.percentage >= 80
            ? 'emerald'
            : maturity.percentage >= 50
              ? 'amber'
              : 'red',
      dot: maturityDot
    },
    {
      key: 'implementation',
      label: 'Implementation',
      short: 'Impl',
      badge: impl.expectedCount === 0 ? '-' : `${impl.percentage}%`,
      badgeTone:
        impl.expectedCount === 0
          ? 'slate'
          : impl.percentage >= 80
            ? 'emerald'
            : impl.percentage >= 50
              ? 'amber'
              : 'red',
      dot: implDot
    }
  ]);

  const toneClass: Record<NonNullable<TabDescriptor['badgeTone']>, string> = {
    red: 'bg-red-100 text-red-800',
    amber: 'bg-amber-100 text-amber-800',
    emerald: 'bg-emerald-100 text-emerald-800',
    slate: 'bg-slate-100 text-slate-700'
  };
</script>

{#if collapsed}
  <aside
    class="flex flex-col items-center gap-1 rounded-lg border border-hairline bg-white p-1"
    aria-label="Insights rail (collapsed)"
  >
    <button
      type="button"
      class="grid h-9 w-9 place-items-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900"
      title="Expand insights rail"
      aria-label="Expand insights rail"
      onclick={() => editorStore.setRailCollapsed(false)}
    >
      <span aria-hidden="true">◀</span>
    </button>
    <span class="my-1 h-px w-6 bg-slate-200"></span>
    {#each tabs as tab (tab.key)}
      <button
        type="button"
        class="relative grid h-9 w-9 place-items-center rounded-md text-[10px] font-semibold text-slate-700 hover:bg-slate-100 {activeTab === tab.key ? 'bg-brand-50 text-brand-800 ring-1 ring-brand-200' : ''}"
        title={tab.label}
        aria-label={tab.label}
        onclick={() => editorStore.openRail(tab.key)}
      >
        <span>{tab.short}</span>
        {#if tab.dot}
          <span
            class="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-white"
            style="background-color: {tab.dot}"
          ></span>
        {/if}
      </button>
    {/each}
  </aside>
{:else}
  <section class="rounded-lg border border-hairline bg-white">
    <div class="sticky top-0 z-10 flex items-stretch rounded-t-lg border-b border-hairline bg-white text-xs">
      {#each tabs as tab (tab.key)}
        <button
          type="button"
          class="flex flex-1 items-center justify-center gap-1.5 px-2 py-2 transition {activeTab === tab.key
            ? 'border-b-2 border-brand-700 font-semibold text-brand-800'
            : 'text-slate-600 hover:text-slate-950'}"
          onclick={() => editorStore.setRailTab(tab.key)}
        >
          <span>{tab.label}</span>
          {#if tab.badge && tab.badgeTone}
            <span class="rounded-md px-1.5 py-0.5 font-mono text-[10px] {toneClass[tab.badgeTone]}">
              {tab.badge}
            </span>
          {/if}
        </button>
      {/each}
      <button
        type="button"
        class="grid w-8 place-items-center border-l border-hairline text-slate-500 hover:bg-slate-50 hover:text-slate-900"
        title="Collapse insights rail"
        aria-label="Collapse insights rail"
        onclick={() => editorStore.setRailCollapsed(true)}
      >
        <span aria-hidden="true">▶</span>
      </button>
    </div>

    <div class="p-3">
      {#key activeTab}
        <div in:fade={{ duration: 140, easing: cubicOut }} class="motion-reduce:animate-none! motion-reduce:opacity-100!">
          {#if activeTab === 'simulator'}
            {#if surface}
              <SimulatorPanel {feature} {surface} />
            {:else}
              <p class="text-xs text-slate-500">Select a surface to simulate.</p>
            {/if}
          {:else if activeTab === 'maturity'}
            <MaturityPanel {feature} />
          {:else}
            <ImplementationStatusPanel {feature} />
          {/if}
        </div>
      {/key}
    </div>
  </section>
{/if}
