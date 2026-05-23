import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { validateFeature } from '../src/features/behavior-model/domain/services/FeatureValidator';

const dir = 'samples/eshop';
let anyFailed = false;
for (const f of readdirSync(dir).filter((n) => n.endsWith('.feature.json'))) {
  const data = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const r = validateFeature(data.feature);
  if (r.valid) {
    console.log(`${f}: OK`);
  } else {
    anyFailed = true;
    console.log(`${f}: FAIL`);
    for (const e of r.errors.slice(0, 10)) console.log('  -', e);
    if (r.errors.length > 10) console.log(`  ...and ${r.errors.length - 10} more`);
  }
}
if (anyFailed) process.exit(1);
