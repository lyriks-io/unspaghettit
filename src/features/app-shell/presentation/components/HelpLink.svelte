<script lang="ts">
  /** Question-mark icon linking to the tutorial / help page. */
  type Props = {
    dark: boolean;
    lyriks: boolean;
  };

  let { dark, lyriks }: Props = $props();
</script>

<a
  href="/tutorial"
  aria-label="Help & tutorial"
  title="Help & tutorial"
  class="grid h-9 w-9 place-items-center rounded-md transition {lyriks
    ? 'bg-white/15 text-white hover:bg-white/25'
    : dark
      ? 'text-slate-400 hover:bg-slate-800 hover:text-white'
      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'}"
>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="h-5 w-5"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M9.4 9a2.6 2.6 0 0 1 5 1c0 1.6-2.4 2-2.4 3.4" />
    <line x1="12" y1="17.5" x2="12.01" y2="17.5" />
  </svg>
</a>
