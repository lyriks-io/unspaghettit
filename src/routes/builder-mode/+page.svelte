<script lang="ts">
  import { page } from '$app/state';
  import { pageTitle } from '$features/app-shell/presentation/pageTitle';
  import BuilderModeDashboard from '$features/builder-mode/presentation/components/BuilderModeDashboard.svelte';
</script>

<svelte:head>
  <title>{pageTitle(page.url, 'Builder Mode')}</title>
</svelte:head>

<BuilderModeDashboard />
