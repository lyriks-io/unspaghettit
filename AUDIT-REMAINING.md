# Trustworthiness audit — remaining work (handoff)

Handoff for a fresh session continuing the "trustworthiness audit" implementation.
As of 2026-07-11 the audit's high-leverage recommendations are **implemented in
code across 14 commits on `main` (all UNPUSHED)**: `a32be80..62d1086`. Test
count 1023 → 1090. Every commit is full-suite + ESLint + svelte-check green.
The whole thing is documented in the Unreleased section of `CHANGELOG.md`.

The BIG remaining item — extraction completeness — is now **DONE** (4 commits,
`9d46aff..62d1086`; see Remaining §1). What's left is the small, low-value
deployment-traceability item (§2) and the explicitly deferred safety layer.

## Done (do not redo)

1. `a32be80` — maturity trustworthiness: fixed two tautological maturity checks;
   added shared `BehaviorSemantics` read/write/emit analyzer; `unspa check --strict`.
2. `52e88ee` — decision-table analysis in `get_spec_gaps` (`DecisionAnalysis.ts`):
   provable dead / conflicting / redundant / shadowed / always-blocked rules.
3. `1e3453e` — routed `get_neighborhood` + behavior graph through `BehaviorSemantics`
   (they dropped list mutations + rule emits).
4. `8b5e3fe` — scoped `Action.invariantRelaxation` (names which invariants may be
   relaxed, with rationale) replacing the blunt `bypassInvariants`.
5. `ace2561` — first-class `Action.outcomes` (success/rejected/failure/timeout/
   cancelled/partial/pending). Additive: `status` stays `success`|`blocked`; the
   resolved outcome rides in `SimulationResult.outcome`.
6. `8b876d2` — parameter-domain exploration in `StateExplorer` (`ParameterDomains.ts`):
   enumerates enum/boolean/number-bound domains instead of skipping/defaulting.
7. `c8f29f0` — honest `confidence` matrix in `score_feature` (`ConfidenceMatrix.ts`):
   5 dimensions, `overall` = the WEAKEST (min), each with the counts it came from.
8. `581cd97` — `EventDefinition.delivery` (best_effort/required/transactional);
   a required/transactional handler failure blocks (transactional rolls back) the emitter.
9. `b827e82` — first-class `feature.dependencies` (`Dependency.ts`): the external
   systems + their operations (timeout/retries/idempotent/failureModes/assumptions).
   `get_spec_gaps` flags an operation with no timeout or failure modes.
10. `abbe5fa` — `invoke_operation` effect: wires an action/rule to a dependency call,
    writes the modeled result to `resultPath` like `set_state`. Fully integrated.

## Remaining

### 1. Extraction completeness — DONE (2026-07-11), 4 commits on `main` (UNPUSHED)

The core problem the audit flagged (provenance proves *attribution* but not
*completeness*) is now implemented across the **source-provenance / adoption
store** (feature `39e57ee0`; `sources/` + `.provenance.json` sidecars). Test
count 1052 → 1090. Each commit is full-suite + ESLint + svelte-check green.
All four sub-items shipped, smallest to largest:

- `9d46aff` — **Source authority ranking.** `ProjectSource.authority`
  (normative | supporting | observed | unknown) + `artifact` (implementation |
  test | contract | documentation | interview; named `artifact` NOT `kind` to
  dodge the existing arrival-mode `kind`). `effectiveAuthority` derives at read
  time (explicit → artifact default → unknown), so the ranking policy is one pure
  function and storage stays minimal. New `classify_source` tool re-tags a
  deduped/pre-authority source (metadata only). Surfaced in list_sources /
  get_source / get_provenance.
- `a1bedb1` — **First-class conflicts.** `Conflicts.ts` (`Conflict {claims,
  affectedElements, status: open|resolved|accepted_ambiguity, resolution?,
  resolvedInFavorOf?}`) on the provenance sidecar. `flag_conflict` /
  `resolve_conflict`; flagging suggests the higher-authority winner via
  `suggestConflictWinner` (ties → ambiguous). Open count in get_provenance +
  finalize ack.
- `df92e75` — **Candidate staging.** `Candidates.ts` (`BehaviorCandidate {span,
  proposedKind, summary, confidence, disposition, rationale?, elementId?}`).
  `stage_candidate` / `stage_candidates` (batch) / `dispose_candidate`
  (accepted/merged must name the element). The dual of record_element_span.
- `62d1086` — **Bidirectional source coverage.** `get_source_coverage` +
  `coverageForCandidates` / `rollUpCoverage`: every candidate → one of
  modeled | duplicate | excluded | unresolved; reports per-source shares
  (worst-unresolved first), a rollup, and the concrete unresolved list.

