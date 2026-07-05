# Working with AI

Once `unspa init` has registered the MCP server and your AI client has restarted, you don't need to speak in Unspaghettit internals. Start with the product you want. Mention the Unspaghettit or Unspa MCP, the scope, and how complete you want it.

The pattern that works: **name the MCP, describe the product, set the maturity level, and say whether you want spec only or spec plus implementation.**

## Create a spec

This is usually enough:

```
Using the Unspaghettit MCP, create a new project.
It is a mobile app that lets a user get one coupon each day for a shop near them.
Make each feature reach 100% maturity.
```

For a smaller first pass:

```
Using the Unspa MCP, create a new project for a B2B invoicing app.
Start with three features only: customers, invoices, and payment follow-up.
Make it a solid first draft, not necessarily 100% maturity yet.
Ask me if a business rule is unclear.
```

For a single feature:

```
Using the Unspaghettit MCP, add a feature for approving refunds.
Keep it focused on the support agent workflow.
Make it implementation-ready and bring it to 100% maturity.
```

For an existing codebase:

```
Using the Unspaghettit MCP, read this repository and create a spec that describes the behavior already implemented.
Start with the most important user-facing flows.
Map each spec entity back to the files that implement it, then report what is unclear or missing.
```

## Choose the maturity level

100% maturity is the recommended default for a first serious prompt. It helps the agent produce a richer spec on the first pass. Lower the target only when you want brainstorming, discovery, or a partial draft.

```
Make this a rough product draft. Do not force 100% maturity yet.
I want enough structure to discuss the flow and discover missing business rules.
```

```
Make this implementation-ready. Aim for 100% maturity.
If anything prevents 100%, explain the missing product decision instead of inventing it.
```

```
Do not chase the score blindly. Prefer a clear product spec.
If a maturity check feels artificial for this feature, tell me why.
```

## Ask questions about the spec

The MCP is also a query layer. Ask the agent to inspect the current model instead of relying on memory or screenshots.

```
Using the Unspaghettit MCP, explain the Cart & checkout feature.
Explain what the user can do, what can block them, and what happens after each important action.
```

```
What can block Place order?
Explain each blocker in product language and tell me which cases are already covered by scenarios.
```

```
Where is email verification used in this project?
Tell me what depends on it and what would change if we removed that requirement.
```

```
Using the Unspaghettit MCP, make a report of the current implementation of the specs in this codebase.
Tell me what is implemented, what is missing, and what looks stale.
```

## Change or extend the spec

Ask for changes in normal product language. Add constraints when they matter.

```
Using the Unspaghettit MCP, add a "Cancel subscription" flow.
Reuse the existing billing concepts when possible.
After the edit, tell me whether the maturity score changed and why.
```

```
Before changing the spec, propose the change in plain English.
Once I approve, update the Unspaghettit project and run the relevant scenarios.
```

## Move from spec to implementation

If you want code, say so in the same prompt. Include design, stack, and implementation constraints when they matter.

```
Using the Unspaghettit MCP, implement the next queued feature.
Use the existing SvelteKit style and keep the UI quiet and mobile-friendly.
After implementation, update the implementation report for the spec.
```

```
Using the Unspa MCP, implement the coupon discovery feature.
Use the current app stack. If the spec is missing something needed for implementation,
update the spec first, then write the code.
```

## Workflows - recipes by where you start

The LLM does the reading and writing through the MCP in every direction; Unspaghettit gives it a structured target, a deterministic simulator, and a verification gate. Pick the recipe that matches where you're starting.

### 1. From scratch: a new product (spec → code)

You have an idea and an AI assistant, and you want a spec you can trust *before and while* you build.

1. **Set up.** `unspa init` wires the MCP into your AI client; `unspa dashboard` lets you watch the model take shape.
2. **Model it.** Tell the assistant what you're building and to use the Unspaghettit MCP at 100% maturity. It calls `create_project`, then `create_feature` / `apply_batch` to build surfaces, actions, state, rules, effects, events, invariants, and scenarios. Validation errors come back inline, so the model converges instead of drifting.
3. **Prove the spec is sound - before a line of code.** `run_all_scenarios` runs every scenario as a deterministic test; `model_check` explores the reachable state space for invariant counterexamples, dead actions, and soft-locks; `score_feature` / `get_spec_gaps` flag shallow modelling. Or one call: **`verify`**.
4. **Generate contracts.** `generate_types` writes TypeScript types for state shapes, event names, and parameters. Your code imports them, so TypeScript catches drift the moment the spec changes.
5. **Implement.** The assistant writes the code against those types, using the scenario results as the oracle, and records each entity's location in `.unspa.json` (`{file, line, signature}`) - never annotating source.
6. **Prove the code matches the spec.** `unspa scenarios adapter <id>` + `unspa scenarios export <id>` generate a Vitest suite from the scenarios; run it (`vitest --reporter=json`) and `unspa coverage ingest` marks each passing action **verified** (proven, not just claimed).
7. **Gate it.** `unspa ci` drops a GitHub Actions workflow running `unspa check --model-check --min-verified 80` on every push.

