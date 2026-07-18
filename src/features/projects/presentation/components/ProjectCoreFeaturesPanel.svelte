<script lang="ts">
  import type { Feature } from '$features/behavior-model/domain/entities/Feature';
  import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';
  import type { Project } from '$features/projects/domain/entities/Project';
  import { coreFeatureReport } from '$features/projects/domain/services/coreFeatures';
  import { coreValueOf } from '$shared/domain/coreFeatureTag';
  import { humanizeTagText } from '$shared/domain/Tags';

  type Props = {
    project: Project;
    features: readonly Feature[];
    saving: boolean;
    onDeclare: (value: string, description: string) => void | Promise<void>;
    onUpdate: (value: string, description: string) => void | Promise<void>;
    onRemove: (value: string) => void | Promise<void>;
    onAssign: (id: FeatureId, value: string | null) => void | Promise<void>;
  };

  let { project, features, saving, onDeclare, onUpdate, onRemove, onAssign }: Props = $props();

  const report = $derived(coreFeatureReport(project, features));
  const declaredValues = $derived(report.groups.map((g) => g.value));
  const declaredSet = $derived(new Set(declaredValues));
  // Each feature's current core value, for the assignment dropdowns.
  const currentCore = $derived(
    new Map(features.map((f) => [String(f.id), coreValueOf(f.tags) ?? '']))
  );
  // Features tagged with a core value that is NOT declared. These are the
  // "undeclared" warnings, surfaced here as an actionable list so the mistag is
  // recoverable in one click (reassign to a real pillar, or clear it).
  const misassigned = $derived(
    features
      .map((f) => ({ id: f.id, name: f.name, value: coreValueOf(f.tags) }))
      .filter((m): m is { id: FeatureId; name: string; value: string } => {
        return m.value !== undefined && !declaredSet.has(m.value);
      })
  );

  let newValue = $state('');
  let newDescription = $state('');

  async function declare() {
    const value = newValue.trim();
    const description = newDescription.trim();
    if (value.length === 0 || description.length === 0) return;
    await onDeclare(value, description);
    newValue = '';
    newDescription = '';
  }

  function assign(id: FeatureId, raw: string) {
    void onAssign(id, raw.length > 0 ? raw : null);
  }

  // Grow the description field to fit its content so the full pillar summary is
  // always visible instead of clipped to one line. Re-fits on input and
  // whenever the stored value changes (e.g. the value reverting after a save).
  function autosize(node: HTMLTextAreaElement, _value: string) {
    const fit = () => {
      node.style.height = 'auto';
      node.style.height = `${node.scrollHeight}px`;
    };
    const raf = requestAnimationFrame(fit);
    node.addEventListener('input', fit);
    return {
      update: fit,
      destroy: () => {
        cancelAnimationFrame(raf);
        node.removeEventListener('input', fit);
      }
    };
  }
</script>