Shared analyzers to reuse: `ProjectSource.effectiveAuthority` / `authorityRank`,
`Conflicts.suggestConflictWinner`, `Candidates.coverageForCandidates`. The
`unspa://guide` resource documents all four under "Source trust & extraction
completeness".

Still open within this item (nice-to-haves, not built):
- The 20 audit **evolutions** in the hub self-model (project `e8300ab2`,
  feature `39e57ee0`, surface Source Capture `70b6ba66`, tagged
  `Trustworthiness audit (2026-07-11)`) are still queued — none dequeued/marked
  shipped yet. Also the "Behavior Engine" self-model feature (`8671948c`) has no
  actions modeling authority/conflict/candidate/coverage.
- The adoption WORKFLOW prompt (`buildAdoptPrompt` in `cli/commands/adopt.ts`)
  and the `unspa-adopt` skill still describe only the span-and-finalize flow;
  they don't yet steer agents to stage candidates / flag conflicts / check
  coverage. Left deliberately: pushing everyone onto the candidate flow is a
  workflow change, and the tools are self-describing. Revisit if adoption should
  default to the rigorous path.

### 2. Deployment-artifact traceability (SMALL, modest value — the remaining item)

Tie a verification verdict to the exact spec version + code commit + config it
was produced against, so a green result provably describes what ships. Cross-cutting:
`VerifyFeatures` use-case output + `cli/commands/check.ts` + the MCP `verify` tool
+ the verdict shape. Modest value for a local-first tool; do last.

### Explicitly DEFERRED by the user (do NOT build unless asked)

The "life-critical / hazards / assurance-case / operating-envelope / authority &
human-control" layer from the first report. The user said "human at risk later";
the goal for now is capturing all behavior honestly, not safety certification.

## How to work (conventions proven this session)

- **Additive + back-compat, always.** Every change above kept existing behavior
  identical when the new field/concept is absent. This is non-negotiable: the npm
  package has ~526 weekly downloads (see memory).
- **Validation gate per commit:** `npx vitest run` (full suite) + `npx eslint <files>`
  + `npm run check` (svelte-check). Commit only when all three are green. Do NOT
  push — the user grants push explicitly each time.
- **Read svelte-check's actual output, not the exit code.** `npm run check 2>&1 | tail`
  reports `tail`'s exit code (0) even on errors. Capture to a file and
  `grep -E "ERROR|COMPLETED"`.
- Score honesty is a stated user value: "trustfully, explainable, honest" — the
  confidence matrix is min-based (weakest link), not an average.

## Gotchas hit this session (save yourself the debugging)

- **New effect type** must be added to BOTH `KNOWN_EFFECT_TYPES` arrays
  (`mcp-server/tools/effect.ts` AND `mcp-server/tools/rule.ts`) or authoring is
  rejected; TypeScript exhaustiveness will flag the ~7 domain switches, but the
  Zod schemas + `EffectApplier` `default`-throw case + `StatePathReferences`
  (`default: return 0`) are NOT compiler-flagged — handle them manually.
- **`ScenarioAssertion` shape is `{ path, operator, value }`**, not `{ left, right }`.
  The server silently drops unknown keys, so a wrong-shape assertion validates but
  always fails at runtime.
- **Batch-op `kind` collision:** an entity whose own field is named `kind`
  (resource, reachability goal, action outcome, dependency) collides with the
  apply_batch op discriminator. Use a renamed field (`dependencyKind`,
  `outcomeKind`, `resourceKind`) or nest.
- **Single-quoted description strings break on an apostrophe** (`'the dependency's
  operation'` terminates the string). Write "the dependency operation".
- **Flaky vitest first run:** a single test file sometimes fails first run with
  "Cannot read properties of undefined (reading 'config')" — a worker-init hiccup;
  just re-run.

## Where things live

- Self-model of the engine: hub project `e8300ab2` "Unspaghettit Dashboard",
  feature `8671948c` "Behavior Engine" (added this session). The full audit
  roadmap is also captured as 20 **evolutions** across 6 features (see memory
  `project_self_model_scope_and_audit_roadmap.md`).
- Shared analyzers to reuse: `BehaviorSemantics.ts` (reads/writes/emits),
  `DecisionAnalysis.ts` (rule contradictions), `ParameterDomains.ts`,
  `ConfidenceMatrix.ts`. Extraction-completeness domain:
  `source-provenance/domain/{ProjectSource,Conflicts,Candidates}.ts`.

## To pick up in a fresh session

Say: "continue the trustworthiness audit — read AUDIT-REMAINING.md". Extraction
completeness is done; what's left is deployment-artifact traceability (§2, small)
and, if wanted, the self-model bookkeeping (dequeue the shipped evolutions, add
Behavior Engine actions for authority/conflict/candidate/coverage). Push the 14
unpushed commits first if you want them safe on the remote.