### 2. Just one feature

You have a project (yours, or one of the samples) and want to add one capability without boiling the ocean.

1. Ask for the feature by name, scoped tight and implementation-ready - e.g. *"add a refund-approval flow for the support agent; reuse existing billing concepts; 100% maturity."* A Feature is one LLM-sized slice (1–15 surfaces); keep it that size and split if it grows.
2. The assistant adds it with `add_feature_to_project` + `apply_batch`, reusing existing events / entities / resources where they fit.
3. `verify <featureId>` (or the dashboard's **Verify** tab) confirms scenarios pass, invariants hold, and nothing's unreachable. Implement, then `coverage ingest` to prove it.

### 3. From an existing codebase (code → spec)

You have a product whose behavior lives only in the code (and stale docs), and you want it made explicit and machine-checkable. This flow is first-class: **`unspa adopt`** prints the paste-ready prompt (the bundled `unspa-adopt` skill runs it directly in Claude Code), and the extraction is evidence-gated end to end.

1. Point the assistant at the repo: *"adopt this codebase into Unspaghettit; start with the most important user-facing flows"* (or paste the `unspa adopt` prompt).
2. It reads the code and models it batch by batch - one Feature per coherent flow. Each source file it read is stored via `attach_source_file kind:"code"` and **every extracted element is traced to the exact code span it came from** (`record_element_span`). `finalize_analysis` refuses to lock until nothing is untraced, so the model can't contain invented behavior.
3. **Map it back automatically.** `seed_index_from_analysis` turns the recorded code spans into `.unspa.json` entries (`{file, line, signature}`, spec version stamped), then `sync_from_index` reconciles and reports coverage. One analysis pass yields the model, its provenance (browsable in the Source Viewer), and non-zero implementation coverage with drift detection armed.
4. **Find what's shallow or missing.** `score_feature`, `get_spec_gaps`, and `get_implementation_gaps` show where the model under-describes the code (or the code is unindexed). Iterate until it audits clean.
5. You now have a legible, machine-checkable map of what your product does, wired to the source - so future drift is visible.

### 4. Keep spec and code in sync (audit & drift)

The model exists and the code exists; you want to know, at any moment, whether they still agree.

1. **Did the spec change under the code?** `get_drift` lists every implementation audited against an older spec than the one now on disk - re-audit those.
2. **Does the code still do what the spec says?** Re-run the scenario suite and `unspa coverage ingest`; a regression clears the `verifiedAt` stamp, so the proven share drops and the gate notices.
3. **One verdict.** `verify` (or `unspa check` in CI) folds scenarios + maturity + reachability + model checking + drift + cross-feature event coherence + verified coverage into a single pass/warn/fail.

### 5. Gate it in CI

Make the spec a build gate, not a document that quietly rots.

```bash
unspa init --local        # so the model travels with the repo in git
unspa ci                  # writes .github/workflows/unspaghettit.yml
# …or hand-roll the gate with the thresholds you care about:
unspa check --model-check --min-maturity 80 --min-verified 80 --fail-on-drift
```

`unspa check` exits non-zero on failure (`--json` for CI dashboards). The MCP exposes the same as `verify` / `get_drift` for the in-chat flow, so chat and CI verify identically.

## Verify the spec yourself (preview)

`unspa scenarios export <featureId>` generates a Vitest file from your scenarios, using the simulator's predictions as the oracle. You write one thin adapter (`UnspaAdapter` from `unspaghettit/cli/scenarios`) that calls your real implementation; `unspa scenarios adapter <featureId>` scaffolds it for you, a `case` per scenario-bearing action pre-seeded with the implementation location from `.unspa.json`. The generated tests drive every scenario through it and assert state path-by-path.

Experimental: the adapter contract may shift between minor versions.
