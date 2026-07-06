#!/usr/bin/env node
// Reset one e2e hub directory to a clean slate, then hand off to the dev
// server (the playwright.config webServer commands chain this with
// `npm run dev`). Each server gets its own hub so tests that mutate data
// (the load-samples journey) can never leak into the developer's real
// shared hub in ~/.unspa-hub or into the other server's fixtures.
const { mkdirSync, rmSync } = require('node:fs');
const { resolve } = require('node:path');

const target = process.argv[2];
if (!target) {
  process.stderr.write('usage: node e2e/prepare-hub.cjs <hub-dir>\n');
  process.exit(1);
}
const dir = resolve(process.cwd(), target);
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
process.stdout.write(`[e2e] hub reset: ${dir}\n`);
