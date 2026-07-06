<script lang="ts">
  /**
   * The header's home link: logo plus wordmark. Swaps to the Lyriks lockup
   * (logo + stacked "Community Edition" label) while that theme is active.
   */
  type Props = {
    lyriks: boolean;
    dark: boolean;
  };

  let { lyriks, dark }: Props = $props();
</script>

<a href="/" class="flex shrink-0 items-center gap-2.5">
  <img
    src={lyriks ? '/lyriks_logo.svg' : '/unspaghettit_logo.png'}
    alt={lyriks ? 'Lyriks' : 'Unspaghettit'}
    class={lyriks ? 'h-9 w-9 shrink-0' : 'h-12 w-auto'}
  />
  {#if lyriks}
    <!-- Clean stacked lockup: wordmark with an aligned uppercase
         edition label below (the old absolute subtitle overflowed
         because "community edition" is wider than "Lyriks"). -->
    <span class="hidden flex-col items-start leading-none sm:flex">
      <span
        class="font-brand text-2xl font-bold tracking-tight {dark
          ? 'text-white'
          : 'text-slate-950'}">Lyriks.io</span
      >
      <span
        class="mt-1 pl-px text-[9px] font-semibold uppercase tracking-[0.18em] {dark
          ? 'text-white/75'
          : 'text-slate-500'}">Community Edition</span
      >
    </span>
  {:else}
    <span
      class="relative hidden font-brand text-3xl font-semibold leading-none sm:inline-block {dark
        ? 'text-white'
        : 'text-slate-950'}"
    >
      Unspaghettit
      <span
        class="font-grotesk absolute right-0 -bottom-2 text-[10px] font-medium tracking-wide {dark
          ? 'text-white/70'
          : 'text-slate-500'}">by Lyriks.io</span
      >
    </span>
  {/if}
</a>
