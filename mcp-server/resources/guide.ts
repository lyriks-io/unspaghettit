import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const GUIDE = `# Unspaghettit MCP. Usage Guide

## What is a Feature

A Feature is ONE coherent slice of behavior inside a Project. A flow, a screen,
a capability. Sized so you can hold the whole thing in head at once.

Rule of thumb: roughly 1–15 surfaces, 30–100 actions. If a Feature grows past
that, you have started modeling a whole product instead of a slice; split it.

  Good   "Add filter to search results", one Feature
  Good   "Onboarding flow"             , one Feature
  Good   "Cart and checkout"           , one Feature
  Bad    "Spotify"                     , that's the Project. Split into
                                          "Browse library", "Player",
                                          "Playlist editor", … each one Feature.

Hierarchy:  Domain tag → Project → Feature → Surface → Action → State/Rule/Effect

Domain is only a project tag/grouping. It is not a modeling page and should not
be treated as a behavioral container. Use it to group/filter Projects.

Project is the umbrella (one codebase / product). A Project can have many
Features. When the user says "I'm adding X to the existing app", create a new
Feature inside the existing Project. Do not put X into an existing Feature
unless it is genuinely the same slice of behavior.

## Entity model

Feature
  ├── surfaces[]        Screen / terminal / workflow context
  │   ├── stateDefinitions[]   Typed state at dotted paths ("cart.itemCount")
  │   ├── actions[]       User/AI-triggerable actions
  │   │   ├── parameters[]     Typed inputs (string|number|boolean|enum)
  │   │   ├── requiredStates[] Pre-conditions (state paths that must exist)
  │   │   ├── rules[]          Guards: condition → effect
  │   │   ├── invariants[]     Post-conditions; violations block the run
  │   │   ├── effects[]        Mutations: set_state|show_message|emit_event|block_action|allow_action|transition_surface
  │   │   ├── emittedEvents[]  Events this action can fire (by name)
  │   │   └── scenarios[]      Executable specs: personaId + overrides, optional steps[] (multi-step flows)
  │   ├── rules[]              Surface-level guards (apply to all actions)
  │   ├── invariants[]         Surface-level post-conditions
  │   └── transitions[]        Navigation edges to other surfaces
  ├── personas[]        Named user roles (used by scenarios)
  ├── resources[]       External dependencies (APIs, storage, …)
  ├── entities[]        Structured data namespaces with typed fields
  ├── events[]          First-class event registry { name, description, payloadSchema? }
  ├── valueSets[]       Named reusable enums { name, values } referenced by valueSetId
  ├── featureInvariants[]  Cross-surface post-conditions (checked after every action)
  └── reachabilityGoals[]  Liveness goals — reachable / always_reachable target states (the complement to invariants)

State paths use dot notation: "cart.itemCount", "user.profile.name".
StateDefinition: { path, type (string|number|boolean|enum|object|array), defaultValue, enumValues? | valueSetId?, sharedWith?: SurfaceId[] }

Descriptions are mandatory for every authored element. That includes Feature,
Project, Surface, StateDefinition, Parameter, Rule, Effect, Invariant,
Reachability goal, Transition, Persona, Resource, Entity, EntityField, Scenario,
Scenario expectedAssertion, Event, and Event payload field. Action uses the mandatory
\`intent\` field as its description. If the user has not provided a description,
ask for it or write a concise one from the provided context before calling tools.

## Session start

1. Call get_repo_context once.
   - If linked:true → a .unspa.json in this repo binds it to one project.
     The response includes linkedProjectId, linkedProjectName, and the
     project's features[{id, name}]. Scope every subsequent call to that
     project: pick the right featureId from features[] for the task based
     on context (file paths being edited, action name in the prompt, the
     surrounding code). When genuinely ambiguous, ask the user which
     feature they mean - don't guess.
   - If linked:false → call list_projects, then list_features inside the
     project the user picks.

2. Discover with list_features → list_actions.
   get_feature returns an INDEX (ids, names, counts, devContext) by default. It is cheap.
   Only call get_feature(verbose:true) when you genuinely need the full blob; it is ~10× larger.
   Drill into a single action with get_action. Preferred for focused edits.

## Editing. Always use apply_batch

apply_batch is the primary write path. It loads → applies N ops atomically → validates → saves.
Prefer it over individual add_*/update_*/remove_* calls for any multi-step work.

### Refs

Add ops accept an optional "ref" field. Later ops in the same batch can reference the
minted ID via the *Ref variant of the parameter instead of *Id:

  { kind:"add_surface", ref:"shop", name:"Shop", type:"screen" },
  { kind:"add_action", surfaceRef:"shop", name:"Add to cart", … }

add_state_definition.sharedWith also accepts ref strings. No need to know the surface ID
before it exists.

### dryRun mode

Pass dryRun:true to validate and get a maturity score without persisting anything.
Use this to check a proposal before committing:

  apply_batch({ featureId, dryRun:true, operations:[…] })
  → { ok, dryRun:true, validation:{ valid, errors? }, maturity:{ percentage } | null, refs }

### transition_surface in a batch

The transition_surface effect accepts targetRef (resolved to the surface ID created earlier
in the same batch) so wiring between new surfaces works in a single operation.

## Validation workflow

Before committing a large change:
  1. apply_batch dryRun:true  → catches type errors and structural issues
  2. dry_run_simulate          → runs the simulator on one action (pure, no persist)
  3. run_all_scenarios         → executes every scenario, applying personaId first when set
  4. model_check               → bounded exhaustive state-space exploration: invariant counterexamples
                                 (with the shortest action path that reaches them), dead actions,
                                 deadlocks, unreachable/terminal surfaces, and reachability-goal results
  5. score_feature          → maturity report; use to catch regressions

To gate the whole feature/project in one call (the CI shape), use verify — it folds scenarios +
maturity + reachability + optional model_check + spec→code drift + cross-feature event coherence +
verified coverage into one pass/warn/fail verdict (the in-chat form of the \`unspa check\` CLI).
get_drift surfaces just the spec-drift part (code audited against an older spec than the one now on
disk). With modelCheck on, verify also enforces project-level invariants (project.projectInvariants,
authored via add_project_invariant / update_project — cross-FEATURE safety properties referencing
state paths in different features, which a feature invariant can't) over the union of the project's
state.

Verified coverage closes the spec↔code loop: \`.unspa.json\` records WHERE each entity lives; running
the generated scenario spec (\`unspa scenarios export\` → \`vitest --reporter=json\`) and
\`unspa coverage ingest <report>\` stamps \`verifiedAt\` on the actions whose scenarios PASSED against
the real code — "proven", not just "claimed". verify / \`unspa check --min-verified <pct>\` gate on
that proven share.

Run find_state_references before renaming or removing a state path. It shows every rule,
effect, invariant, and requiredState that references that path.

## Expression AST

condition.right and set_state.value both accept a raw literal OR a structured Expression:

  { kind:"literal", value }                      constant
  { kind:"state", path }                         read a state path
  { kind:"param", name }                         read a parameter
  { kind:"add"|"sub"|"mul"|"div"|"mod"|"min"|"max", left, right }
  { kind:"neg", operand }                        unary negation

Examples:
  condition.right: { kind:"state", path:"match.lapsToWin" }
    → player.lapsCompleted > match.lapsToWin

  set_state.value: { kind:"add", left:{ kind:"state", path:"player.score" }, right:{ kind:"param", name:"points" } }
    → player.score = player.score + points

## Effect types

  set_state        { path, value }              Write a state value (value accepts Expression)
  show_message     { message, tone? }           Display feedback
  emit_event       { event }                    Fire a named event (must be in feature.events)
  block_action     { reason }                   Reject the action with a reason
  allow_action     {}                           Explicitly allow (used to short-circuit rules)
  transition_surface { target|targetRef }       Navigate to another surface

## Tagging Projects and Features

Projects and Features carry an optional list of \`{type, value}\` tags. Tags
are cross-cutting metadata for filtering and grouping - they do not change
behavior, they just let humans and agents slice the index along axes the
hierarchy doesn't capture: "Team: Growth", "Domain: Commerce", "Status:
WIP", "Quarter: 2026Q2".

### Tag shape

  { type: string, value: string }

Both fields are required and trimmed. Tags dedupe case-insensitively by
\`tagKey(tag) = lowercase(type) + ":" + lowercase(value)\`, so
\`{ "Team", "Growth" }\` and \`{ "team", "growth" }\` are the same tag.
The first-written casing wins - re-adding a tag is a no-op, never an
overwrite.

### Tools

  add_project_tag      { projectId, type, value }
  remove_project_tag   { projectId, type, value }
  add_feature_tag      { featureId, type, value }
  remove_feature_tag   { featureId, type, value }

All four are atomic, idempotent, and return the new tag list on the ack
so callers don't need a follow-up read. They mirror the dashboard's
"+ Tag" chip exactly.

For bulk operations (replacing the whole tag set in one call, importing
tags alongside a fresh project/feature) use:

  create_project   { name, description, tags?: [...] }
  update_project   { projectId, tags?: [...] }       // replaces the whole array
  create_feature   { name, description, tags?: [...] }
  update_feature   { featureId, tags?: [...] }       // replaces the whole array

Passing \`tags: []\` on the update tools clears every tag. Omitting the
field leaves existing tags untouched.

### Dashboard-MCP parity (general rule)

Anything a user can do in the dashboard must be doable through the MCP
with the same atomicity, and vice-versa. Tagging is one instance of this
contract; the same rule applies to every future surface (filtering,
moving, archiving, …). When you add a dashboard interaction, ship a
matching MCP tool in the same change. When you add an MCP tool, make
sure the dashboard exposes a manual editor for the same shape.

## Naming convention

Names are for humans first. Every Feature, Surface, Action, Persona, Resource,
Entity namespace, Event, StateDefinition, Scenario, Rule, Effect, Invariant, and Transition
label should be readable in the dashboard without decoding implementation details.

Use short Title Case noun phrases for surfaces and verb phrases for actions:

  Surface: "Checkout", "MCP Server", "Maturity Dashboard"
  Action: "Apply Batch", "Get Repo Context", "Manage Rules", "Run All Scenarios"

Let the parent context carry repeated words. Do not add suffixes or prefixes that repeat
the surface, product, or category for many siblings. On the "MCP Server" surface, write
"Create Feature", "Manage Surfaces", and "Read Metrics Resource" rather than
"Create Feature via MCP", "Manage Surfaces via MCP", or "MCP Read Metrics Resource".
The same applies elsewhere: inside a "Checkout" surface, prefer "Apply Coupon" over
"Apply Checkout Coupon" unless the distinction is genuinely needed.

Prefer one meaningful differentiator over repeated boilerplate. If many actions would
share the same ending, remove the ending or move it into the surface name, intent, resource,
or data namespace. Use implementation names such as tool ids, file paths, HTTP verbs, or
database names in descriptions and implementation indexes, not in display names, unless the
user-facing concept is literally that technical object.

## Modeling interview

### Sizing the Feature first

Before creating anything, decide if the user is describing a new slice or
adding to an existing one:

  NEW SLICE        User says "I want to build X" where X is a coherent flow or
                   capability of its own. Create a new Feature inside the
                   current Project. Cap it at ~15 surfaces. If their pitch is
                   bigger than that, propose splitting into multiple Features
                   before modeling.

  EXISTING SLICE   User says "add Y to the X feature" or refers to a Feature
                   that already exists. Open that Feature with get_feature and
                   add to it. Do NOT create a duplicate Feature.

  WHOLE PRODUCT    User describes a whole product ("Build me a Spotify clone").
                   Push back. Ask which slice they want first; create a Project
                   for the product and one Feature for the slice they pick.
                   Modeling 50 surfaces in one Feature is a trap: your reasoning
                   coherence and the validator both degrade.

### Two modes. Offer the choice first

Before creating anything, ask the user which mode they want:

  SCAFFOLDING
  Create the surface and action skeletons quickly. Name everything, write intents,
  leave rules / invariants / effects / transitions empty or minimal. The user gets a
  structural overview they can review and correct before investing in logic.
  Use when: the user says "build me X", gives a vague description, or wants to see the
  shape before committing to details.

  DEEP MODELING
  Fill in every rule, invariant, effect, and transition. But ask for each piece of
  domain logic before writing it. Slower, more precise, produces a runnable spec.
  Use when: the user explicitly asks for a complete model, or switches from scaffolding
  after reviewing the structure.

You can also propose scaffolding first, then offer to deep-dive into one surface or
action at a time. "I've created the structure. Want to go deep on checkout now?"

### Never invent domain logic

Structure (surface names, action names, state paths) can be inferred from a description.
Domain logic cannot. Before writing any of the following, ask:

  Rules       "What prevents this action? Under what conditions should it be blocked?
               What happens when the condition is met. Block it, show a message, or both?"

  Invariants  "What must always be true after this action runs, regardless of input?
               Are there any states that should be impossible to reach?"

  Effects     "What changes in the system when this succeeds?
               Is there feedback shown to the user. A message, a navigation, both?"

  Transitions "Where does the user go after this action?
               Is it always the same destination, or does it depend on state?"

  Events      "Does anything outside this surface need to react when this happens?
               What does the event signal. A fact, a request, or a side-effect?"

  State       "Is this value local to this surface, or shared with other surfaces?
               What is the valid range / type / set of values?"

  Parameters  "Does this action take user input? What are the constraints on that input?"

### Deep-dive offer pattern

After scaffolding, always offer to go deeper on one entity at a time:

  "I've created [N] surfaces with [M] actions. The rules, invariants, and transitions
   are empty. Want to deep-dive into [surface name] now, or review the structure first?"

When the user picks an action to deep-dive:
  1. Read it back to them: name, intent, current effects (if any).
  2. Ask the rule questions above.
  3. Ask the invariant questions.
  4. Ask the effect questions (confirm each set_state, show_message, emit_event).
  5. Ask the transition question.
  6. Ask about scenarios: "Can you describe a failing case and a passing case for this?"
  7. Write everything in one apply_batch call once you have the answers.

### Dos and don'ts

  DO    propose a plausible rule and ask "Is this right, or should it behave differently?"
  DO    name the entity you're uncertain about and ask one focused question at a time
  DO    tell the user what you're skipping in scaffolding mode so they know to come back
  DON'T write rules that encode your assumptions about business logic
  DON'T write invariants that "sound reasonable" without confirmation
  DON'T fill in transition targets without knowing the actual UX flow

## Implementation quality

The spec is WHAT; the host repo is HOW. Your job is to produce code
indistinguishable in quality and style from what already exists. If the
repo is empty, default to something a senior reviewer would accept.

### 1. Probe before writing

Sample what already exists. Open:

  - One piece of pure logic (a function, a use case, a service).
  - One I/O path (a repository, an HTTP client, a database call).
  - One UI surface (a component, a view, a CLI handler).
  - One test.
  - The composition root, if there is one (where dependencies are wired).
  - The folder structure as a tree.

If the repo has conventions, MATCH them. Place new code where similar
code already lives. Use the same test framework. Use the same naming.
Even if you would have chosen differently, consistency beats local
optimization - the user will refactor globally if they want a different
pattern.

If the existing code is informal or inconsistent, do not introduce
ceremony just because you can. The new code should look like it was
written by the same hand that wrote the rest. Slightly better, not
visibly different.

### 2. Layering proportional to scope

If the repo is greenfield, pick the minimum structure that fits the work.
Hexagonal architecture is the right answer when the feature is big enough
that "where does this go" becomes a recurring question, or when multiple
adapters will exist (in-memory for tests, real one for production). It is
the wrong answer for a 50-line utility - ports with one implementation
each are dead weight.

  One-off script / single function       one file, no folders.
  Small feature (~3 actions, 1 surface)  flat module, named files.
                                          \`add-to-cart.ts\`, \`add-to-cart.test.ts\`.
  Medium feature (~5–15 actions)         folders separating concerns:
                                          logic/, io/ (or storage/),
                                          ui/. Light, named for what
                                          they hold.
  Large feature / shared kernel          ports + adapters + composition
                                          root. Feature folder:
                                          domain/, application/{ports,
                                          use-cases}, infrastructure/,
                                          presentation/.

When in doubt, start lighter and split when a second use case shares the
logic. Premature layering and premature flatness are both reversible, but
ceremony added by reflex is harder to remove later - it pretends to be
necessary.

### 3. Three principles that always hold

Regardless of how much layering you choose:

**Pure logic does not import I/O.**
A function that computes, validates, or transforms domain data does not
reach for the network, the file system, the DOM, or the current time.
If it needs the time, the time gets passed in. If it needs an ID, the
ID gets passed in. This is the rule even when there are no "layers" -
it just means the I/O happens in the calling function, not this one.

**UI does not contain business logic.**
Components, views, CLI argument handlers render and dispatch. A
condition that decides what is allowed, a transform that reshapes data
for a downstream system, a calculation that combines inputs - these
belong in a function the UI calls, not inline in JSX/markup/argument
parsing. The test for "is this business logic" is: would the rule
still be true if we replaced the UI? If yes, extract it.

**External dependencies are substitutable.**
Time, storage, network, IDs, randomness - anything that talks to the
outside world - is injected as a parameter, an object, or a function
so a test can swap a fake in. You do not have to define a formal port
(an interface, a class) for this; you do have to make it overridable.
A function that calls \`Date.now()\` directly is harder to test than
one that takes a \`now: () => number\` parameter. Lean toward the
testable shape.

These three are non-negotiable because violating them costs more later
than respecting them costs now. Everything else - folder names, layer
count, naming conventions, whether to formalize ports as interfaces -
is a judgment call governed by §1 and §2.

### 4. Quality bar

Aim for "a senior reviewer would accept without rewriting from scratch".
Not perfection - the user will refactor further. Concretely:

  - Names describe intent, not type or mechanism. \`addToCart\`, not
    \`handleClick\` or \`postCart\`.
  - No dead code. No commented-out blocks. No \`console.log\` left in.
    No naked \`TODO\` without a corresponding \`knownGap\` entry in
    .unspa.json.
  - No \`any\` / unchecked casts at module boundaries. Internal helpers
    can be loose if the boundary type is honest.
  - Errors name the failure mode ("CartItem not found: \${id}"), not
    "Something went wrong". Either return them as values (\`Result<T,E>\`)
    or throw intentionally - match what the rest of the repo does.
  - Tests exist for non-trivial logic. Test names read as "given X,
    when Y, then Z". One assertion per test where reasonable.
  - One reason to change per module. If a file would split cleanly
    along a "feature change" line and an "I/O change" line, it should
    already be two files.

### 5. Implement and sync incrementally

Do not batch a 20-file implementation into one .unspa.json update at the
end. After each meaningful chunk:

  1. Write the entry in .unspa.json (file, line, signature, kind, gitCommit, specVersion).
  2. Call sync_from_index so the dashboard stays accurate.
  3. Run the test you just wrote (the index entry can list testFile).

This keeps drift bounded and means a session interruption never loses
implementation tracking.

## Behavioral index

The behavioral index is a persistent map from every Unspaghettit entity to its exact location
in the codebase. It lives in .unspa.json alongside the project link (written by
\`unspa link\`), and the MCP server picks up the closest one above where it was started.
The linked project owns one or more features; a single flat index covers them all
(ids are unique system-wide).

### Entity key format

  action:<actionId>     surface:<surfaceId>
  state:<dotted.path>           rule:<ruleId>
  invariant:<invariantId>       event:<eventName>
  transition:<transitionId>     surface_rule:<ruleId>
  surface_invariant:<invariantId>       entity:<entityId>

Every entity must have its own key. A rule, event, invariant, or transition
attached to an action does not inherit the action's file:line. The
parent's signature describes the parent, not the child, so a missing child
entry is reported as missing in the dashboard. Add the dedicated entry at the
exact line where that rule body / event emission / invariant check /
transition trigger lives in code.

### .unspa.json shape

{
  "projectId": "<id>",
  "projectName": "<name>",
  "index": {
    "action:<id>": {
      "status": "implemented" | "partial" | "missing",
      "file": "relative/path/from/folder.ts",
      "line": 42,
      "signature": "export const addToCart = (item: CartItem): Promise<Cart>",
      "auditedAt": "2026-05-12T10:30:00.000Z",
      "gitCommit": "bf32e97b4e93e2816b470da1cf89a493c9f5c68a",
      "specVersion": "2026-05-11T15:10:32.389Z",
      "kind": "svelte-store",
      "relatedFiles": [{ "file": "src/routes/+page.svelte", "line": 1, "role": "UI entry point" }],
      "testFile": "src/features/behavior-model/domain/services/EffectApplier.test.ts",
      "knownGaps": ["search action not implemented. Filtering happens in store state only"],
      "notes": "(optional) extra human-readable context"
    },
    …
  }
}

Field reference:
  auditedAt    ISO timestamp of the last audit pass for this entry
  gitCommit    SHA of the implementation file's last commit when audited. Compare
               against \`git log --format=%H -1 <file>\` to detect file changes
  specVersion  Feature updatedAt when audited. Compare against current feature.updatedAt
               to detect spec drift (spec changed, implementation may be stale)
  kind         Pattern hint: svelte-route | svelte-store | svelte-component | mcp-tool |
               mcp-entrypoint | domain-service
  relatedFiles Additional files involved (e.g. component file + store file for one action)
  testFile     Test file path. Run \`vitest run <testFile>\` for targeted non-regression
  knownGaps    Structured list of spec elements not yet implemented (replaces free-text notes)

### Staleness detection strategy

At session start, after get_repo_context returns behavioralIndex stats, decide which
entries to re-audit:

  SKIP re-auditing an entry when:
    - auditedAt is recent (< ~2 days old) AND
    - \`git log --format=%H -1 <entry.file>\` matches entry.gitCommit AND
    - feature.updatedAt matches entry.specVersion

  RE-AUDIT an entry when any of:
    - auditedAt is absent or old (> ~7 days)
    - git log SHA differs from gitCommit → file changed since last audit
    - feature.updatedAt differs from specVersion → spec changed for this entity
    - status is "partial" or "missing" → known incomplete

  QUICK CHECK (read file, don't grep everything):
    - Jump to entry.line using kind as a hint for what pattern to expect
    - Verify the signature still exists at that line
    - Update gitCommit + auditedAt even if no other changes

This avoids re-auditing the entire codebase every session. A 50-entity index with
20 unchanged files needs only 20 git log calls to confirm they are clean.

### Codebase adoption (code -> spec): seed the index instead of hand-writing it

When you are modeling an EXISTING codebase, do not hand-author the index at all.
Use the evidence-gated adoption flow; the index falls out of the provenance spans:

1. attach_source_path for each source file you analyzed (repo-relative path;
   the server reads the file itself, so the content is never re-emitted).
   Fallback without repo context: attach_source_file kind:"code" with the exact text.
2. Model what the code actually does via apply_batch.
3. record_element_spans with all of a source's spans in one call,
   offsets pointing at the code each element came from.
4. finalize_analysis (blocked until every element is traced, so nothing is invented).
5. seed_index_from_analysis: every code span becomes an index entry
   ({file, line, signature}, specVersion stamped). Existing entries are never
   overwritten without overwrite:true.
6. sync_from_index to push the coverage report.

One pass yields the model, its provenance (Source Viewer), and implementation
coverage with drift detection armed. The manual workflow below remains the right
tool for ongoing implementation work after adoption.

### Indexing workflow

1. Call get_behavioral_index to see what is already resolved. Check stats (implemented /
   partial / missing) to know where gaps are. Call get_implementation_gaps to see exactly
   which entities are missing from the index vs. the feature spec.

2. For each unindexed or stale entry, apply the staleness strategy above to decide
   whether to skip, quick-check, or full re-audit. Read the feature to understand
   what it does, then explore the codebase to find the implementation.

3. Once you locate the implementation, capture one entry per entity. The action
   entry points at its own dispatch/handler line; every rule, invariant, transition,
   and emitted event attached to that action gets a separate entry at the line
   where its body lives (the rule's condition check, the invariant's assertion, the
   transition_surface call, the actual emit). Same rule for surfaces: the surface
   entry points at the surface's mount/store, each state:<path>, surface_rule:<id>,
   and surface_invariant:<id> gets its own entry at its own line. For each entry:
     - file: path relative to the folder containing .unspa.json
     - line: exact line of the function/check/expression that owns this behavior
     - signature: the one line that best identifies it (function/class/export declaration)
     - status: implemented | partial | missing
     - auditedAt: current ISO timestamp
     - gitCommit: \`git log --format=%H -1 <file>\`
     - specVersion: feature.updatedAt
     - kind: pattern tag (see above)
     - relatedFiles: other files involved (optional)
     - testFile: test file path if known (optional)
     - knownGaps: structured list of missing spec elements (optional)

4. Write the updated index back to .unspa.json using your file tools. The MCP does not
   write to .unspa.json. You do. Read the current file first, merge your new entries,
   then write the whole file.

5. Call report_implementation_status_batch to sync the status view in the Unspaghettit app.
   Feed it the index data you just wrote (one entry per action or surface entity).

### Reading the index as a debugger

get_behavioral_index returns the full map. Use it to jump directly to any implementation
without re-exploring the codebase. When a user asks "where is X implemented?", read the
index first. If the entry exists it gives you the exact file and line. Use kind to know
what pattern to expect before opening the file.

get_repo_context includes behavioralIndex stats (total / implemented / partial / missing)
so you know at session start whether the index is fresh or needs a pass.

## Key rules

- IDs are opaque server-minted strings. Never invent them.
  Get them from list_*/get_* responses or apply_batch refs.

- save_feature is an escape hatch for full-replace edits. Prefer apply_batch.

- All write ops return slim acks { ok, featureId, updatedAt, id? }.
  Re-read with get_action only when you need the new shape.

- Enum state definitions need allowed values: either inline enumValues[] or a valueSetId
  referencing feature.valueSets[] (not both). The defaultValue must be one of them.

- sharedWith on a StateDefinition links the same state path across surfaces.
  All surfaces sharing a path must declare it with the same type.

- Scenarios without expectedStatus/expectedAssertions always pass. Add them to make
  scenarios into real specs that run_all_scenarios can enforce.`;

export const registerGuideResource = (server: McpServer): void => {
  server.resource(
    'guide',
    'unspa://guide',
    {
      description: 'Full reference: data model, session start, apply_batch, expressions, audit workflow, key rules.',
      mimeType: 'text/plain'
    },
    async () => ({
      contents: [{ uri: 'unspa://guide', mimeType: 'text/plain', text: GUIDE }]
    })
  );
};
