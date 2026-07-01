# Architecture

## How the pieces fit at runtime

```
                         ┌──────────────────────────┐
  any MCP client         │  MCP server (stdio)      │
  (your AI agent)    ───→│  - typed tool surface    │←─── your code
                         │  - validation + simulator│     (via .unspa.json
                         └────────────┬─────────────┘      behavioral index)
                                      │
                                      ▼
                         ┌──────────────────────────┐
                         │  unspa/  (or hub)        │
                         │  feature JSON snapshots  │←──→ Yjs WebSocket
                         │  = your runtime          │     (live multi-agent)
                         └────────────┬─────────────┘
                                      │
                                      ▼
                         ┌──────────────────────────┐
                         │  SvelteKit dashboard     │
                         │  (you, browsing the spec)│
                         └──────────────────────────┘
```

- The **MCP server** is what your AI client talks to. It exposes the runtime as typed tools so the LLM creates, reads, edits, and validates entities through calls, not prose.
- The **behavior model** holds the entities (features, surfaces, actions, state, rules, invariants, scenarios) and the transforms that keep them valid.
- The **simulator** is deterministic. It runs actions against state snapshots and replays multi-step scenarios, which is what turns a scenario into a pass-or-fail spec test. The **bounded model checker** sits next to it, exploring the reachable state space for counterexamples no single scenario walks.
- The **verification spine** folds scenarios, maturity, reachability, model checking, spec→code drift, and verified coverage into a single gated verdict (`verify` in chat, `unspa check` in CI).
- The **dashboard** (SvelteKit) is the human surface: editing, the maturity view, the implementation queue, real-time collaboration, and the audit map between spec and source.
- The **CLI** ties it together: `unspa init` scaffolds and registers, `unspa dashboard` serves the UI, and the snapshot layer keeps everything as plain JSON in your repo or shared hub.

The spec is just JSON on disk. The MCP server, the dashboard, your AI client, and your application code all read and write through it. Nothing is hosted; everything is in your repo (or in a local hub you control).

## Repo layout

```
unspaghettit/
├── unspa/                        ← feature JSON snapshots (your runtime; empty on a fresh clone)
├── samples/                      ← bundled sample projects (one folder per project, e.g. eshop/)
├── mcp-server/                   ← MCP server (stdio)
├── src/                          ← SvelteKit dashboard + domain
│   ├── features/behavior-model/  ← Feature/Surface/Action entities + transforms
│   ├── features/simulator/       ← deterministic simulator + bounded model checker
│   ├── features/verification/    ← verification spine (drift, liveness, gated verdict)
│   └── features/mcp-tools/       ← read-side tool implementations
├── cli/                          ← `unspa` command (init / serve / dashboard)
└── build/                        ← SvelteKit production build (npm run build)
```

## Status

Early but functional. Used internally to model products, generate typed scaffolding, audit implementation against spec, run multi-agent editing sessions, and recursively refine the runtime itself.

## Why open source

Built internally at Lyriks because existing AI workflows were becoming hard to reason about as systems grew. The runtime became useful enough to release as standalone OSS, separate from the formal coherence research and engine work at Lyriks.
