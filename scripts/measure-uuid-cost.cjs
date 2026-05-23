#!/usr/bin/env node
// One-off: estimate UUID token cost in real MCP tool payloads.
// Read sample JSON from stdin or argv; report char + token estimates.

const fs = require('node:fs');

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const APPROX_CHARS_PER_TOKEN = 4;

function measure(label, json) {
  const chars = json.length;
  const matches = json.match(UUID_RE) || [];
  const unique = new Set(matches);
  const uuidChars = matches.length * 36;
  const tok = (c) => Math.round(c / APPROX_CHARS_PER_TOKEN);

  const collapseToName = chars - uuidChars;
  const collapseToShortHash = chars - uuidChars + matches.length * 8;

  console.log(`\n=== ${label} ===`);
  console.log(`Payload      : ${chars} chars (~${tok(chars)} tok)`);
  console.log(`UUIDs        : ${matches.length} refs / ${unique.size} unique (${uuidChars} chars, ~${tok(uuidChars)} tok, ${(uuidChars / chars * 100).toFixed(1)}% of payload)`);
  console.log(`If collapsed → name only : ${collapseToName} chars (~${tok(collapseToName)} tok, ${((1 - collapseToName / chars) * 100).toFixed(1)}% saved)`);
  console.log(`If collapsed → 8-char id : ${collapseToShortHash} chars (~${tok(collapseToShortHash)} tok, ${((1 - collapseToShortHash / chars) * 100).toFixed(1)}% saved)`);
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('Usage: node measure-uuid-cost.js <file1.json> [file2.json ...]');
  process.exit(1);
}
for (const f of files) {
  measure(f, fs.readFileSync(f, 'utf8'));
}
