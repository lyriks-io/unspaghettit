import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { importFeatureFromJson } from '$features/behavior-model/infrastructure/io/FeatureJson';
import { introducedValidationErrors } from '$features/behavior-model/domain/services/FeatureValidator';

/**
 * Every shipped sample must survive the WRITE GATE, not just parse.
 *
 * `Load samples` creates the samples as BRAND-NEW features, and the diff-aware
 * gate deliberately gives a new feature no protection — with no prior snapshot
 * every error counts as "introduced". So a sample that carries any validation
 * error makes the button fail with an opaque `Snapshot save failed (400)`,
 * which is exactly how 0.14.1 shipped with a dead rule in the eShop sample.
 *
 * Passing `null` as the prior is what reproduces that path here. Any new
 * validation rule that the bundled samples violate now fails the unit suite
 * instead of the end-to-end one (or a user's first click).
 */
const sampleFiles = (dir: string): readonly string[] => {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sampleFiles(full));
    else if (name.endsWith('.feature.json')) out.push(full);
  }
  return out;
};

const files = sampleFiles('samples');

describe('bundled samples', () => {
  it('ships at least one sample (guards against the glob silently finding nothing)', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s loads and passes the write gate as a new feature', (file) => {
    const feature = importFeatureFromJson(readFileSync(file, 'utf8'));
    expect(introducedValidationErrors(null, feature)).toEqual([]);
  });
});
