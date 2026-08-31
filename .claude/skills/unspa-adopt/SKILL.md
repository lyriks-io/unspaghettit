---
name: unspa-adopt
description: Use when turning an EXISTING codebase into an Unspaghettit behavior model (code → spec). Reads the source, models what the code actually does, traces every element to the exact code span it came from (attach_source_file kind:"code" + record_element_span), then seeds .unspa.json implementation coverage from those spans (seed_index_from_analysis). Triggers on "adopt this codebase", "model the existing code", "reverse engineer into unspa", "extract the spec from the code", "code to spec", "unspa adopt".
---

# Unspaghettit: adopting an existing codebase (code → spec)

Adoption turns working code into an executable model **with evidence**. One
pass yields three things at once:

1. The behavior model (surfaces, actions, state, rules, invariants, scenarios).
2. Provenance: every element traced to the exact code span it was extracted
   from, browsable in the dashboard's Source Viewer.
3. Implementation coverage: the traced spans become `.unspa.json` entries
   (`seed_index_from_analysis`), so coverage is non-zero and drift detection
   is armed from day one.

The MCP never reads source files. **You** read the code, and the finalize gate
keeps you honest: `finalize_analysis` refuses until every modeled element has
a recorded span, so nothing can be invented without a source.

## The mapping law (one concept: adopt, implement, trace)

A spec↔code mapping is only real when the code itself is captured. Never
record or report a bare `{file, line}`: that is a claim the server cannot
check, and the dashboard stamps such locations `unverified`. Adoption is the
flow where evidence is automatic, so USE it: attach the file, record the
spans, finalize, seed, sync. Skipping the span flow and pushing locations
straight through `report_implementation_status[_batch]` produces an
unverifiable report and is never an acceptable shortcut for adoption. If you
report directly for any reason, every location carries the exact code as
`snippet`; the server completes what it can (checkout slice, recorded spans)
and stamps the rest `unverified`. Leave zero unverified locations behind; if
you cannot capture the code, say so instead of reporting the location.

## Non-negotiables

- Model what the code **actually does**, not what it should do. A bug you can
  see becomes a faithfully modeled behavior plus a note; propose the fix as an
  evolution (`propose_evolution`), never as silently "corrected" behavior.
- Attach file content **exactly as read** (byte for byte). Spans store
  character offsets into that content; a trimmed or reformatted paste breaks
  the line numbers that seed `.unspa.json`.
- A code source's `fileName` is its **repo-relative path** (`src/lib/cart.ts`,
  forward slashes). It lands verbatim as the `file` of the seeded index entry.
- Never synthesize entity ids. Capture each new id from the `apply_batch`
  ref/ack and use it in `record_element_span`.

## Workflow

1. **Scope.** `get_repo_context` once. If the repo is not linked, create the
   project (`create_project`), then have the user (or a terminal call) run
   `unspa link --project-id <id>`. The link must exist before seeding.
2. **Split.** Get the lay of the land, then propose the feature split before
   modeling: `outline_repo` returns a bounded, noise-free sketch of the source
   tree (skip it and read the tree with your own tools if the host gives you
   file access). Cut one coherent slice per feature (a flow, a screen, a
   capability), 1-15 surfaces each. Confirm the split with the user when it is
   not obvious.
   Record the product's pillars as the project's core features
   (`declare_core_feature`), then group each feature under at most one with
   `set_feature_core` as you create it. This is where the taxonomy belongs:
   capture it in the model once, rather than re-deriving it from folder names
   every pass. An undeclared or doubled `core:` tag is a soft warning in the
   project aggregate, never a save blocker.
3. **Per feature, per surface:**
   a. Read the source files that implement the surface.
   b. `attach_source_path` with the file's repo-relative path: the server
      reads the file from disk itself, so you never re-emit the content
      (roughly half the token cost per file). CRLF is normalized to LF;
      verify the ack's `totalChars`/`contentHash` against what you read.
      Fallback when the server has no repo context: `attach_source_file`
      with `kind:"code"` and the exact file text. Either way, attach the
      files that carry behavior, not the whole tree (1 MiB cap per source).
   c. Model through `apply_batch`, capturing ids with `ref`.
   d. `record_element_spans` with ALL of a source's spans in one call
      (per-item `{elementId, startOffset, endOffset}`, call-level
      `sourceId`); failures come back per item without aborting the rest.
      The single `record_element_span` remains for one-off fixes.
   e. `finalize_analysis` once tracing is complete.
   f. `seed_index_from_analysis`, then `sync_from_index`.
4. **Account for the sources (optional, for a defensible extraction).** When
   code and docs disagree, rank the sources (`authority`/`artifact` on attach,
   or `classify_source` after) and record the disagreement with `flag_conflict`
   instead of silently modeling one side; the higher-authority claim comes back
   as the suggested winner, and `resolve_conflict` closes it with a reason. To
   prove nothing was skipped, `stage_candidate` each behavior a source describes
   and `dispose_candidate` it (accepted / rejected / merged / ...); then
   `get_source_coverage` reports the share of each source that reached the model
   and the still-unresolved list.
5. **Prove.** `verify` + `score_feature`; close reported gaps until clean.

## Extraction recipe (where each element hides in code)

| In the code | In the model |
| --- | --- |
| Route, screen, dialog, CLI command group, workflow | Surface |
| Handler, mutation, endpoint, button action, command | Action |
| Function params, form fields, request body | Parameters |
| Store, schema column, reactive state, config | StateDefinition (dotted path) |
| Guard clause, validation, permission check, early return | Rule (block reason = the error the user sees) |
| Assertion, DB constraint, "this must always hold" comment | Invariant |
| Navigation call, redirect, wizard step change | Transition |
| Event emit, pub/sub topic, webhook fired | Event (emittedEvents + definition) |
| Existing test cases | Scenarios (arrange steps + expected assertions) |

State paths come from what the code persists or branches on, not from UI
copy. Enum unions in the code become value sets.

Model a constraint as an **Invariant** only when the code truly enforces it:
it rejects, throws, or refuses to persist the violating state. A reachable
invariant violation fails the verdict by default, so an advisory check dressed
as an invariant claims a hard guarantee the code never made. When the code
only warns and carries on (a "should", a lint, a non-blocking policy), model
it as a **Rule** with no blocking effect, not an Invariant. Getting hard vs
soft right is what keeps the model and the code honest with each other.

## Recording spans that survive refactors

- Offsets are **character offsets** into the attached content, end exclusive.
  Re-read the stored text with `get_source` when unsure; do not count from
  memory.
- Span the **declaration line(s)** of the thing (the `export const addToCart`
  line, the guard clause), not a whole 200-line region. The first meaningful
  line of the span becomes the entry's `signature`, which the line auto-healer
  uses after refactors; a span starting on a `{` or blank line heals badly.
- One span per element. Pick the primary declaration when an element spans
  several files, and put the rest in the index entry's `relatedFiles` later if
  needed.

## What seeding writes (and what stays provenance-only)

`seed_index_from_analysis` seeds an entry for EVERY element traced to a code
source, including entities, feature-level invariants, surface-declared
transitions, and declared events. Those kinds do not appear in the
per-action coverage report, but their entries document where the thing
lives and arm drift detection. Spans recorded against pasted/document
sources are counted as `nonCodeSpans` and stay provenance-only; `skipped`
only lists elements that no longer resolve in the feature (stale analysis).

Existing `.unspa.json` entries are never overwritten unless you pass
`overwrite:true`; hand-audited entries win by default.
