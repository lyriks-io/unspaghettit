<script lang="ts">
  /**
   * The header's brand lockup, identical across every theme: the Unspaghettit
   * logo + wordmark linking home, with a "Powered by Lyriks.io" pill badge
   * (the Lyriks three-bar mark + label) linking out to lyriks.io. Only the
   * chrome colours react to the `dark` flag so the lockup stays legible on
   * the vivid gradient header as well as the light one.
   */
  type Props = {
    dark: boolean;
  };

  let { dark }: Props = $props();
</script>

<div class="flex shrink-0 items-center gap-2.5">
  <a href="/" class="shrink-0" aria-label="Unspaghettit home">
    <img src="/unspaghettit_logo.png" alt="Unspaghettit" class="h-12 w-auto" />
  </a>
  <div class="hidden flex-col items-start gap-1 sm:flex">
    <a
      href="/"
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
      <img src="/lyriks_logo.svg" alt="" class="h-3 w-3 shrink-0" aria-hidden="true" />
      <span class="leading-none">Powered by <span class="font-bold">Lyriks.io</span></span>
    </a>
  </div>
</div>
