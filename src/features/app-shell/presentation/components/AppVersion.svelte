<script lang="ts">
  import { APP_VERSION, appVersionLabel } from '$features/app-shell/presentation/appVersion';

  /**
   * Small muted stamp of the running release. Deliberately unobtrusive: it's a
   * "which build am I looking at" cue for bug reports, not chrome. The
   * UpdateBanner still owns the "a newer one exists" message.
   */
  let { class: className = '' }: { class?: string } = $props();
</script>

<p
  class="text-xs text-slate-400 select-text {className}"
  title="Unspaghettit {APP_VERSION}"
  data-testid="app-version"
>
  Unspaghettit <span class="font-medium tabular-nums">{appVersionLabel()}</span>
</p>