<div class="space-y-5">
  <div class="rounded-md border border-indigo-200 bg-indigo-50/50 p-3 text-xs text-indigo-900">
    <p class="font-semibold">Core features</p>
    <p class="mt-0.5 leading-relaxed">
      A curated set of product pillars for this project. A feature belongs to at most one by
      carrying a reserved <span class="font-mono">core:</span> tag, so you can filter and group by core
      feature precisely, instead of by a sea of descriptive tags. Only values declared here count: a
      feature tagged with an undeclared value shows as a warning below rather than becoming a new pillar.
    </p>
  </div>

  <!-- Declare a new core feature -->
  <form
    class="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3 sm:flex-row sm:items-end"
    onsubmit={(e) => {
      e.preventDefault();
      void declare();
    }}
  >
    <label class="flex-1 text-xs font-medium text-slate-600">
      Core feature
      <input
        type="text"
        bind:value={newValue}
        placeholder="e.g. authentication"
        class="mt-1 h-9 w-full rounded-md border border-slate-300 px-2 text-sm outline-none focus:border-slate-900"
      />
    </label>
    <label class="flex-2 text-xs font-medium text-slate-600">
      Description
      <input
        type="text"
        bind:value={newDescription}
        placeholder="What this pillar covers"
        class="mt-1 h-9 w-full rounded-md border border-slate-300 px-2 text-sm outline-none focus:border-slate-900"
      />
    </label>
    <button
      type="submit"
      disabled={saving || newValue.trim().length === 0 || newDescription.trim().length === 0}
      class="h-9 shrink-0 rounded-md bg-slate-900 px-3 text-xs font-medium text-white disabled:opacity-50"
    >
      Declare
    </button>
  </form>

  {#if report.warnings.length > 0}
    <div class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
      <p class="font-semibold">
        {report.warnings.length} core-feature warning{report.warnings.length === 1 ? '' : 's'}
        <span class="font-normal text-amber-700">(these never block a save)</span>
      </p>
      <ul class="mt-1 space-y-0.5">
        {#each report.warnings as warning (warning.featureId + warning.kind)}
          <li><span class="font-medium">{warning.featureName}:</span> {warning.detail}</li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if report.groups.length === 0}
    <div
      class="rounded-lg border border-dashed border-slate-300 bg-slate-50/40 p-6 text-center text-sm text-slate-500"
    >
      No core features declared yet. Declare one above, then assign features to it below.
    </div>
  {:else}
    <div class="space-y-3">
      {#each report.groups as group (group.value)}
        <div class="rounded-lg border border-slate-200 bg-white p-3">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              <h3 class="text-sm font-semibold text-slate-900">{humanizeTagText(group.value)}</h3>
              <textarea
                value={group.description}
                use:autosize={group.description}
                rows="1"
                onblur={(e) => {
                  // Description is mandatory; ignore an emptied field (the value
                  // reverts to the stored description on the next render).
                  const next = (e.target as HTMLTextAreaElement).value.trim();
                  if (next.length > 0 && next !== group.description) onUpdate(group.value, next);
                }}
                class="mt-1 w-full resize-none overflow-hidden rounded-md border border-slate-200 px-2 py-1 text-xs leading-relaxed text-slate-600 outline-none focus:border-slate-400"
                aria-label={`Description for ${group.value}`}
              ></textarea>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <span class="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
                {group.features.length} feature{group.features.length === 1 ? '' : 's'}
              </span>
              <button
                type="button"
                class="text-xs text-slate-400 hover:text-red-600"
                onclick={() => onRemove(group.value)}
              >
                Remove
              </button>
            </div>
          </div>
          {#if group.features.length > 0}
            <ul class="mt-2 divide-y divide-slate-100">
              {#each group.features as member (member.id)}
                <li class="flex items-center justify-between gap-2 py-1.5 text-sm">
                  <span class="min-w-0 truncate text-slate-700">{member.name}</span>
                  <select
                    class="shrink-0 rounded-md border border-slate-300 px-1.5 py-1 text-xs text-slate-700"
                    value={currentCore.get(String(member.id)) ?? ''}
                    onchange={(e) => assign(member.id, (e.target as HTMLSelectElement).value)}
                  >
                    <option value="">(none)</option>
                    {#each declaredValues as value}
                      <option {value}>{humanizeTagText(value)}</option>
                    {/each}
                  </select>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  {#if misassigned.length > 0}
    <div class="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
      <h3 class="text-sm font-semibold text-amber-900">
        Tagged with an undeclared core feature
        <span
          class="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-normal text-amber-800"
        >
          {misassigned.length}
        </span>
      </h3>
      <p class="mt-0.5 text-[11px] text-amber-700">
        Reassign to a declared core feature, clear it, or declare the value above.
      </p>
      <ul class="mt-2 divide-y divide-amber-100">
        {#each misassigned as member (member.id)}
          <li class="flex items-center justify-between gap-2 py-1.5 text-sm">
            <span class="min-w-0 truncate text-slate-700">
              {member.name}
              <span class="ml-1 font-mono text-[11px] text-amber-700">core:{member.value}</span>
            </span>
            <select
              class="shrink-0 rounded-md border border-slate-300 px-1.5 py-1 text-xs text-slate-700"
              value=""
              onchange={(e) => assign(member.id, (e.target as HTMLSelectElement).value)}
            >
              <option value="">(none)</option>
              {#each declaredValues as value}
                <option {value}>{humanizeTagText(value)}</option>
              {/each}
            </select>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  <!-- Uncategorized: features with no core: tag -->
  <div class="rounded-lg border border-slate-200 bg-white p-3">
    <h3 class="text-sm font-semibold text-slate-900">
      Not in a core feature
      <span class="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-normal text-slate-600">
        {report.uncategorized.length}
      </span>
    </h3>
    {#if report.uncategorized.length === 0}
      <p class="mt-1 text-xs text-slate-500">Every feature belongs to a core feature.</p>
    {:else if declaredValues.length === 0}
      <p class="mt-1 text-xs text-slate-500">
        Declare a core feature above to start assigning features.
      </p>
    {:else}
      <ul class="mt-2 divide-y divide-slate-100">
        {#each report.uncategorized as member (member.id)}
          <li class="flex items-center justify-between gap-2 py-1.5 text-sm">
            <span class="min-w-0 truncate text-slate-700">{member.name}</span>
            <select
              class="shrink-0 rounded-md border border-slate-300 px-1.5 py-1 text-xs text-slate-700"
              value=""
              onchange={(e) => assign(member.id, (e.target as HTMLSelectElement).value)}
            >
              <option value="">(none)</option>
              {#each declaredValues as value}
                <option {value}>{humanizeTagText(value)}</option>
              {/each}
            </select>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>
