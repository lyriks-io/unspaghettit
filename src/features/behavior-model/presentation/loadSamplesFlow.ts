import { goto } from '$app/navigation';
import { withBase } from '$shared/routing/appBase';
import { featuresStore } from '$features/behavior-model/presentation/stores/featuresStore.svelte';
import { alertDialog, chooseDialog } from '$shared/presentation/dialogs/dialogStore.svelte';
import { formatSampleSummary } from '$features/behavior-model/presentation/loadSamplesMessage';

/**
 * Interactive "Load sample project" flow shared by every entry point
 * (Help page sidebar, getting-started banner, empty states). Loads the
 * bundled samples, then walks the outcome through the app dialogs:
 * nothing bundled, already present, or freshly added, in which case
 * the user can jump straight into the sample project.
 */
export async function runLoadSamplesFlow(): Promise<void> {
  const result = await featuresStore.loadSamples();
  const addedAny = result.addedProjects.length + result.addedFeatures.length > 0;
  const skippedAny = result.skippedProjects.length + result.skippedFeatures.length > 0;
  if (!addedAny && !skippedAny) {
    await alertDialog({
      title: 'Nothing to load',
      message: 'No samples are bundled in this build.',
      tone: 'warning'
    });
    return;
  }
  if (!addedAny) {
    await alertDialog({
      title: 'Already available',
      message:
        formatSampleSummary(result, 'skipped') +
        '\n\nDelete them and load again to restore from the sample.',
      tone: 'info'
    });
    return;
  }
  if (result.addedProjects.length > 0) {
    const projectCount = result.addedProjects.length;
    const featureCount = result.addedFeatures.length;
    const projectNoun = projectCount === 1 ? 'project' : 'projects';
    const featureNoun = featureCount === 1 ? 'feature' : 'features';
    const summary =
      featureCount > 0
        ? `Added ${projectCount} ${projectNoun} and ${featureCount} ${featureNoun}.`
        : `Added ${projectCount} ${projectNoun}.`;
    const featureLine = result.addedFeatures.map((f) => f.name).join(' · ');
    const chosenId = await chooseDialog({
      title: 'Samples loaded',
      message: summary,
      options: result.addedProjects.map((p) => ({
        id: p.id,
        label: `Open ${p.name}`,
        description: featureLine || undefined
      })),
      cancelLabel: 'Close',
      tone: 'success'
    });
    if (chosenId) {
      await goto(withBase(`/projects/${chosenId}`));
    }
    return;
  }
  await alertDialog({
    title: 'Samples loaded',
    message:
      formatSampleSummary(result, 'added') +
      (skippedAny ? `\n\nAlready present:\n${formatSampleSummary(result, 'skipped')}` : ''),
    tone: 'success'
  });
}
