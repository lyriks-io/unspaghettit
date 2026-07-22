<script lang="ts">
  import type { Feature } from '$features/behavior-model/domain/entities/Feature';
  import { committedActions } from '$features/behavior-model/domain/entities/Action';
  import type { Project } from '$features/projects/domain/entities/Project';
  import {
    digestHasContent,
    type DigestDetailLevel,
    type DigestLine,
    type DigestScope
  } from '$features/behavior-digest/domain/DigestSpec';
  import type { DigestScopeRef } from '$features/behavior-digest/domain/ports/DigestProjector';
  import {
    digestProjector,
    markdownDigestExporter
  } from '$features/behavior-digest/application/digestComposition';

  type Props = { feature?: Feature; features?: readonly Feature[]; project?: Project };
  let { feature, features, project }: Props = $props();

  const baseFeatures = $derived(features ?? (feature ? [feature] : []));
  const hasProject = $derived(project != null);

  // --- digest state machine (mirrors the feature spec's state paths) ---
  // `scopeOverride` is the user's explicit pick; until they choose, the scope
  // defaults to the whole project (on a project) or the whole feature.
  let scopeOverride = $state<DigestScope | null>(null);
  const scopeKind = $derived(scopeOverride ?? (hasProject ? 'project' : 'feature'));
  let selectedFeatureId = $state('');
  let selectedSurfaceId = $state('');
  let selectedActionId = $state('');
  let detailLevel = $state<DigestDetailLevel>('standard');
  let note = $state('');

  const loaded = $derived(baseFeatures.length > 0);
  const currentFeature = $derived(
    feature ?? baseFeatures.find((f) => String(f.id) === selectedFeatureId) ?? baseFeatures[0]
  );
  const surfaces = $derived(currentFeature?.surfaces ?? []);
  const currentSurface = $derived(
    surfaces.find((s) => String(s.id) === selectedSurfaceId) ?? surfaces[0]
  );
  const currentActions = $derived(committedActions(currentSurface?.actions ?? []));
  const currentAction = $derived(
    currentActions.find((a) => String(a.id) === selectedActionId) ?? currentActions[0]
  );

  // The effective selection is PURELY DERIVED, with a fallback to the first
  // option. A stale or empty pick (after switching scope, surface, feature, or
  // navigating between pages) transparently falls back, so the summary always
  // reprojects in the same render pass. Deliberately no $effect writes back into
  // state the deriveds read: that write-back-a-beat-later is exactly what made
  // the list refresh late, or not at all.
  const scopeRef = $derived.by<DigestScopeRef | null>(() => {
    if (scopeKind === 'project') return { kind: 'project' };
    if (!currentFeature) return null;
    const featureId = String(currentFeature.id);
    if (scopeKind === 'feature') return { kind: 'feature', featureId };
    const surfaceId = String(currentSurface?.id ?? '');
    if (scopeKind === 'surface') return { kind: 'surface', featureId, surfaceId };
    return { kind: 'action', featureId, surfaceId, actionId: String(currentAction?.id ?? '') };
  });

  const spec = $derived.by(() =>
    scopeRef ? digestProjector.project({ features: baseFeatures, project, scope: scopeRef, detailLevel }) : null
  );
  const hasContent = $derived(spec != null && digestHasContent(spec));

  const scopeOptions = $derived<{ value: DigestScope; label: string }[]>(
    hasProject
      ? [
          { value: 'project', label: 'Whole project' },
          { value: 'feature', label: 'One feature' },
          { value: 'surface', label: 'One surface' },
          { value: 'action', label: 'One action' }
        ]
      : [
          { value: 'feature', label: 'Whole feature' },
          { value: 'surface', label: 'One surface' },
          { value: 'action', label: 'One action' }
        ]
  );
  const levels: { value: DigestDetailLevel; label: string }[] = [
    { value: 'glance', label: 'Glance' },
    { value: 'standard', label: 'Standard' },
    { value: 'full', label: 'Full' }
  ];

  const selectScope = (next: DigestScope): void => {
    scopeOverride = next;
    note = '';
  };

  // Turn a line's source element into a deep-link into the editor, so clicking a
  // sentence jumps straight to the surface / action / invariant it came from.
  const jumpHref = (line: DigestLine): string | null => {
    const fid = line.sourceFeatureId;
    const type = line.sourceElementType;
    const sid = line.sourceSurfaceId;
    if (type === 'feature' && fid) return `/features/${fid}`;
    if (!fid) return null;
    if (type === 'surface' && line.sourceElementId) return `/features/${fid}?surface=${line.sourceElementId}`;
    if (type === 'action' && sid && line.sourceElementId)
      return `/features/${fid}?surface=${sid}&panel=actions&focus=action:${line.sourceElementId}`;
    if (type === 'invariant' && sid)
      return `/features/${fid}?surface=${sid}&panel=invariants&focus=invariant:${line.sourceElementId}`;
    if (type === 'transition' && sid) return `/features/${fid}?surface=${sid}`;
    return `/features/${fid}`;
  };

  const slug = (title: string): string =>
    title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'digest';

  const copyMarkdown = async (): Promise<void> => {
    if (!spec) return;
    try {
      await navigator.clipboard.writeText(markdownDigestExporter.export(spec));
      note = 'Copied as Markdown.';
    } catch {
      note = 'Copy failed.';
    }
  };

  const downloadMarkdown = (): void => {
    if (!spec) return;
    try {
      const blob = new Blob([markdownDigestExporter.export(spec)], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${slug(spec.title)}.md`;
      anchor.click();
      URL.revokeObjectURL(url);
      note = 'Downloaded Markdown.';
    } catch {
      note = 'Download failed.';
    }
  };
</script>

<section class="mx-auto w-full max-w-4xl">
  {#if !loaded}
    <div class="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-6 py-16 text-center">
      <p class="text-sm font-medium text-slate-700">No model open</p>
      <p class="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
        Open a feature or project to read a plain-language summary of it.
      </p>
    </div>
  {:else}
    <!-- Toolbar: scope, detail level, export. The summary reprojects reactively. -->
    <div class="mb-4 flex flex-wrap items-center gap-3">
      <div class="inline-flex overflow-hidden rounded-lg border border-slate-200">
        {#each scopeOptions as option}
          <button
            type="button"
            onclick={() => selectScope(option.value)}
            class="h-9 px-3 text-sm font-medium transition {scopeKind === option.value
              ? 'bg-slate-900 text-white'
              : 'bg-white text-slate-700 hover:bg-slate-50'}"
          >
            {option.label}
          </button>
        {/each}
      </div>

      <!-- Each picker carries a visible name: with two or three dropdowns side by
           side (and features/surfaces that can share a name), an unlabeled select
           doesn't say which level of the model it narrows. -->
      {#if hasProject && scopeKind !== 'project'}
        <label class="flex items-center gap-1.5 text-xs font-medium text-slate-500">
          Feature
          <select
            value={String(currentFeature?.id ?? '')}
            onchange={(e) => (selectedFeatureId = e.currentTarget.value)}
            class="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-500/15"
          >
            {#each baseFeatures as f}
              <option value={String(f.id)}>{f.name}</option>
            {/each}
          </select>
        </label>
      {/if}
      {#if scopeKind === 'surface' || scopeKind === 'action'}
        <label class="flex items-center gap-1.5 text-xs font-medium text-slate-500">
          Surface
          <select
            value={String(currentSurface?.id ?? '')}
            onchange={(e) => (selectedSurfaceId = e.currentTarget.value)}
            class="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-500/15"
          >
            {#each surfaces as s}
              <option value={String(s.id)}>{s.name}</option>
            {/each}
          </select>
        </label>
      {/if}
      {#if scopeKind === 'action'}
        <label class="flex items-center gap-1.5 text-xs font-medium text-slate-500">
          Action
          <select
            value={String(currentAction?.id ?? '')}
            onchange={(e) => (selectedActionId = e.currentTarget.value)}
            class="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-500/15"
          >
            {#each currentActions as a}
              <option value={String(a.id)}>{a.name}</option>
            {/each}
          </select>
        </label>
      {/if}

      <div class="inline-flex overflow-hidden rounded-lg border border-slate-200">
        {#each levels as option}
          <button
            type="button"
            onclick={() => (detailLevel = option.value)}
            class="h-9 px-3 text-sm font-medium transition {detailLevel === option.value
              ? 'bg-brand-600 text-white'
              : 'bg-white text-slate-700 hover:bg-slate-50'}"
          >
            {option.label}
          </button>
        {/each}
      </div>

      <div class="ml-auto flex items-center gap-2">
        <button
          type="button"
          disabled={!hasContent}
          onclick={copyMarkdown}
          class="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition enabled:hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Copy as Markdown
        </button>
        <button
          type="button"
          disabled={!hasContent}
          onclick={downloadMarkdown}
          class="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition enabled:hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Download
        </button>
      </div>
    </div>

    {#if note}
      <p class="mb-3 text-xs text-slate-500" aria-live="polite">{note}</p>
    {/if}

    <article class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm shadow-slate-950/5">
      <header class="border-b border-slate-200 bg-slate-950 px-5 py-4 text-white">
        <p class="text-xs font-semibold uppercase tracking-wide text-cyan-200">Summary</p>
        <h2 class="mt-1 text-xl font-semibold">{spec?.title}</h2>
        {#if spec?.purposeLine}
          <p class="mt-2 max-w-2xl text-sm leading-6 text-slate-300">{spec.purposeLine}</p>
        {/if}
      </header>

      {#if !hasContent}
        <div class="px-5 py-12 text-center">
          <p class="text-sm font-medium text-slate-700">Nothing to summarize here yet</p>
          <p class="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
            {scopeKind === 'project'
              ? 'Add a feature to this project to see a summary.'
              : `Add actions, state, or rules to this ${scopeKind} to see a summary.`}
          </p>
        </div>
      {:else}
        <div class="divide-y divide-slate-100">
          {#each spec?.sections ?? [] as section}
            <div class="px-5 py-4">
              <h3 class="text-xs font-semibold uppercase tracking-wide text-slate-500">{section.heading}</h3>
              <ul class="mt-2 space-y-0.5">
                {#each section.lines as line}
                  {@const href = jumpHref(line)}
                  <li>
                    <div class="flex gap-2">
                      <span class="mt-[0.6rem] h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" aria-hidden="true"></span>
                      {#if href}
                        <a
                          {href}
                          class="group flex-1 rounded-md px-2 py-1 text-sm leading-6 transition hover:bg-brand-50"
                          title={line.sourceElementType
                            ? `Open this ${line.sourceElementType} in the editor`
                            : undefined}
                        >
                          {#if line.label}<span class="font-semibold text-slate-900 group-hover:text-brand-800"
                              >{line.label}</span
                            >{#if line.text}{': '}{/if}{/if}{#if line.text}<span class="text-slate-700">{line.text}</span
                            >{/if}
                          <span
                            class="ml-0.5 text-brand-400 opacity-0 transition group-hover:opacity-100"
                            aria-hidden="true">&rarr;</span
                          >
                        </a>
                      {:else}
                        <span class="flex-1 px-2 py-1 text-sm leading-6">
                          {#if line.label}<span class="font-semibold text-slate-900">{line.label}</span
                            >{#if line.text}{': '}{/if}{/if}{#if line.text}<span class="text-slate-700">{line.text}</span
                            >{/if}
                        </span>
                      {/if}
                    </div>
                    {#if line.details && line.details.length > 0}
                      <ul class="mb-1 ml-7 mt-0.5 space-y-0.5">
                        {#each line.details as detail}
                          <li class="flex gap-2 text-xs leading-5 text-slate-500">
                            <span
                              class="mt-[0.4rem] h-1 w-1 shrink-0 rounded-full bg-slate-300"
                              aria-hidden="true"
                            ></span>
                            <span>{detail}</span>
                          </li>
                        {/each}
                      </ul>
                    {/if}
                  </li>
                {/each}
              </ul>
            </div>
          {/each}
        </div>
      {/if}
    </article>

    <p class="mt-3 text-center text-xs text-slate-400">
      This summary is generated from the model, not written by hand, so it always matches the spec. Click any line to
      open that element.
    </p>
  {/if}
</section>
