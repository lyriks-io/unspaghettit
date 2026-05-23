<script lang="ts">
  import type { Feature } from '$features/behavior-model/domain/entities/Feature';
  import { editorStore } from '$features/behavior-model/presentation/stores/editorStore.svelte';
  import { scoreFeatureBreakdown } from '$features/maturity/domain/MaturityScorer';
  import ProgressBar from '$shared/presentation/components/ProgressBar.svelte';
  import type {
    CheckLocation,
    MaturityIssue,
    MaturityReport,
    PassedCheck
  } from '$features/maturity/domain/MaturityReport';
  import { emit } from '$shared/events/eventBus';

  type Props = { feature: Feature };
  let { feature }: Props = $props();

  // Maturity scoring is synchronous, so isScoring is effectively always false
  // from a renderer's perspective. State path exists for the spec; an async
  // variant could flip it. lastScoredAt + the audit event are written from an
  // $effect because side effects are forbidden inside $derived.
  let isScoring = $state<boolean>(false);
  let lastScoredAt = $state<string | null>(null);

  const breakdown = $derived(scoreFeatureBreakdown(feature));

  $effect(() => {
    lastScoredAt = new Date().toISOString();
    emit('feature.scored', {
      featureId: String(feature.id),
      percentage: breakdown.global.percentage,
      criticalIssues: breakdown.global.criticalIssues.length
    });
  });


  function sectionPanel(report: MaturityReport): string {
    if (report.percentage >= 80) return 'bg-emerald-50 border-emerald-200 text-emerald-900';
    if (report.percentage >= 50) return 'bg-amber-50 border-amber-200 text-amber-900';
    return 'bg-red-50 border-red-200 text-red-900';
  }

  // Same gradient at every level (action, surface, global). Only critical
  // issues shift the hue: 0 → percentage drives the green↔amber↔red sweep,
  // 1 critical → orange, 2 → red-orange, 3+ → red. Suggestions are intentionally
  // ignored. Recommended-only gaps shouldn't make a high-percentage bar look
  // worse than it actually is.
  function adaptiveColor(report: MaturityReport): string {
    const critical = report.criticalIssues.length;
    if (critical === 0) {
      const hue = (report.percentage / 100) * 120;
      return `hsl(${Math.round(hue)}, 70%, 45%)`;
    }
    const hue = Math.max(0, 35 - (critical - 1) * 18);
    return `hsl(${Math.round(hue)}, 75%, 50%)`;
  }

  // Expansion state. Separate stores per level so the UI doesn't collapse the
  // surface when the user expands a child action.
  let expandedSurfaces = $state<Record<string, boolean>>({});
  let expandedCapabilities = $state<Record<string, boolean>>({});
  let showPassedFor = $state<Record<string, boolean>>({});

  function toggleSurface(sid: string) {
    expandedSurfaces = { ...expandedSurfaces, [sid]: !expandedSurfaces[sid] };
  }
  function toggleCapability(cid: string) {
    expandedCapabilities = { ...expandedCapabilities, [cid]: !expandedCapabilities[cid] };
  }
  function togglePassed(key: string) {
    showPassedFor = { ...showPassedFor, [key]: !showPassedFor[key] };
  }

  function navigate(loc: CheckLocation) {
    emit('maturity.issue.navigated', {
      surfaceId: loc.surfaceId ? String(loc.surfaceId) : undefined,
      actionId: loc.actionId ? String(loc.actionId) : undefined,
      surfacePanelTab: loc.surfacePanelTab
    });
    editorStore.navigateTo({
      surfaceId: loc.surfaceId,
      actionId: loc.actionId,
      surfacePanelTab: loc.surfacePanelTab
    });
  }

  type Row = (MaturityIssue | PassedCheck) & { kind: 'critical' | 'recommended' | 'passed' };

  function issueRowsFor(report: MaturityReport): Row[] {
    return [
      ...report.criticalIssues.map((i) => ({ ...i, kind: 'critical' as const })),
      ...report.recommendedIssues.map((i) => ({ ...i, kind: 'recommended' as const }))
    ];
  }

  function passedRowsFor(report: MaturityReport): Row[] {
    return report.passedChecks.map((p) => ({ ...p, kind: 'passed' as const }));
  }
</script>

