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
2. **Split.** Explore the codebase and propose the feature split before
   modeling: one coherent slice per feature (a flow, a screen, a capability),
   1-15 surfaces each. Confirm the split with the user when it is not obvious.
3. **Per feature, per surface:**
   a. Read the source files that implement the surface.
   b. `attach_source_file` with `kind:"code"`, `fileName` = repo-relative
      path, `content` = the exact file text (1 MiB cap per source; attach the
      files that carry behavior, not the whole tree).
   c. Model through `apply_batch`, capturing ids with `ref`.
   d. `record_element_span` for **every** element, offsets pointing at the
      code it came from. Pass `sourceId` (several sources will be linked).
   e. `finalize_analysis` once tracing is complete.
   f. `seed_index_from_analysis`, then `sync_from_index`.
4. **Prove.** `verify` + `score_feature`; close reported gaps until clean.

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

## What seeding skips (expected, not an error)

`seed_index_from_analysis` reports `skipped` for elements the coverage
contract has no per-file slot for: feature-level invariants, entities,
surface-declared transitions, and events no action emits. Their provenance
spans still exist and still render in the Source Viewer; they just do not
become index entries. Spans recorded against pasted/document sources are
counted as `nonCodeSpans` and stay provenance-only.

Existing `.unspa.json` entries are never overwritten unless you pass
`overwrite:true`; hand-audited entries win by default.
