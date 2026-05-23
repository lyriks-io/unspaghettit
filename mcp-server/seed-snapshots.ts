#!/usr/bin/env node
import { JsonFolderFeatureRepository } from '../src/features/behavior-model/infrastructure/persistence/JsonFolderFeatureRepository';
import { discoverSnapshotDirectory } from '../src/features/behavior-model/infrastructure/persistence/snapshot-discovery';
import { seedFeatures } from '../src/features/behavior-model/infrastructure/seed/seedFeatures';

const main = async (): Promise<void> => {
  const override = process.env.UNSPA_SNAPSHOTS;
  const { directory, source } = discoverSnapshotDirectory({ override: override ?? './unspa' });
  process.stdout.write(`Writing seed snapshots → ${directory} (${source})\n`);

  const repo = new JsonFolderFeatureRepository(directory);
  for (const feature of seedFeatures) {
    await repo.save(feature);
    process.stdout.write(`  + ${feature.name}\n`);
  }
  process.stdout.write(`Done. ${seedFeatures.length} features written.\n`);
};

main().catch((err) => {
  process.stderr.write(`seed:snapshots failed: ${(err as Error).message}\n`);
  process.exit(1);
});
