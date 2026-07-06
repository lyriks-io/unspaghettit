# Contributing to Unspaghettit

Thanks for considering a contribution. Unspaghettit is early but functional - bug reports, fixes, and small feature PRs are all welcome.

## Code of Conduct

Be kind, be specific, assume good faith. By participating you agree to keep discussions productive and on-topic.

## Getting set up

```bash
git clone https://github.com/lyriks-io/unspaghettit.git
cd unspaghettit
npm install
npm run check     # svelte-check / typescript
npm test          # vitest, ~400 tests
npm run build     # SvelteKit production build
npm run dev       # http://localhost:8173
```

The MCP server runs via `npm run mcp` (stdio). The CLI runs via `npm link` once, then `unspa init` / `unspa dashboard` / `unspa serve` from any repo.

## How to propose a change

1. **Open an issue first** for anything bigger than a bug fix or a typo. A 2-line description of the problem and the proposed direction saves both of us a wasted PR.
2. **Fork → branch → PR.** Branch off `main`; keep PRs focused (one concern per PR).
3. **Tests stay green.** `npm run check && npm test && npm run build` must pass. New behavior gets a test; bug fixes get a regression test.
4. **No new tags in source code.** Code↔spec mapping lives in `.unspa.json`. See [SKILL.md](cli/skills/unspa-implement/SKILL.md) for the index workflow.
5. **No drive-by refactors.** If a change touches a file outside the PR's stated scope, justify it in the description.
6. **Write commit messages that explain the why.** Conventional Commits welcome but not required.

## What's in scope

- Bug fixes in the runtime, MCP tools, simulator, dashboard.
- Skill / docs improvements (CLAUDE.md / AGENTS.md template, SKILL.md prose).
- New AI client adapters under [cli/clients/](cli/clients/) - see existing ones for the pattern.
- Performance / token-size improvements to MCP responses.
- Sample feature snapshots under [samples/](samples/) that exercise an MCP surface not yet covered.

## What's out of scope (for now)

- Re-introducing source-code tag annotations. The index-only approach is deliberate.
- Hosted / SaaS modes. Unspaghettit is local-first by design.
- Adapter-platform changes (Vercel, Cloudflare). Adapter-node is the supported target.

## Releasing

Versioning follows [SemVer](https://semver.org). `v0.x` while the MCP surface is still settling; breaking changes are signalled in [CHANGELOG.md](CHANGELOG.md).

## License

By submitting a contribution you agree it is licensed under [AGPL-3.0-or-later](LICENSE), the same license as the rest of the project.
