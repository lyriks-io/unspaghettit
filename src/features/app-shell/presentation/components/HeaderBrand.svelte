<script lang="ts">
  import LyriksLogo from './LyriksLogo.svelte';
  import { withBase } from '$shared/routing/appBase';

  /**
   * Header lockup. `brand=lyriks` selects the Lyriks v3 mark and wordmark;
   * otherwise the normal Unspaghettit + "Powered by Lyriks.io" lockup renders.
   */
  type Props = {
    dark: boolean;
    brand?: 'unspaghettit' | 'lyriks';
  };

  let { dark, brand = 'unspaghettit' }: Props = $props();
</script>

{#if brand === 'lyriks'}
  <a
    href="https://lyriks.io"
    target="_blank"
    rel="noopener noreferrer"
    class="font-brand flex shrink-0 items-center gap-2 font-bold outline-none transition focus-visible:rounded focus-visible:ring-2 {dark
      ? 'text-white hover:text-white/90 focus-visible:ring-white/60'
      : 'text-slate-950 hover:text-violet-700 focus-visible:ring-violet-400'}"
    aria-label="Lyriks.io home"
  >
    <LyriksLogo size={28} />
    <span class="flex flex-col items-start">
      <span class="text-xl leading-none tracking-tight">Lyriks.io</span>
      <span
        class="mt-1 text-[10px] leading-none font-semibold tracking-[0.12em] {dark
          ? 'text-white/75'
          : 'text-slate-500'}">Behavior editor</span
      >
    </span>
  </a>
{:else}
  <div class="flex shrink-0 items-center gap-2.5">
    <a href={withBase('/')} class="shrink-0" aria-label="Unspaghettit home">
      <img src={withBase('/unspaghettit_logo.png')} alt="Unspaghettit" class="h-12 w-auto" />
    </a>
    <div class="hidden flex-col items-start gap-1 sm:flex">
      <a
        href={withBase('/')}
        class="font-brand text-2xl font-semibold leading-none {dark
          ? 'text-white'
          : 'text-slate-950'}">Unspaghettit</a
      >
      <!-- The badge is a sibling anchor (not nested in the home link) so it can
           legally link out to lyriks.io. -->
      <a
        href="https://lyriks.io"
        target="_blank"
        rel="noopener noreferrer"
        title="Powered by Lyriks.io"
        class="inline-flex items-center gap-1.5 rounded-full py-0.5 pr-2 pl-1.5 text-[9px] font-semibold tracking-wide ring-1 transition {dark
          ? 'bg-white/10 text-white/80 ring-white/25 hover:bg-white/20 hover:text-white'
          : 'bg-slate-50 text-slate-500 ring-slate-200 hover:bg-slate-100 hover:text-slate-800'}"
      >
        <img src={withBase('/lyriks_logo.svg')} alt="" class="h-3 w-3 shrink-0" aria-hidden="true" />
        <span class="leading-none">Powered by <span class="font-bold">Lyriks.io</span></span>
      </a>
    </div>
  </div>
{/if}
