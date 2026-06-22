<script lang="ts">
  import type { FeatureVerdict, CheckStatus } from '$features/verification/domain/VerificationVerdict';

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
        {#if check.items && check.items.length > 0}
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
