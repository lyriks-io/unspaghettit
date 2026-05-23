<script lang="ts">
  import type { Feature } from '$features/behavior-model/domain/entities/Feature';
  import { editorStore } from '$features/behavior-model/presentation/stores/editorStore.svelte';
  import {
    computeImplementationBreakdown,
    type CapabilityImplementationEntry,
    type SurfaceImplementationEntry,
    type SurfaceLevelImplementationEntry
  } from '$features/implementation-status/domain/ImplementationBreakdown';
  import {
    ALL_ENTITY_TYPES,
    type AuditMeta,
    type EntityType,
    type ExpectedEntity,
    type FoundEntity
  } from '$features/implementation-status/domain/ImplementationStatus';
  import {
    diffSpecAndCaptured,
    projectSpecEntity,
    type FieldDiff
  } from '$features/implementation-status/domain/FieldDiff';
  import {
    applyCapturedFieldToSpec,
    isPathApplicable
  } from '$features/implementation-status/domain/ApplyCapturedToSpec';
  import { featureStore } from '$features/behavior-model/presentation/stores/featureStore.svelte';
  import { implementationStatusStore } from '$features/implementation-status/presentation/stores/implementationStatusStore.svelte';

  type Props = { feature: Feature };
  let { feature }: Props = $props();

  // Store lifecycle is owned by the feature editor; this panel only reads.
  // Mounting/unmounting on tab switches must not clear the status (would flash
  // 0% in the feature health strip) or drop the WS subscription (would miss
  // live MCP-side updates while the user is on another insights tab).

  const breakdown = $derived(
    computeImplementationBreakdown(feature, implementationStatusStore.status)
  );

  let expandedSurfaces = $state<Record<string, boolean>>({});
  let expandedCapabilities = $state<Record<string, boolean>>({});
  let expandedSurfaceLevel = $state<Record<string, boolean>>({});
  let diffMode = $state<boolean>(false);

  function toggleSurface(id: string) {
    expandedSurfaces = { ...expandedSurfaces, [id]: !expandedSurfaces[id] };
  }
  function toggleCapability(id: string) {
    expandedCapabilities = { ...expandedCapabilities, [id]: !expandedCapabilities[id] };
  }
  function toggleSurfaceLevel(id: string) {
    expandedSurfaceLevel = { ...expandedSurfaceLevel, [id]: !expandedSurfaceLevel[id] };
  }

  function navigateToCapability(surfaceId: string, actionId: string) {
    editorStore.navigateTo({
      surfaceId: surfaceId as never,
      actionId: actionId as never
    });
  }

  function pctColor(percentage: number, hasExpected: boolean): string {
    if (!hasExpected) return 'hsl(220, 10%, 70%)';
    const hue = (percentage / 100) * 120;
    return `hsl(${Math.round(hue)}, 70%, 45%)`;
  }

  function panelTone(entry: SurfaceImplementationEntry): string {
    if (entry.expectedCount === 0) return 'bg-neutral-50 border-neutral-200 text-neutral-700';
    if (entry.percentage >= 80) return 'bg-emerald-50 border-emerald-200 text-emerald-900';
    if (entry.percentage >= 50) return 'bg-amber-50 border-amber-200 text-amber-900';
    return 'bg-red-50 border-red-200 text-red-900';
  }

  function relTime(iso: string | null): string {
    if (!iso) return 'never';
    const ts = Date.parse(iso);
    if (Number.isNaN(ts)) return iso;
    const diff = Date.now() - ts;
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.round(diff / 60_000)} min ago`;
    if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} h ago`;
    const days = Math.round(diff / 86_400_000);
    return `${days} day${days === 1 ? '' : 's'} ago`;
  }

  /** Human-readable absolute timestamp. Locale month + day + hh:mm. */
  function absTime(iso: string | null): string {
    if (!iso) return 'never';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  /**
   * True when SSE has signaled a change but the local fetch hasn't caught up
   * yet. In normal operation this flips true for ~ms before the auto-fetch
   * lands; if the fetch fails or the watcher is flaky (Windows fs.watch) it
   * stays true so the manual Refresh button stays visible until clicked.
   */
  const hasPendingUpdate = $derived(() => {
    const sig = implementationStatusStore.lastUpdateSignalAt;
    const fetched = implementationStatusStore.lastFetchedAt;
    if (!sig) return false;
    if (!fetched) return true;
    return Date.parse(sig) > Date.parse(fetched);
  });

  function capStateLabel(entry: CapabilityImplementationEntry): string {
    if (entry.expectedCount === 0) return 'nothing to tag yet';
    if (!entry.reported) return 'not yet audited';
    if (entry.foundCount === entry.expectedCount) return 'fully tagged';
    return `${entry.foundCount}/${entry.expectedCount} tagged`;
  }

  function entityTypeLabel(t: EntityType): string {
    switch (t) {
      case 'action':
        return 'Action';
      case 'event':
        return 'Events';
      case 'rule':
        return 'Rules';
      case 'invariant':
        return 'Invariants';
      case 'transition':
        return 'Transitions';
      case 'state':
        return 'States';
      case 'data':
        return 'Entity';
      case 'surface_rule':
        return 'Surface rules';
      case 'surface_invariant':
        return 'Surface invariants';
    }
  }

  function groupByType<T extends { entityType: EntityType }>(items: readonly T[]): Map<EntityType, T[]> {
    const m = new Map<EntityType, T[]>();
    for (const t of ALL_ENTITY_TYPES) m.set(t, []);
    for (const item of items) {
      const arr = m.get(item.entityType);
      if (arr) arr.push(item);
    }
    return m;
  }

  type Row = { expected: ExpectedEntity; found: FoundEntity | null };

  function buildRows(
    expectedList: readonly ExpectedEntity[],
    foundList: readonly FoundEntity[]
  ): { type: EntityType; rows: Row[] }[] {
    const foundByKey = new Map<string, FoundEntity>();
    for (const f of foundList) foundByKey.set(`${f.entityType}:${f.entityId}`, f);
    const grouped = groupByType(expectedList);
    return ALL_ENTITY_TYPES.map((type) => {
      const expected = grouped.get(type) ?? [];
      const rows: Row[] = expected.map((e) => ({
        expected: e,
        found: foundByKey.get(`${e.entityType}:${e.entityId}`) ?? null
      }));
      return { type, rows };
    }).filter((g) => g.rows.length > 0);
  }

  function diffsFor(row: Row): readonly FieldDiff[] | null {
    const projected = projectSpecEntity(feature, row.expected.entityType, row.expected.entityId);
    if (!projected) return null;
    return diffSpecAndCaptured(projected, row.found?.capturedFields ?? null);
  }

  /** Diff rows that actually diverge, mismatches first, then missing-from-captured. */
  function divergentDiffsFor(row: Row): readonly FieldDiff[] | null {
    const all = diffsFor(row);
    if (!all) return null;
    return all
      .filter((d) => !d.equal)
      .slice()
      .sort((a, b) => {
        if (a.missingFromCaptured === b.missingFromCaptured) return a.path.localeCompare(b.path);
        return a.missingFromCaptured ? 1 : -1;
      });
  }

  async function applyToSpec(row: Row, diff: FieldDiff): Promise<void> {
    await featureStore.mutate((current) =>
      applyCapturedFieldToSpec(
        current,
        row.expected.entityType,
        row.expected.entityId,
        diff.path,
        diff.captured
      )
    );
  }

  function formatValue(v: unknown): string {
    if (v === undefined) return '-';
    if (v === null) return 'null';
    if (typeof v === 'string') return v.length > 0 ? v : '""';
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }

  function shortSha(sha: string | undefined): string {
    return sha ? sha.slice(0, 7) : '';
  }

  const KIND_COLORS: Record<string, string> = {
    'svelte-route': 'bg-orange-100 text-orange-800',
    'svelte-store': 'bg-violet-100 text-violet-800',
    'svelte-component': 'bg-sky-100 text-sky-800',
    'mcp-tool': 'bg-teal-100 text-teal-800',
    'mcp-entrypoint': 'bg-teal-200 text-teal-900',
    'domain-service': 'bg-indigo-100 text-indigo-800'
  };

  function kindClass(kind: string): string {
    return KIND_COLORS[kind] ?? 'bg-neutral-100 text-neutral-700';
  }

  function hasAuditMeta(meta: AuditMeta | undefined): boolean {
    if (!meta) return false;
    return !!(
      meta.kind ||
      meta.auditedAt ||
      meta.gitCommit ||
      meta.testFile ||
      meta.relatedFiles?.length ||
      meta.knownGaps?.length
    );
  }
</script>

<div class="space-y-4 text-sm">
  <!-- ── Global header ─────────────────────────────────────────────── -->
  <section
    class="rounded-md border p-3 {breakdown.expectedCount === 0
      ? 'bg-neutral-50 border-neutral-200 text-neutral-700'
      : breakdown.percentage >= 80
        ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
        : breakdown.percentage >= 50
          ? 'bg-amber-50 border-amber-200 text-amber-900'
          : 'bg-red-50 border-red-200 text-red-900'}"
  >
    <div class="flex items-baseline justify-between gap-2">
      <span class="text-xs font-semibold uppercase tracking-wide opacity-80">
        Implementation
      </span>
      <div class="flex items-center gap-1.5">
        {#if hasPendingUpdate() || implementationStatusStore.refreshing}
          <button
            type="button"
            class="group inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-[10px] font-semibold text-amber-800 shadow-sm transition hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-300 disabled:cursor-wait"
            onclick={() => implementationStatusStore.refresh()}
            disabled={implementationStatusStore.refreshing || implementationStatusStore.loading}
            title={implementationStatusStore.refreshing
              ? 'Fetching the latest report…'
              : 'A new report was detected. Click to load it'}
          >
            <span
              class="inline-block {implementationStatusStore.refreshing
                ? 'animate-spin'
                : 'animate-pulse'}"
            >↻</span>
            <span>{implementationStatusStore.refreshing ? 'Refreshing' : 'New report'}</span>
          </button>
        {/if}
        <button
          type="button"
          class="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold transition focus:outline-none focus:ring-2 focus:ring-brand-300 {diffMode
            ? 'bg-brand-600 text-white shadow-sm hover:bg-brand-700'
            : 'border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50'}"
          aria-pressed={diffMode}
          onclick={() => (diffMode = !diffMode)}
          title="Toggle field-level diff between spec and captured code values"
        >
          <span aria-hidden="true">{diffMode ? '●' : '○'}</span>
          <span>Diff</span>
        </button>
        <span
          class="text-[10px] tracking-wide opacity-70"
          title={implementationStatusStore.lastFetchedAt
            ? `Last fetched ${absTime(implementationStatusStore.lastFetchedAt)}`
            : 'Never fetched'}
        >
          {#if breakdown.hasReport}
            v{breakdown.revision} · {relTime(breakdown.updatedAt)}
          {:else}
            no report yet
          {/if}
        </span>
      </div>
    </div>
    <div
      class="mt-1.5 h-1.5 w-full rounded-full"
      style="background-color: {pctColor(breakdown.percentage, breakdown.expectedCount > 0)}"
    ></div>
    <div class="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
      <span class="font-bold">
        {breakdown.foundCount} / {breakdown.expectedCount} tags
      </span>
      <span class="font-bold">{breakdown.percentage}%</span>
      {#if breakdown.missingCount > 0}
        <span class="font-bold">{breakdown.missingCount} missing</span>
      {/if}
      {#if breakdown.extraCount > 0}
        <span class="font-bold text-amber-700">{breakdown.extraCount} extra</span>
      {/if}
      {#if breakdown.capabilitiesWithExpected > 0}
        <span class="opacity-70">
          {breakdown.reportedCount}/{breakdown.capabilitiesWithExpected} actions audited
        </span>
      {/if}
    </div>
    {#if breakdown.updatedAt}
      <div class="mt-1 text-[10px] opacity-60" title={breakdown.updatedAt}>
        last report {absTime(breakdown.updatedAt)}
      </div>
    {/if}
    {#if diffMode}
      <p class="mt-2 text-[10px] leading-snug opacity-80">
        Only fields that diverge are shown. Mismatches in red, missing captures in amber.
        Entities with no divergence collapse to a green check.
      </p>
    {/if}
  </section>

  {#if !breakdown.hasReport}
    <p class="rounded-md border border-dashed border-neutral-300 p-3 text-xs text-neutral-600">
      No <code>report_implementation_status</code> received yet. Write the behavioral index
      to <code>.unspa.json</code> in your repo, then call
      <code>report_implementation_status_batch</code>. The result lands here.
    </p>
  {/if}

  <!-- ── Per surface ──────────────────────────────────────────────── -->
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
          {@const surfaceExpanded = expandedSurfaces[sid] ?? diffMode}
          {@const surfaceLevelExpanded = expandedSurfaceLevel[sid] ?? diffMode}
          <li class="rounded-md border {panelTone(entry).split(' ').slice(1).join(' ')}">
            <button
              type="button"
              class="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left text-xs"
              onclick={() => toggleSurface(sid)}
            >
              <span class="text-neutral-400">{surfaceExpanded ? '▾' : '▸'}</span>
              <span class="flex-1 truncate font-medium text-neutral-900">
                {entry.surface.name}
              </span>
              {#if entry.expectedCount === 0}
                <span class="rounded-md bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-600">
                  no tags expected
                </span>
              {:else}
                <span class="rounded-md bg-white/70 px-1.5 py-0.5 text-[10px] font-mono">
                  {entry.foundCount}/{entry.expectedCount}
                </span>
                <span class="rounded-md bg-white/70 px-1.5 py-0.5 text-[10px] font-mono">
                  {entry.percentage}%
                </span>
              {/if}
            </button>
            <div class="px-3 pb-2">
              <div
                class="h-1 w-full rounded-full"
                style="background-color: {pctColor(entry.percentage, entry.expectedCount > 0)}"
              ></div>
            </div>

            {#if surfaceExpanded}
              <!-- Surface-level entities (state, data, surface rules/invariants) -->
              {#if entry.surfaceLevel.expectedCount > 0}
                {@const sl = entry.surfaceLevel as SurfaceLevelImplementationEntry}
                <div class="border-t border-neutral-100 bg-white">
                  <button
                    type="button"
                    class="flex w-full flex-wrap items-center gap-2 px-3 py-1.5 text-left text-[11px]"
                    onclick={() => toggleSurfaceLevel(sid)}
                  >
                    <span class="text-neutral-400">{surfaceLevelExpanded ? '▾' : '▸'}</span>
                    <span class="flex-1 truncate font-medium text-neutral-700">
                      Surface-level (states, data, rules, invariants)
                    </span>
                    {#if !sl.reported}
                      <span class="rounded-md bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-600">
                        not audited
                      </span>
                    {:else}
                      <span class="rounded-md bg-neutral-100 px-1.5 py-0.5 text-[10px] font-mono">
                        {sl.foundCount}/{sl.expectedCount}
                      </span>
                      <span class="rounded-md bg-neutral-100 px-1.5 py-0.5 text-[10px] font-mono">
                        {sl.percentage}%
                      </span>
                    {/if}
                  </button>
                  {#if surfaceLevelExpanded}
                    <div class="border-t border-neutral-100 bg-neutral-50/40 px-3 py-2 text-[11px]">
                      {#if !sl.reported}
                        <p class="text-neutral-500">
                          Run <code>report_implementation_status</code> with <code>surfaceId</code> to populate this section.
                        </p>
                      {:else if hasAuditMeta(sl.status?.auditMeta)}
                        {@const m = sl.status!.auditMeta!}
                        <div class="mb-2 flex flex-wrap items-start gap-1.5 rounded border border-neutral-200 bg-white px-2 py-1.5">
                          {#if m.kind}
                            <span class="rounded px-1.5 py-0.5 font-mono text-[10px] font-medium {kindClass(m.kind)}">{m.kind}</span>
                          {/if}
                          {#if m.auditedAt}
                            <span class="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-600" title={m.auditedAt}>audited {relTime(m.auditedAt)}</span>
                          {/if}
                          {#if m.gitCommit}
                            <span class="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] text-neutral-600" title={m.gitCommit}>{shortSha(m.gitCommit)}</span>
                          {/if}
                          {#if m.testFile}
                            <span class="rounded bg-emerald-50 px-1.5 py-0.5 font-mono text-[10px] text-emerald-700">test: {m.testFile}</span>
                          {/if}
                          {#if m.knownGaps && m.knownGaps.length > 0}
                            <div class="w-full">
                              <p class="text-[10px] font-semibold text-amber-700">Known gaps</p>
                              <ul class="mt-0.5 list-disc space-y-0.5 pl-3">
                                {#each m.knownGaps as gap, i (i)}
                                  <li class="text-[10px] text-amber-800">{gap}</li>
                                {/each}
                              </ul>
                            </div>
                          {/if}
                        </div>
                      {/if}
                      {#each buildRows(sl.expected, sl.found) as group (group.type)}
                        <div class="mb-2 last:mb-0">
                          <p class="mb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
                            {entityTypeLabel(group.type)}
                          </p>
                          <ul class="space-y-1">
                            {#each group.rows as row (`${row.expected.entityType}:${row.expected.entityId}`)}
                              {@const diffs = diffMode ? divergentDiffsFor(row) : null}
                              <li class="rounded border border-neutral-200 bg-white px-2 py-1">
                                <div class="flex items-baseline justify-between gap-2">
                                  <span
                                    class="font-mono text-[11px] {row.found
                                      ? 'text-emerald-700'
                                      : 'text-red-700'}"
                                  >
                                    {row.found ? '✓' : '✗'} {row.expected.entityName ?? row.expected.entityId}
                                  </span>
                                  <span class="font-mono text-[10px] text-neutral-400">
                                    {row.expected.tag}
                                  </span>
                                </div>
                                {#if row.found && row.found.locations.length > 0 && !diffMode}
                                  <ul class="mt-0.5 space-y-1">
                                    {#each row.found.locations as loc, i (i)}
                                      <li>
                                        <div class="flex flex-wrap items-center gap-1 font-mono text-[10px] text-neutral-600">
                                          <span>{loc.file}{loc.line !== undefined ? `:${loc.line}` : ''}</span>
                                          {#if loc.stale}
                                            <span class="rounded bg-amber-100 px-1 py-0 text-[9px] font-semibold text-amber-800" title="The audited signature no longer matches this line. Re-author this entry in .unspa.json">
                                              index stale
                                            </span>
                                            {#if loc.suggestedLine}
                                              <span class="text-amber-700">→ now at :{loc.suggestedLine}</span>
                                            {:else}
                                              <span class="text-amber-700">- signature not found in file</span>
                                            {/if}
                                          {/if}
                                        </div>
                                        {#if loc.snippet}
                                          <pre class="mt-0.5 overflow-x-auto rounded {loc.stale ? 'border-l-2 border-amber-400' : ''} bg-neutral-900 px-2 py-1 text-[10px] leading-snug text-neutral-100">{loc.snippet}</pre>
                                        {/if}
                                      </li>
                                    {/each}
                                  </ul>
                                {/if}
                                {#if diffMode && diffs}
                                  {#if !row.found}
                                    <p class="mt-1 rounded bg-red-50 px-1.5 py-0.5 text-[10px] text-red-700">
                                      entity not captured in code
                                    </p>
                                  {:else if row.found.capturedFields === undefined || row.found.capturedFields === null}
                                    <p class="mt-1 rounded bg-neutral-50 px-1.5 py-0.5 text-[10px] text-neutral-600">
                                      audit reported the location but did not extract field values. Re-run with <code>capturedFields</code> to enable per-field diff
                                    </p>
                                  {:else if diffs.length === 0}
                                    <p class="mt-1 text-[10px] text-emerald-700">
                                      all spec fields match captured code
                                    </p>
                                  {:else}
                                    <table class="mt-1 w-full text-[10px]">
                                      <thead>
                                        <tr class="text-left text-neutral-500">
                                          <th class="font-medium">Field</th>
                                          <th class="font-medium">Spec</th>
                                          <th class="font-medium">Captured (code)</th>
                                          <th></th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {#each diffs as d (d.path)}
                                          {@const canApply =
                                            !d.missingFromCaptured &&
                                            isPathApplicable(row.expected.entityType, d.path)}
                                          <tr class={d.missingFromCaptured ? 'bg-amber-50' : 'bg-red-50'}>
                                            <td class="pr-2 font-mono text-neutral-600">{d.path}</td>
                                            <td class="pr-2 font-mono">{formatValue(d.spec)}</td>
                                            <td
                                              class="font-mono {d.missingFromCaptured
                                                ? 'text-amber-700'
                                                : 'text-red-700'}"
                                            >
                                              {d.missingFromCaptured ? 'not captured' : formatValue(d.captured)}
                                            </td>
                                            <td class="pl-1 text-right">
                                              {#if canApply}
                                                <button
                                                  type="button"
                                                  class="rounded border border-red-300 bg-white px-1.5 py-0 text-[10px] font-medium text-red-700 transition hover:bg-red-100 disabled:opacity-50"
                                                  disabled={featureStore.saving}
                                                  onclick={() => applyToSpec(row, d)}
                                                  title="Overwrite spec value with the captured code value"
                                                >
                                                  Use code →
                                                </button>
                                              {/if}
                                            </td>
                                          </tr>
                                        {/each}
                                      </tbody>
                                    </table>
                                  {/if}
                                {/if}
                              </li>
                            {/each}
                          </ul>
                        </div>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/if}

              {#if entry.perAction.length === 0}
                <p
                  class="border-t border-neutral-100 bg-white px-3 py-2 text-[11px] italic text-neutral-500"
                >
                  No actions on this surface yet.
                </p>
              {:else}
                <ul class="border-t border-neutral-100 bg-white">
                  {#each entry.perAction as capEntry (capEntry.action.id)}
                    {@const cid = String(capEntry.action.id)}
                    {@const capExpanded = expandedCapabilities[cid] ?? diffMode}
                    <li class="border-b border-neutral-100 last:border-b-0">
                      <button
                        type="button"
                        class="flex w-full flex-wrap items-center gap-2 px-3 py-1.5 text-left text-[11px]"
                        onclick={() => toggleCapability(cid)}
                      >
                        <span class="text-neutral-400">{capExpanded ? '▾' : '▸'}</span>
                        <span class="flex-1 truncate text-neutral-800">
                          {capEntry.action.name}
                        </span>
                        {#if capEntry.expectedCount === 0}
                          <span class="text-[10px] italic text-neutral-500">no tags</span>
                        {:else if !capEntry.reported}
                          <span class="rounded-md bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-600">
                            not audited
                          </span>
                        {:else}
                          <span class="rounded-md bg-neutral-100 px-1.5 py-0.5 text-[10px] font-mono">
                            {capEntry.foundCount}/{capEntry.expectedCount}
                          </span>
                          <span class="rounded-md bg-neutral-100 px-1.5 py-0.5 text-[10px] font-mono">
                            {capEntry.percentage}%
                          </span>
                        {/if}
                      </button>
                      <div class="px-3 pb-1">
                        <div
                          class="h-0.5 w-full rounded-full"
                          style="background-color: {pctColor(
                            capEntry.percentage,
                            capEntry.expectedCount > 0
                          )}"
                        ></div>
                      </div>

                      {#if capExpanded}
                        <div class="border-t border-neutral-100 bg-neutral-50/40 px-3 py-2 text-[11px]">
                          <div class="mb-2 flex items-center justify-between">
                            <span class="font-medium text-neutral-700">
                              {capStateLabel(capEntry)}
                            </span>
                            <button
                              type="button"
                              class="rounded-md border border-neutral-300 bg-white px-1.5 py-0 text-[10px] font-medium text-neutral-700 hover:bg-neutral-50"
                              onclick={() => navigateToCapability(sid, cid)}
                            >
                              Open →
                            </button>
                          </div>

                          {#if capEntry.expectedCount === 0}
                            <p class="text-neutral-500">
                              No taggable entities on this action yet (no events, rules,
                              invariants, or transitions).
                            </p>
                          {:else}
                            {#if !capEntry.reported}
                              <p class="mb-2 rounded border border-dashed border-neutral-300 bg-white px-2 py-1 text-[10px] text-neutral-500">
                                Not audited yet. Write <code>.unspa.json</code> then call
                                <code>report_implementation_status_batch</code>. {diffMode
                                  ? "In diff mode you'll still see the spec values on the left; the right column stays empty until a report runs."
                                  : ''}
                              </p>
                            {:else}
                              {@const status = capEntry.status!}
                              <p class="mb-2 text-[10px] uppercase tracking-wide text-neutral-500">
                                Reported {relTime(status.reportedAt)}
                                <span class="opacity-60" title={status.reportedAt}>
                                  ({status.reportedAt})
                                </span>
                              </p>
                              {#if hasAuditMeta(status.auditMeta)}
                                {@const m = status.auditMeta!}
                                <div class="mb-2 flex flex-wrap items-start gap-1.5 rounded border border-neutral-200 bg-white px-2 py-1.5">
                                  {#if m.kind}
                                    <span class="rounded px-1.5 py-0.5 font-mono text-[10px] font-medium {kindClass(m.kind)}">{m.kind}</span>
                                  {/if}
                                  {#if m.auditedAt}
                                    <span class="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-600" title={m.auditedAt}>audited {relTime(m.auditedAt)}</span>
                                  {/if}
                                  {#if m.gitCommit}
                                    <span class="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] text-neutral-600" title={m.gitCommit}>{shortSha(m.gitCommit)}</span>
                                  {/if}
                                  {#if m.testFile}
                                    <span class="rounded bg-emerald-50 px-1.5 py-0.5 font-mono text-[10px] text-emerald-700" title="Test file">test: {m.testFile}</span>
                                  {/if}
                                  {#if m.relatedFiles && m.relatedFiles.length > 0}
                                    <div class="w-full">
                                      <p class="text-[10px] font-semibold text-neutral-500">Related files</p>
                                      <ul class="mt-0.5 space-y-0.5">
                                        {#each m.relatedFiles as rf, i (i)}
                                          <li class="font-mono text-[10px] text-neutral-600">
                                            {rf.file}{rf.line ? `:${rf.line}` : ''}
                                            <span class="text-neutral-400">. {rf.role}</span>
                                          </li>
                                        {/each}
                                      </ul>
                                    </div>
                                  {/if}
                                  {#if m.knownGaps && m.knownGaps.length > 0}
                                    <div class="w-full">
                                      <p class="text-[10px] font-semibold text-amber-700">Known gaps</p>
                                      <ul class="mt-0.5 list-disc space-y-0.5 pl-3">
                                        {#each m.knownGaps as gap, i (i)}
                                          <li class="text-[10px] text-amber-800">{gap}</li>
                                        {/each}
                                      </ul>
                                    </div>
                                  {/if}
                                </div>
                              {/if}
                            {/if}
                            {#each buildRows(capEntry.expected, capEntry.found) as group (group.type)}
                              <div class="mb-2 last:mb-0">
                                <p class="mb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
                                  {entityTypeLabel(group.type)}
                                </p>
                                <ul class="space-y-1">
                                  {#each group.rows as row (`${row.expected.entityType}:${row.expected.entityId}`)}
                                    {@const diffs = diffMode ? divergentDiffsFor(row) : null}
                                    <li class="rounded border border-neutral-200 bg-white px-2 py-1">
                                      <div class="flex items-baseline justify-between gap-2">
                                        <span
                                          class="font-mono text-[11px] {row.found
                                            ? 'text-emerald-700'
                                            : 'text-red-700'}"
                                        >
                                          {row.found ? '✓' : '✗'} {row.expected.entityName ?? row.expected.entityId}
                                        </span>
                                        <span class="font-mono text-[10px] text-neutral-400">
                                          {row.expected.tag}
                                        </span>
                                      </div>
                                      {#if row.found && !diffMode}
                                        {#if row.found.locations.length > 0}
                                          <ul class="mt-0.5 space-y-1">
                                            {#each row.found.locations as loc, i (i)}
                                              <li>
                                                <div class="flex flex-wrap items-center gap-1 font-mono text-[10px] text-neutral-600">
                                                  <span>{loc.file}{loc.line !== undefined ? `:${loc.line}` : ''}</span>
                                                  {#if loc.stale}
                                                    <span class="rounded bg-amber-100 px-1 py-0 text-[9px] font-semibold text-amber-800" title="The audited signature no longer matches this line. Re-author this entry in .unspa.json">
                                                      index stale
                                                    </span>
                                                    {#if loc.suggestedLine}
                                                      <span class="text-amber-700">→ now at :{loc.suggestedLine}</span>
                                                    {:else}
                                                      <span class="text-amber-700">- signature not found in file</span>
                                                    {/if}
                                                  {/if}
                                                </div>
                                                {#if loc.snippet}
                                                  <pre class="mt-0.5 overflow-x-auto rounded {loc.stale ? 'border-l-2 border-amber-400' : ''} bg-neutral-900 px-2 py-1 text-[10px] leading-snug text-neutral-100">{loc.snippet}</pre>
                                                {/if}
                                              </li>
                                            {/each}
                                          </ul>
                                        {/if}
                                        <p class="mt-0.5 text-[10px] text-neutral-400" title={row.found.capturedAt}>
                                          captured {relTime(row.found.capturedAt)}
                                        </p>
                                      {/if}
                                      {#if diffMode && diffs}
                                        {#if !row.found}
                                          <p class="mt-1 rounded bg-red-50 px-1.5 py-0.5 text-[10px] text-red-700">
                                            entity not captured in code
                                          </p>
                                        {:else if diffs.length === 0}
                                          <p class="mt-1 text-[10px] text-emerald-700">
                                            all spec fields match captured code
                                          </p>
                                        {:else}
                                          <table class="mt-1 w-full text-[10px]">
                                            <thead>
                                              <tr class="text-left text-neutral-500">
                                                <th class="font-medium">Field</th>
                                                <th class="font-medium">Spec</th>
                                                <th class="font-medium">Captured (code)</th>
                                                <th></th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {#each diffs as d (d.path)}
                                                {@const canApply =
                                                  !d.missingFromCaptured &&
                                                  isPathApplicable(row.expected.entityType, d.path)}
                                                <tr class={d.missingFromCaptured ? 'bg-amber-50' : 'bg-red-50'}>
                                                  <td class="pr-2 font-mono text-neutral-600">{d.path}</td>
                                                  <td class="pr-2 font-mono">{formatValue(d.spec)}</td>
                                                  <td
                                                    class="font-mono {d.missingFromCaptured
                                                      ? 'text-amber-700'
                                                      : 'text-red-700'}"
                                                  >
                                                    {d.missingFromCaptured ? 'not captured' : formatValue(d.captured)}
                                                  </td>
                                                  <td class="pl-1 text-right">
                                                    {#if canApply}
                                                      <button
                                                        type="button"
                                                        class="rounded border border-red-300 bg-white px-1.5 py-0 text-[10px] font-medium text-red-700 transition hover:bg-red-100 disabled:opacity-50"
                                                        disabled={featureStore.saving}
                                                        onclick={() => applyToSpec(row, d)}
                                                        title="Overwrite spec value with the captured code value"
                                                      >
                                                        Use code →
                                                      </button>
                                                    {/if}
                                                  </td>
                                                </tr>
                                              {/each}
                                            </tbody>
                                          </table>
                                        {/if}
                                      {/if}
                                    </li>
                                  {/each}
                                </ul>
                              </div>
                            {/each}
                            {#if capEntry.status && capEntry.status.extraTags.length > 0}
                              <div class="mt-2">
                                <p class="text-[10px] uppercase tracking-wide text-amber-700">
                                  Drift. Tags found that aren't declared
                                </p>
                                <ul class="mt-1 space-y-0.5">
                                  {#each capEntry.status.extraTags as extra, i (i)}
                                    <li class="font-mono text-[10px] text-amber-800">
                                      {extra.tag}
                                      {#each extra.locations as loc, j (j)}
                                        <span class="ml-1 text-neutral-500">
                                          {loc.file}{loc.line !== undefined ? `:${loc.line}` : ''}
                                        </span>
                                      {/each}
                                    </li>
                                  {/each}
                                </ul>
                              </div>
                            {/if}
                          {/if}
                        </div>
                      {/if}
                    </li>
                  {/each}
                </ul>
              {/if}
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</div>
