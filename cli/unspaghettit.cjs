#!/usr/bin/env node
// Long-name bin alias. Sets UNSPA_FUN_MODE=1 then chains to the real CLI
// entry. The package publishes two bin shims pointing at the SAME logic
// (`unspa` and `unspaghettit`); on Windows the npm-generated `.cmd`
// wrapper re-invokes node with our `.cjs` file as argv[1], which loses
// the alias name the user actually typed. Setting the env var here is
// the portable way to detect that the user invoked the CLI by its full
// name — which the README treats as the unlock for the opt-in narrative
// skills. See cli/util/skills.ts NARRATIVE_SKILLS and the README's
// closing section.
process.env.UNSPA_FUN_MODE = '1';
require('./unspa.cjs');
