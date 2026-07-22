<script lang="ts">
  import { page } from '$app/state';
  import { pageTitle } from '$features/app-shell/presentation/pageTitle';
  import ProjectsIndex from '$features/projects/presentation/components/ProjectsIndex.svelte';
</script>

<svelte:head>
  <title>{pageTitle(page.url, 'Projects')}</title>
</svelte:head>

<ProjectsIndex />
