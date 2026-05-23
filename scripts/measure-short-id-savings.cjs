#!/usr/bin/env node
// Apply the same shortener logic the MCP would, and compare before/after.

const fs = require('node:fs');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHORT_LEN = 8;
const APPROX_CHARS_PER_TOKEN = 4;

const shorten = (v) => {
  if (typeof v === 'string' && UUID_RE.test(v)) return v.slice(0, SHORT_LEN);
  if (Array.isArray(v)) return v.map(shorten);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = shorten(val);
    return out;
  }
  return v;
};

const tok = (c) => Math.round(c / APPROX_CHARS_PER_TOKEN);

function compare(label, raw) {
  const before = JSON.stringify(JSON.parse(raw));
  const after = JSON.stringify(shorten(JSON.parse(raw)));
  const saved = before.length - after.length;
  const pct = (saved / before.length * 100).toFixed(1);
  console.log(`\n=== ${label} ===`);
  console.log(`Before : ${before.length} chars (~${tok(before.length)} tok)`);
  console.log(`After  : ${after.length} chars (~${tok(after.length)} tok)`);
  console.log(`Saved  : ${saved} chars (~${tok(saved)} tok, ${pct}%)`);
}

for (const f of process.argv.slice(2)) {
  compare(f, fs.readFileSync(f, 'utf8'));
}
