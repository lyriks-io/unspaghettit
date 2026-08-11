<script lang="ts">
  import type { FeatureVerdict, CheckStatus } from '$features/verification/domain/VerificationVerdict';
  import { withBase } from '$shared/routing/appBase';

  let { verdict }: { verdict: FeatureVerdict } = $props();

  const dot: Record<CheckStatus, string> = {
    pass: 'bg-emerald-500',
    warn: 'bg-amber-500',
    fail: 'bg-red-500'
  };
  const text: Record<CheckStatus, string> = {
    pass: 'text-emerald-700',
    warn: 'text-amber-700',
    fail: 'text-red-700'
  };
</script>

<section class="rounded-xl border border-slate-200 bg-white shadow-sm shadow-slate-950/5">
  <header class="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
    <h2 class="text-sm font-semibold text-slate-800">{verdict.featureName}</h2>
    <span
      class="rounded-full px-2.5 py-0.5 text-xs font-semibold {verdict.passed
        ? 'bg-emerald-100 text-emerald-700'
        : 'bg-red-100 text-red-700'}"
    >
      {verdict.passed ? 'PASS' : 'FAIL'}
    </span>
  </header>

  <ul class="divide-y divide-slate-50">
    {#each verdict.checks as check (check.id)}
      <li class="px-4 py-2.5">
        <div class="flex items-center gap-2.5">
          <span class="h-2 w-2 shrink-0 rounded-full {dot[check.status]}" aria-hidden="true"></span>
          <span class="w-28 shrink-0 text-xs font-medium {text[check.status]}">{check.label}</span>
          <span class="text-xs text-slate-500">{check.detail}</span>
        </div>
        {#if check.traces && check.traces.length > 0}
          <ul class="mt-1.5 space-y-1.5 pl-[2.6rem]">
            {#each check.traces as trace, ti (trace.label + ti)}
              <li class="text-[11px] leading-relaxed text-slate-600">
                <span class="font-medium text-slate-700">{trace.label}</span>
                <span class="ml-1 inline-flex flex-wrap items-center gap-1 align-middle">
                  {#each trace.path as step, si (si)}
                    {#if si > 0}<span class="text-slate-300">→</span>{/if}
                    <span class="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-700">{step}</span>
                  {/each}
                </span>
                {#if trace.actionId && trace.surfaceId}
                  <a
                    class="ml-1 whitespace-nowrap text-brand-700 hover:underline"
                    href={withBase(`/features/${verdict.featureId}?surface=${trace.surfaceId}&panel=actions&focus=action:${trace.actionId}`)}
                    title="Jump to the violating action"
                  >
                    open ↗
                  </a>
                {/if}
              </li>
            {/each}
          </ul>
        {:else if check.items && check.items.length > 0}
          <ul class="mt-1.5 space-y-1 pl-[2.6rem]">
            {#each check.items as item (item)}
              <li class="font-mono text-[11px] leading-relaxed text-slate-600">
                <span class="text-slate-300">—</span>
                {item}
              </li>
            {/each}
          </ul>
        {/if}
      </li>
    {/each}
  </ul>
</section>