<div class="space-y-4 text-sm">
  <!-- ── Global header (rolled up from every surface) ──────────────────── -->
  <section class="rounded-md border p-3 {sectionPanel(breakdown.global)}">
    <div class="flex items-center justify-between gap-3">
      <span class="text-xs font-semibold uppercase tracking-wide opacity-80">Global</span>
      <span class="text-xs font-bold tabular-nums">{breakdown.global.percentage}%</span>
    </div>
    <div class="mt-1">
      <ProgressBar
        percentage={breakdown.global.percentage}
        color={adaptiveColor(breakdown.global)}
        size="md"
        ariaLabel="Global maturity {breakdown.global.percentage}%"
      />
    </div>
    <div class="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
      <span class="font-bold">
        {breakdown.global.score} / {breakdown.global.maxScore} checks
      </span>
      <span class="font-bold">
        {breakdown.global.criticalIssues.length} critical
      </span>
      <span class="font-bold">
        {breakdown.global.recommendedIssues.length} recommended
      </span>
      <span class="font-bold">
        {breakdown.global.passedChecks.length} passed
      </span>
    </div>
  </section>

  <!-- ── Feature-level checks ──────────────────────────────────────── -->
  {#if breakdown.featureLevel.criticalIssues.length > 0 || breakdown.featureLevel.recommendedIssues.length > 0}
    <section>
      <h3 class="mb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
        Feature checks
      </h3>
      <ul class="space-y-1">
        {#each breakdown.featureLevel.criticalIssues as issue (issue.area)}
          <li class="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-900">
            <span class="text-[10px] font-medium uppercase tracking-wide">[critical]</span>
            {issue.message}
          </li>
        {/each}
        {#each breakdown.featureLevel.recommendedIssues as issue (issue.area)}
          <li class="rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-xs text-sky-900">
            <span class="text-[10px] font-medium uppercase tracking-wide">[suggestion]</span>
            {issue.message}
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <!-- ── Per surface (each rolled up from its actions) ───────────── -->
  <section class="space-y-2">
    <h3 class="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
      Per surface
    </h3>
    {#if breakdown.perSurface.length === 0}
      <p
        class="rounded-md border border-dashed border-neutral-300 p-3 text-center text-xs text-neutral-500"
      >
        No surfaces yet.
      </p>
    {:else}
      <ul class="space-y-1">
        {#each breakdown.perSurface as entry (entry.surface.id)}
          {@const sid = String(entry.surface.id)}
          {@const surfaceExpanded = expandedSurfaces[sid] ?? false}
          {@const surfaceLevelIssues = issueRowsFor(entry.surfaceLevel)}
          <li class="rounded-md border border-neutral-200 bg-white">
            <button
              type="button"
              class="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left text-xs"
              onclick={() => toggleSurface(sid)}
            >
              <span class="text-neutral-400">{surfaceExpanded ? '▾' : '▸'}</span>
              <span class="flex-1 truncate font-medium text-neutral-900">{entry.surface.name}</span>
              {#if entry.report.criticalIssues.length > 0}
                <span class="rounded-md bg-red-100 px-1.5 py-0.5 text-[10px] text-red-800">
                  {entry.report.criticalIssues.length} critical
                </span>
              {/if}
              {#if entry.report.recommendedIssues.length > 0}
                <span class="rounded-md bg-sky-100 px-1.5 py-0.5 text-[10px] text-sky-800">
                  {entry.report.recommendedIssues.length} suggestion{entry.report.recommendedIssues
                    .length === 1
                    ? ''
                    : 's'}
                </span>
              {/if}
            </button>
            <div class="px-3 pb-2">
              <ProgressBar
                percentage={entry.report.percentage}
                color={adaptiveColor(entry.report)}
                size="sm"
                ticks={[]}
                ariaLabel="Surface {entry.surface.name} {entry.report.percentage}%"
              />
            </div>

            {#if surfaceExpanded}
              <!-- Surface-only checks: states, invariants, has-actions -->
              {#if surfaceLevelIssues.length > 0}
                <div class="border-t border-neutral-100 px-3 py-2">
                  <h4
                    class="mb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500"
                  >
                    Surface checks
                  </h4>
                  <ul class="space-y-1">
                    {#each surfaceLevelIssues as row, idx (idx)}
                      <li
                        class="flex items-start gap-2 text-[11px] {row.kind === 'critical'
                          ? 'text-red-900'
                          : 'text-sky-900'}"
                      >
                        <span class={row.kind === 'critical' ? 'text-red-600' : 'text-sky-600'}>
                          {row.kind === 'critical' ? '●' : 'ℹ'}
                        </span>
                        <span class="min-w-0 flex-1">{row.message}</span>
                        <button
                          type="button"
                          class="shrink-0 rounded-md border px-1.5 py-0 text-[10px] font-medium {row.kind ===
                          'critical'
                            ? 'border-red-300 bg-white text-red-700 hover:bg-red-50'
                            : 'border-sky-300 bg-white text-sky-700 hover:bg-sky-50'}"
                          onclick={() => navigate(row)}
                        >
                          Fix →
                        </button>
                      </li>
                    {/each}
                  </ul>
                </div>
              {/if}

              <!-- Per-action rollup -->
              {#if entry.perAction.length === 0}
                <p
                  class="border-t border-neutral-100 px-3 py-2 text-[11px] italic text-neutral-500"
                >
                  No actions on this surface yet.
                </p>
              {:else}
                <div class="border-t border-neutral-100 px-3 py-2">
                  <h4
                    class="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-500"
                  >
                    Actions
                  </h4>
                  <ul class="space-y-1">
                    {#each entry.perAction as capEntry (capEntry.action.id)}
                      {@const cid = String(capEntry.action.id)}
                      {@const capExpanded = expandedCapabilities[cid] ?? false}
                      {@const capIssues = issueRowsFor(capEntry.report)}
                      {@const capPassed = passedRowsFor(capEntry.report)}
                      {@const passedKey = `cap:${cid}`}
                      {@const passedVisible = showPassedFor[passedKey] ?? false}
                      <li class="rounded-md border border-neutral-200 bg-neutral-50/40">
                        <button
                          type="button"
                          class="flex w-full flex-wrap items-center gap-2 px-2 py-1.5 text-left text-[11px]"
                          onclick={() => toggleCapability(cid)}
                        >
                          <span class="text-neutral-400">{capExpanded ? '▾' : '▸'}</span>
                          <span class="flex-1 truncate text-neutral-800">
                            {capEntry.action.name}
                          </span>
                          {#if capEntry.report.criticalIssues.length > 0}
                            <span
                              class="rounded-md bg-red-100 px-1.5 py-0.5 text-[10px] text-red-800"
                            >
                              {capEntry.report.criticalIssues.length}
                            </span>
                          {/if}
                          {#if capEntry.report.recommendedIssues.length > 0}
                            <span
                              class="rounded-md bg-sky-100 px-1.5 py-0.5 text-[10px] text-sky-800"
                            >
                              {capEntry.report.recommendedIssues.length}
                            </span>
                          {/if}
                        </button>
                        <div class="px-2 pb-1.5">
                          <ProgressBar
                            percentage={capEntry.report.percentage}
                            color={adaptiveColor(capEntry.report)}
                            size="xs"
                            ticks={[]}
                            ariaLabel="Action {capEntry.action.name} {capEntry.report.percentage}%"
                          />
                        </div>
                        {#if capExpanded}
                          {#if capIssues.length > 0}
                            <ul
                              class="divide-y divide-neutral-100 border-t border-neutral-100 bg-white"
                            >
                              {#each capIssues as row, idx (idx)}
                                <li
                                  class="flex items-start gap-2 px-2 py-1.5 text-[11px] {row.kind ===
                                  'critical'
                                    ? 'text-red-900'
                                    : 'text-sky-900'}"
                                >
                                  <span
                                    class={row.kind === 'critical' ? 'text-red-600' : 'text-sky-600'}
                                  >
                                    {row.kind === 'critical' ? '●' : 'ℹ'}
                                  </span>
                                  <span class="min-w-0 flex-1">{row.message}</span>
                                  <button
                                    type="button"
                                    class="shrink-0 rounded-md border px-1.5 py-0 text-[10px] font-medium {row.kind ===
                                    'critical'
                                      ? 'border-red-300 bg-white text-red-700 hover:bg-red-50'
                                      : 'border-sky-300 bg-white text-sky-700 hover:bg-sky-50'}"
                                    onclick={() => navigate(row)}
                                  >
                                    Fix →
                                  </button>
                                </li>
                              {/each}
                            </ul>
                          {:else}
                            <p
                              class="border-t border-neutral-100 px-2 py-1.5 text-[11px] text-emerald-700"
                            >
                              ✓ All checks pass.
                            </p>
                          {/if}

                          {#if capPassed.length > 0}
                            <div class="border-t border-neutral-100 px-2 py-1">
                              <button
                                type="button"
                                class="text-[11px] text-brand-700 hover:underline"
                                onclick={() => togglePassed(passedKey)}
                              >
                                {passedVisible ? 'Hide' : 'Show'}
                                {capPassed.length} passed check{capPassed.length === 1 ? '' : 's'}
                              </button>
                            </div>
                            {#if passedVisible}
                              <ul
                                class="divide-y divide-emerald-100 border-t border-emerald-100 bg-emerald-50/30"
                              >
                                {#each capPassed as row, idx (idx)}
                                  <li
                                    class="flex items-start gap-2 px-2 py-1.5 text-[11px] text-emerald-900"
                                  >
                                    <span class="text-emerald-600">✓</span>
                                    <span class="min-w-0 flex-1">{row.message}</span>
                                  </li>
                                {/each}
                              </ul>
                            {/if}
                          {/if}
                        {/if}
                      </li>
                    {/each}
                  </ul>
                </div>
              {/if}
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</div>
