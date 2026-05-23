import type { LoadSamplesResult } from '$features/behavior-model/application/use-cases/LoadSamples';

/**
 * Format a "Load samples" result into the alert dialog body. Projects and
 * features are surfaced separately so the user reads "1 project: eShop" with
 * its features indented underneath instead of one flat bullet list.
 */
export const formatSampleSummary = (
  result: LoadSamplesResult,
  side: 'added' | 'skipped'
): string => {
  const projects = side === 'added' ? result.addedProjects : result.skippedProjects;
  const features = side === 'added' ? result.addedFeatures : result.skippedFeatures;
  const lines: string[] = [];

  if (projects.length > 0) {
    const noun = projects.length === 1 ? 'project' : 'projects';
    lines.push(`${projects.length} ${noun}: ${projects.map((p) => p.name).join(', ')}`);
  }

  if (features.length > 0) {
    const noun = features.length === 1 ? 'feature' : 'features';
    const lead =
      projects.length > 0 ? `with ${features.length} ${noun}` : `${features.length} ${noun}`;
    lines.push(`${lead}:`);
    for (const f of features) lines.push(`• ${f.name}`);
  }

  return lines.join('\n');
};
