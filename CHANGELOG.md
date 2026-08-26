# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [SemVer](https://semver.org).

## [Unreleased]

## [0.19.0] - 2026-08-26

The dashboard learns what it is part of. A standalone install is told that
Unspaghettit evolved into Lyriks Community, and one running inside an
appliance is told, once, to keep quiet about it. Nothing changes in the models
or on the wire: a snapshot written before this behaves exactly as it did.

### Added

- **The dashboard says what it is part of.** A standalone install now opens on a
  splash telling that Unspaghettit evolved into Lyriks Community: what carries
  over (the same engine and models), what comes with it, and a link to the free
  key. The offer stands until the user says
  otherwise: closing the panel hides it for that visit only, and the single
  button "keep using Unspaghettit on its own" retires it for good. The app menu
  reopens it either way. It waits for the display-name prompt, so a first visit
  never stacks two modals.

- **`PUBLIC_UNSPA_HOST_PRODUCT`.** Set it to the name of the product that embeds
  this dashboard and the offer above disappears for that deployment, whatever URL
  users reach it by. The two existing host markers suppress it too (`?brand=` and
  `?embed=1`), but only the env var survives a user opening the editor directly
  with no query string, which is exactly how someone reaches it inside an
  appliance. The Lyriks appliance image sets it.

- **README and docs cover the upgrade path.** A comparison of standalone
  Unspaghettit against Lyriks Community in the README, and a full page at
  `docs/lyriks-community.md` covering what the appliance adds, how it relates to
  models you already have, how to install it, and how to turn the offer off.

## [0.18.0] - 2026-08-24

Drift stops implicating a whole feature when one element moved, and the
index stops hiding a key that several features share. Both are additive:
`.unspa.json` is untouched, no re-seed is needed, and a snapshot written
before this behaves exactly as it did.

### Added

- **Per-element spec versions.** Every feature now carries `elementVersions`, a
  map from behavioral-index key (`"<type>:<id-or-path>"`) to the ISO time that
  element last actually changed. Every write stamps only what its diff touched:
  a rule edit moves the rule and leaves its action and surface alone. Children
  that hold their own key are excluded from a parent's digest, and scenarios are
  keyed apart from the action they test, so adding a test does not invalidate the
  code mapped to that action.

- **`sync_from_index` names the keys several features share.** The index is a
  flat map and a state path is not unique across features, so seeding feature by
  feature and merging the results silently keeps the last write: one entry claims
  to locate an entity that lives in many. Every surviving key still resolved, so
  orphans stayed empty and gaps read clean. The response now carries a `shared`
  block naming each such key and every feature that declares it. Reported, never
  fatal: `ok` is unchanged, because sharing a state path is legitimate modelling
  and the collision is the format's limit.

### Changed

- **`get_drift` answers per element.** Each entry is judged against the current
  version of the exact element it maps, so a changed rule no longer marks every
  audited entity of its feature stale. Stale rows carry a new `scope` field:
  `"element"` (this entity moved, real evidence) or `"feature"` (only the
  feature-wide stamp was available, so the row is suspect by association).

  Backward compatible: `.unspa.json` is untouched and needs no re-seed, a
  snapshot with no stamps behaves exactly as before and reports
  `scope: "feature"`, and the first write after upgrading calibrates a feature by
  stamping its untouched elements with its own `updatedAt`, an upper bound that
  can only reproduce the coarse signal, never hide a change.

## [0.17.1] - 2026-08-13

Dashboard-only patch: project deep links now tolerate host-mirrored stores
where the folder key and the id inside the file disagree.

### Fixed

- **Project lookup falls back to the folder name.** A host application
  mirroring snapshots into the store may key the project folder by a shared
  identity while a legacy writer stamped a different id inside the file. The
  repository resolved projects by the content id only, so a deep link carrying
  the folder key bounced to the projects list instead of landing on its
  project. `GET /api/projects/:id` (and every read behind it) now resolves by
  the content id first, then by the folder name; the content id stays the
  primary key and wins any collision.

## [0.17.0] - 2026-08-12

Serve the dashboard under a URL prefix decided at boot, so one prebuilt
package fits behind any path-routed ingress. Nothing changes for a standalone
`unspa dashboard`: the prefix is opt-in, additive, and off by default.

### Added

- **Runtime base path.** The dashboard can be served under a URL prefix
  (`unspa dashboard --base-path /behavior`, or `PUBLIC_UNSPA_BASE_PATH`),
  decided when the server starts rather than when the build runs, so the one
  prebuilt npm package serves any deployment. This is for path-routed
  ingresses that put several apps behind a single hostname (e.g. a Cloudflare
  Tunnel, which cannot route by port): pages, `/api/*`, assets and the Yjs
  `/sync` WebSocket all answer under the prefix. Unprefixed paths keep working
  (the prefix is additive), standalone `unspa dashboard` is unchanged, and an
  invalid prefix falls back to no prefix rather than a half-broken app.
  Internally the prefix is applied only at the browser edges (`withBase` /
  `stripBasePath` around a pure `src/shared/routing/basePath.ts`) and the
  production server strips it in front of the SvelteKit handler; the client
  router needs no hook, because SvelteKit's relative paths already compute
  the runtime base from the real browser URL. App-internal paths stay
  app-rooted throughout.

### Changed

- **Dead project links land on the projects list.** A stale project id (a
  deleted project, or a host application handing out a remapped id) used to
  render a dead-end "Project not found" stub; it now redirects to the live
  projects list, with `replaceState` so the Back button stays usable. Load
  errors still render in place rather than being hidden by a redirect.

## [0.16.0] - 2026-07-31

The adoption chain (code → spec) no longer assumes the engine and the codebase
share a filesystem, so a host that runs this server as a subprocess away from
the developer's checkout can drive it. Plus a security-relevant scoping fix, a
packaging fix, and a dead-code sweep.

Nothing changes for a standalone `unspa dashboard` or `unspa` CLI: every new
argument is optional and every existing call behaves exactly as before.

### Added

- **The behavioral index can travel as an argument.** `sync_from_index`,
  `get_behavioral_index`, `get_implementation_gaps` and `get_drift` accept
  `index` (plus `projectId`) and use it instead of reading `.unspa.json` off
  disk. Resolution against the spec is unchanged — only where the index comes
  from moves. Without those arguments each tool reads the linked `.unspa.json`
  exactly as before.
  This exists because the index half of adoption was unreachable for an
  embedder: the agent holds the filesystem (it reads the code and owns
  `.unspa.json`), the server holds only the spec, and there is no checkout
  inside the host's container to read. One resolver decides for all four tools,
  so the on-disk and inline paths cannot drift apart.
  On the inline path, line-healing and code snippets are skipped — both need the
  real files. Everything that needs only the index is unaffected.
- **`seed_index_from_analysis --dryRun` works without a repo link, and returns
  the entries.** A link is needed to *write* the index, not to compute it;
  demanding one up front made the preview impossible for exactly the caller that
  needs the entries handed back. The response now carries an `entries` map keyed
  as they belong under `index` in `.unspa.json`. Keys alone were not actionable
  for a caller that has to persist the index itself — the
  `{file, line, signature, specVersion}` values are the point of seeding.

### Fixed

- **A whole-project drift sweep no longer spans every project on the server.**
  `get_drift` with no `featureId` and no `.unspa.json` fell back to *every*
  feature it could see. Harmless for a one-repo CLI, wrong for a host serving
  many projects, where one project's report quietly included another's. It now
  takes an explicit `projectId` as the scope. Unchanged when a link supplies one.
- **`vis-data` is declared.** The behavior-graph renderer imports types from it
  and it is a peer dependency of `vis-network`, but it was never listed — so the
  peer went unmet on install and `tsc` reported a missing module on every run.
  Runtime was unaffected (the `standalone` bundle inlines it), which is why it
  survived this long.
- **Three runtime dependencies that nothing imports are gone**
  (`fast-json-patch`, `lib0`, `y-protocols`), along with the unused `tslib`
  devDependency. `lib0` and `y-protocols` still arrive transitively for the Yjs
  sync that needs them; they were simply never imported directly.

### Removed

- Dead code with no importers: `Result.ts`, `ResourceDeducer.ts`,
  `sync/publish.ts`, an unused `domain/entities` barrel, and four unreferenced
  Svelte components (`ActionStatsStrip`, `FeatureHealthStrip`, `StatePathInput`,
  `TagPillBar`). No public export changes.

### Changed

- **Two type definitions moved to the layer that owns them**, each re-exported
  from its old location so no import breaks. `FeatureSummary` is defined next to
  `summarizeFeature` in the domain rather than in the repository port — a
  summary is a projection of a Feature, not a property of how one is stored, and
  the domain builder should not import a port to describe its own return type.
  The path-safety rule (`isSafeSegment` / `assertSafeSegment` /
  `UnsafePathSegmentError`) moved to `shared/domain/pathSegment`, so an
  application use-case validating an imported bundle no longer pulls a
  `node:fs` module into its import graph to ask a question about a regex.

## [0.15.0] - 2026-07-29

One new opt-in capability for embedders, and one scoring fix. Nothing changes for
a standalone `unspa dashboard`: the gate below is inert unless configured, and no
dependency was added.

### Added

- **Optional session gate on `unspa dashboard`.** The dashboard has no
  authentication of its own — whoever reaches the port can read *and edit* every
  behavior model it serves. That is the right default for a local developer tool
  on loopback, but not when it is embedded in an authenticated product: the
  dashboard runs on its own origin and so sits outside the host application's
  login entirely. In one such deployment it answered `200` on `/api/*` with no
  credential while the host application was fully walled behind its own auth.
  Set `UNSPA_SESSION_SECRET` to the host's session-signing secret and nothing is
  served without a session cookie the host issued (HS256, verified with
  `node:crypto` — no new dependency, which matters for air-gapped embedders).
  `UNSPA_SESSION_COOKIE` renames the cookie, `UNSPA_SESSION_LOGIN_URL` tells an
  unauthenticated visitor where to sign in. Unset, everything behaves exactly as
  before.
  Unauthenticated requests get **401**, not a redirect: the dashboard is a
  single-page app whose fetches would follow a redirect and render a login page
  inside themselves.
  *Note for embedders:* a browser only sends the cookie to origins it is scoped
  to. A dashboard on another **port** of the host's origin receives it; on a
  different **subdomain** it does not, unless the host widens the cookie domain.
  Enabling the gate where the cookie cannot arrive locks out legitimate users.
  *Known gap:* this guards HTTP only. The Yjs sync WebSocket attaches its own
  upgrade listener and remains ungated — reachable only by bypassing the UI,
  since the SPA cannot load to open it.

### Fixed

- **Presentation surfaces stop dragging the confidence rollup.** `MaturityScorer`
  already excluded them — they are pure UI, so scoring their actions says nothing
  about modeled behavior — but `ConfidenceMatrix` still folded them into the
  feature rollup, inflating denominators and reporting a view-only screen as
  unmodeled behavior. Both now apply the same rule.
- **`update_surface` can set `presentation`.** The field existed on the Surface
  entity but no write path accepted it, so a surface authored through the MCP
  could never be marked as presentation — making the exclusion above unreachable
  for anything but hand-edited snapshots. Covered in the surface transforms, the
  batch ops and the operations vocabulary resource.

## [0.14.2] - 2026-07-22

Two user-facing breaks found by running the end-to-end suite, both shipped in
earlier releases and neither caught by the unit tests. No behavior or snapshot
changes; nothing to migrate.

### Fixed

- **The Expert | Builder switcher is visible again.** `ViewSwitcher` hid itself whenever the active THEME was Lyriks — but the Lyriks skin became the DEFAULT theme in 0.7.0, so the switcher silently disappeared for every install that had not opted into the classic theme, leaving Builder mode unreachable from the header even when `PUBLIC_UNSPA_VIEWS=builder` enabled it. Its intent was to hide under the Lyriks HOST, which is the `brand` query parameter, not the skin. Host detection is now one shared `isLyriksBrand` predicate used by the header lockup, the switcher, and the document title, so the three can't disagree. Caught by the end-to-end suite, which had been failing on this since the theme default flipped.
- **`Load samples` works again.** The bundled eShop "Catalog & reviews" sample carried a validation rule comparing `reviews.sortBy` against `""` — a value outside that enum's domain, so the guard was provably dead. 0.14.1's enum-domain check correctly rejects it, but samples are written as BRAND-NEW features, where the diff-aware gate offers no protection (every error counts as introduced), so the save 400'd and the button silently failed with `Snapshot save failed (400)`. The rule is removed rather than the check weakened: the action's `sortBy` parameter is a required enum already restricted to the same four values, so the parameter validator rejects unsupported input before any rule runs — the guard was dead AND redundant. Caught by the end-to-end suite; a scan now covers every shipped sample against the write gate.

### Known limitation

The dashboard's feature EDITOR does not yet resolve project-library references. It is backed by the live Y.Doc room, which reads and writes the stored snapshot directly rather than going through the repository, so after a `promote_to_project_library` a member feature's Entities / Resources / Personas tabs will not list the referenced definitions. Nothing is corrupted — references survive the round-trip intact, and the editor cannot turn one back into an inline copy — and every other consumer resolves them (MCP tools, `unspa check`, `GET /api/snapshots/:id`, the verify endpoint, digests). Promotion is opt-in per project, so this is latent until you use it. Dashboard read-resolution and a library authoring panel are the follow-up.

## [0.14.1] - 2026-07-22

Lands the two validation fixes that were open as PRs #22 and #23 before the 0.14.0 shape-validation rewrite, rebased onto it. All three close gaps where a malformed guard committed silently and then never fired. The write gate stays diff-aware, so existing snapshots remain editable and only newly authored breakage is refused.

### Fixed

- **A condition leaf with the operator under the wrong key is named, with the fix.** `apply_batch` takes each op as an untyped bag, so a leaf could arrive as `{ left, op: "neq", right }` (a host UI's visibility vocabulary): every consumer read `operator: undefined` and the comparison never fired, while dry_run reported valid. The shape pass now rejects unknown leaf keys and names the likely intent: "Did you mean \"operator\"?" for `op`, "Did you mean \"right\"?" for `value`/`expected`. Works at every depth of a composite condition.
- **A fabricated invariant consequent is rejected instead of silently inverting the invariant.** An invariant is `{ name, condition, message }`; authors writing an implication routinely invent a consequent field (`mustHold`, `then`, `implies`, `ensure`), which the builders cherry-picked away, collapsing "A implies B" into "A must always be true": the exact inverse of the intent, firing on legal data. `buildInvariant` / `buildInvariantPatch` now throw against the raw input, naming the supported spelling (`condition: { kind: "any", conditions: [{ kind: "not", condition: A }, B] }`); the shape pass flags any key that survived into a stored snapshot; and the operations resource plus the rule schema description document the invariant shape and the operator vocabulary up front, which is what invited the wrong guess.
- **Enum domains are enforced on the values that actually flow through a path.** An enum state definition names the CLOSED set of values a path may hold, but only `defaultValue` was checked: a `set_state` could write a value outside the domain, and a condition could compare against one, a comparison that is provably dead. Both are now flagged in reference integrity (effects, rule and invariant conditions, feature-level invariants included), resolved through `valueSets` exactly like the defaultValue check. Raw string literals only: an Expression resolves at run time, so it is left alone rather than guessed at. The driving defect: a plan enum of [free, premium] whose upgrade action wrote "family" left every `plan == "premium"` gate silently denying the customer who paid the most.

## [0.14.0] - 2026-07-22

Reference-over-copy for project-canonical definitions, plus a round of write/read symmetry fixes, driven by what the Lyriks platform needs from the engine. A project can now own entities, resources, and personas once and have member features REFERENCE them, so the copy-per-feature pattern (and the twin-collapsing heuristics it forces on readers) can go away. The maturity heuristic ships as a callable function so it stops being hand-copied across repos, `verify` reports per-scenario results machine-readably, and three classes of silently-wrong write are now rejected or rolled back.

Two things in the driving report did NOT reproduce on this engine and needed no fix: a condition-less invariant is already rejected at write time (fixed in 0.10.1, `apply_batch` covers surface, action, AND feature invariants), and `apply_batch` dry-run has never used weaker validation than commit — both paths run the same diff-aware gate. What was real is that the gate did not deep-validate SHAPES; that is fixed below.

**No breaking changes.** The new validation is diff-aware on every write path, so existing malformed data stays editable (pinned by tests); the package keeps `main`/`types` rather than an `exports` map, so every existing subpath import — including the `unspaghettit/cli/scenarios` path baked into generated scenario adapters — resolves exactly as before. The blocked-action fix was checked against 2155 simulated runs over 133 real features: no verdict changed anywhere, and the only two state differences were the leak being fixed. See "Verified against real data" below.

### Added

- **A project can own canonical entities, resources, and personas, referenced (not copied) by its features.** A feature has to be verifiable in isolation, so every consumer — validator, maturity scorer, simulator, model checker, digest, dashboard — reads `feature.entities` / `.resources` / `.personas` directly. Modeling one domain object across N features therefore meant N copies that drift, double-count in graphs, and force readers to guess which twins are "the same thing". A project now carries `entities[]` / `resources[]` / `personas[]` with stable ids, and a feature references them via `entityRefs` / `resourceRefs` / `personaRefs`. References are resolved at the REPOSITORY boundary, so nothing downstream changes: `verify`, `model_check`, `run_all_scenarios`, `score_feature`, digests, and the dashboard all see a self-contained feature, while the definition is stored exactly once. Saving strips the resolved copies back to refs, and an edit made through a member feature (`update_entity`, `add_entity_field`) writes back to the canonical definition — which is what canonical means. New tools: `list_project_library`, `promote_to_project_library`, `link_project_definition`, `unlink_project_definition`, `remove_project_definition`, plus `link_project_definition` / `unlink_project_definition` as `apply_batch` ops.
- **`promote_to_project_library` is the inline → reference migration.** It moves one definition into the project library, replaces it with a ref, and collapses identically-named copies in the project's OTHER features into references to the same definition. Copies are compared on content with ids ignored (independently authored twins mint their own ids for the entity AND every nested field), and a copy that has genuinely DIVERGED is left alone and reported in `skipped` rather than silently discarded. Pass `dedupe:false` to promote only the one feature's copy.
- **`computeFeatureMaturity(feature)` is exported from the npm package.** Consumers that need the maturity number offline were hand-copying the check weights out of `MaturityScorer`, so every engine release could silently drift the two formulas apart. `import { computeFeatureMaturity } from 'unspaghettit'` now returns `{ featureId, featureName, score, maxScore, percentage, criticalIssues, recommendedIssues, breakdown }` from the same code the dashboard and `verify` use — pure, synchronous, no I/O, safe air-gapped. Delivered via `main` + `types` pointing at a self-contained bundle (`npm run build:lib`), deliberately NOT an `exports` map: an `exports` map disables directory-index resolution, which would have broken `unspaghettit/cli/scenarios` — the path every generated scenario adapter imports. All existing subpath imports and the `unspa` / `unspa-mcp` bins resolve exactly as before (verified against a packed tarball in a clean consumer). Deliberately NOT a TRL number: the engine has no TRL concept, and inventing a 1-9 ladder here would just be a second formula to keep in sync — map `percentage` and `breakdown` to whatever scale you publish. `get_digest` also carries a `maturity[]` block now, so a digest consumer needs no second call.
- **`verify` reports per-scenario results, not just a count.** Each feature verdict carries `scenarios[]`: one row per authored scenario with `scenarioId`, name, `surfaceId` / `actionId` / `actionName`, `passed`, expected vs actual status, assertion counts (evaluated / failed / skipped), `firstFailingStep` and the action it invoked, and a one-line `reason`. Passing scenarios are included, because a report that lists only failures cannot answer "was this criterion actually exercised?". This is what lets a consumer trace acceptance criteria → scenarios → results without parsing prose.
- **The dashboard shows which release it is running.** A muted `Unspaghettit v0.14.0` stamp sits at the bottom-left of the projects container, so a screenshot or a bug report carries its own build identity instead of needing "which version are you on?" as a first reply. The string is inlined from `package.json` at build time (Vite `define`), so it costs no fetch and keeps `package.json` out of the browser bundle. The update banner still owns the "a newer one exists" message; this is just the "which one am I on" one.

### Fixed

- **A blocked action no longer commits state.** A parameter with `bindToStatePath` is written into state BEFORE rules run (deliberately, so a rule can gate on the incoming value), but the write survived a `block_action` — a validation rule blocking "amount exceeds balance" still left `transfer.amount` set to the illegal value. The same held for a `set_state` fired by a rule (or an action effect) that ran before the one that blocked, leaving half-applied state. A blocked run now rewinds to the pre-action snapshot: no bind, no effect, nothing commits. Messages, emitted events, the recorded transition, block reasons, and the applied-effect audit trail are all kept — they are the signal that the attempt happened — and `onBlockedEffects` still fire against the rewound state. Invariant violations are not rewound, so the model checker still gets its counterexample state. This makes the platform's workaround (guarding invariant-backing parameters with `validations` purely to stop the leak) unnecessary.
- **Tag values keep their casing byte-for-byte.** Every write path lowercased tag types and values, so a consumer matching `core:` / family / phase values exactly (the Lyriks platform keys its Features projection off them) saw its projection silently empty out on any write that touched a tagged feature. Tags are now stored as authored, trimmed only. Identity stays case-insensitive — "Growth" and "growth" are still one tag for dedupe, lookup, filtering, and rename — and on a differently-cased re-add the FIRST spelling wins rather than the last. Display no longer down-cases a fragment that already carries a capital, so "MCP" renders as "MCP" rather than "Mcp". Existing lowercase tags are untouched; nothing is rewritten on disk.
- **Summary lines read as sentences and the scope pickers say what they pick.** Every digest line rendered its label glued to its text ("Global Search:Header search over the entire model"): the separator was a whitespace-only template node that the compiler trimmed, so it never reached the page. The separator is now emitted as an expression and every line reads "Label: text". The Summary toolbar's dropdowns also carry visible "Feature" / "Surface" / "Action" labels: with two or three unlabeled selects side by side (and features and surfaces that can share a name), nothing said which level of the model each one narrowed.
- **`invoke_operation` effects pass validation, and their references are finally checked.** The effect type shipped in the write path and the simulator while reference-integrity validation checked against a hand-copied list that omitted it, so a legitimately authored boundary call was rejected on the way back in — the same write/read asymmetry this release is closing, in the engine's own validator. All three copies of the effect vocabulary (reference integrity, the shape pass, the simulator's error message) now read from `ALL_EFFECT_TYPES` so the list cannot drift again. Because the effect was unreachable, the references it names had never been validated either: `dependencyId` now has to resolve to a declared `Dependency`, `operation` has to be one that dependency declares, and `resultPath` answers to the same scope rules as a `set_state` target (declared on or shared into the surface, never a derived path). This can only widen what is accepted — an `invoke_operation` could not previously pass validation at all — so nothing that used to work can start failing.

### Changed

- **Validation now rejects malformed rule / invariant / effect / scenario SHAPES.** `apply_batch` ops are an untyped record, so nothing checked the vocabulary a condition actually used: an unknown operator (`gte`, `>=`) fell through the evaluator to `false`, a binary operator with no `right` compared against `undefined`, `{kind:"all", conditions:[]}` was vacuously true, and an unknown composite `kind` was silently treated as a leaf. Each turned a guard the author wrote into one that could never fire, while `dryRun` reported `valid:true`. The write gate now deep-validates: operators against the runtime vocabulary, condition-tree node shapes (composites, quantifiers, leaves), per-type required effect fields, outcome kinds, and scenario `expectedStatus` / assertion / step shapes. Dry-run and commit run exactly the same checks. **This is not a breaking change for existing stores:** every write path gates on `introducedValidationErrors` (diff-aware), never on `validateFeature` directly, so a pre-existing malformed element blocks neither unrelated edits nor edits to the offending element itself — which is what keeps a spec repairable. Only NEW breakage is refused, and a brand-new feature must be clean. Tests pin all four of those properties. What does change is visibility: `verify` / `score_feature` / `get_spec_gaps` now report these, so expect a one-time crop of findings on an older store. Run `unspa check` to see them; each error names the field and the valid values.
- **A dangling project-library reference is a per-feature error, never a lost feature.** A `entityRefs` / `resourceRefs` / `personaRefs` entry the owning project cannot satisfy (the definition was removed, or the feature belongs to no project) is reported by validation with the fix spelled out — re-add it, `unlink_project_definition`, or `add_feature_to_project`. The feature still loads and still appears in `list_features`, and `list_project_library` reports every dangling ref with the feature that holds it. Degrading one feature is always preferable to failing a query batch.
- **The project sidebar counters are correct on first paint.** Every counter was derived from the fully-loaded child features, which arrive as one request PER feature, so the whole sidebar read `0` until the last response landed. The summable counts (features, surfaces, actions, states, surface rules, personas) now come from the feature SUMMARY — a single request the server already builds by parsing each file, so they cost nothing extra and are exact rather than estimates. The four deduplicated panels (resources, entities, events, transitions) collapse duplicates across features, so a sum would overcount; they show `–` until the real data is in rather than a number that is briefly wrong. One shared `summarizeFeature` now backs every repository so an adapter can't report different counts from the panel it labels.
- **`?brand=lyriks` renames the browser tab.** The embedded dashboard swapped its header lockup, chrome, and skin for the host's, but the tab still read "Unspaghettit" — the most visible place the embedding leaked, since the tab is what you scan to find the window again. Under `brand=lyriks` the product half of every title becomes "Lyriks - Behavior Editor", and pages that are ABOUT one thing lead with its name (`Checkout / Project / Lyriks - Behavior Editor`) so several open tabs are distinguishable. The feature editor had no `<title>` at all and now has one.
- **Snapshot shape:** `project.entities` / `.resources` / `.personas` and `feature.entityRefs` / `.resourceRefs` / `.personaRefs` are new, all optional and additive. A snapshot written by 0.14.0 that uses NO references is byte-identical in shape to one written by 0.13.0, so upgrading alone rewrites nothing. The one-way door is per-project and opt-in: once you run `promote_to_project_library`, that project is no longer readable by an older engine (0.13 ignores the refs, so the promoted definitions simply vanish from the feature). Malformed ref arrays are dropped on read rather than reaching the resolver.

### Verified against real data

The blocked-action rollback is a semantic change, so it was measured rather than argued. Both engines (0.13 and 0.14) were run over 133 real feature snapshots — every action, from its default snapshot and from each authored scenario's starting state — and their results diffed: **2155 simulated runs, 1350 of which blocked, 0 status changes, 0 verdict changes,** and exactly 2 differences in resulting state. Both were the leak being fixed: one action wrote a rejected `fileName` / `byteLength` into state despite a validation rule blocking with "a source file is already stored", and one applied gravity to a player who was blocked out of the world. No sample or seed feature relies on state landing before a block.

## [0.13.0] - 2026-07-21

### Added

- **Deep links can target a specific rule, not just its container.** Global search already indexed every surface rule and action rule, but selecting one only scrolled to its container: the whole "Surface rules" tab body, or the entire action card, leaving the reader to hunt for the rule itself. Every rule now renders a focus anchor, and `?focus=rule:<id>` resolves it from the id alone - a surface rule opens its surface's rules tab, an action rule expands its owning action's card - then pulses the exact rule into view. Rule search results point straight at the rule, and any external link (for example a Lyriks report referencing a rule) can do the same by carrying that one parameter.

### Fixed

- **The verify panel's "open" link now lands on the violating action.** A counterexample trace's "open" link built `?focus=<actionId>` without the `action:` prefix the focus contract requires, so it navigated to the right surface but left the action collapsed and un-highlighted, silently missing its "Jump to the violating action" promise. The link now emits `focus=action:<id>`, matching the digest and project-action deep links, so the culprit expands and pulses on arrival.

## [0.12.1] - 2026-07-20

### Changed

- **The project behavior inventories collapse repeated rows by name.** The Surface rules, Transitions, and Actions panels listed one row per definition, repeating the same name across every feature and surface it appears in, so a shared rule or a common source surface was hard to read at a glance. Each now groups so a name reads once: surface rules group by rule name with every feature/surface that defines it underneath (sorted by feature then surface); transitions group by source surface with each destination underneath (sorted by target); and actions gain a surface sub-level (feature → surface → actions) that removes the repeating Surface column, with surfaces and their actions sorted alphabetically.
- **"Reusable action concepts" is renamed to "Reusable concepts" and ordered by name.** The section lists reuse candidates - states, events, resources, roles, parameters, value sets, and effect types - none of which are Unspa Actions, so the old label clashed with the first-class Action entity. The chips are now sorted by name instead of grouped by kind.

## [0.12.0] - 2026-07-19

Authoring-friction fixes surfaced by a five-project QA pass through the MCP. The highest-priority items in that report (the scenario runner ignoring state seeding, action invariants checked before their own effects, and `block_action` not enforced in the scenario runner) did not reproduce: they were already fixed on the current engine, confirmed by running the exact cases through `run_all_scenarios` and `model_check`. What remained were real reference and vocabulary gaps, fixed here. No breaking changes.

### Added

- **State definitions accept the common type synonyms.** `add_state_definition` (the standalone tool and the `apply_batch` op) accepted only `string | number | boolean | enum | object | array`, so a natural `type:"int"` bounced off the enum and a counter with `defaultValue:0` could not be declared at all. The write path now folds the synonyms an LLM most often reaches for onto their canonical type - `int`/`integer`/`float`/`double`/`long`/`decimal` → `number`, `bool` → `boolean`, `str`/`text` → `string` - before the value reaches the model, so `type:"int", defaultValue:0` just works. The batch path still refuses a mistyped *default* (a stringly-typed `"0"` is reported with "Use 0 instead of \"0\"", not silently coerced): only the type name is normalized, never the value.

### Fixed

- **The `add_reachability_goal` batch op reference no longer documents an impossible shape.** The operations reference (and `describe_operations`) showed a flat `{ name, kind, condition, ... }`, but that op's own `kind` (`"reachable"` / `"always_reachable"`) collides with the `apply_batch` op discriminator `kind:"add_reachability_goal"` - a JSON object cannot carry two `kind` keys, so the documented form silently dropped the op kind and the goal never landed. Both now show the nested `goal:{ ... }` form the handler has always accepted, with a note about the collision (the same pattern already called out for `add_resource` / `add_dependency`).
- **Scenario assertions are documented, and a mis-shaped one says why.** `expectedAssertions` items are `{ path, operator, value, description }` - not the rule-condition `{ left, operator, right }` shape - and each requires a `description`, but neither was written down, so an assertion authored with `left`/`right` failed with the baffling "Scenario assertion for 'undefined' is missing a description". The `add_scenario` reference now spells out the item shape and the required description, and the validator reports a missing `path` as exactly that ("an expectedAssertion is missing a 'path' ... not the rule-condition { left, operator, right } shape") for both single-action and multi-step scenarios, instead of blaming the description.

## [0.11.0] - 2026-07-19

Canonical project state variables become first-class. A project can own stable state identities, now authored directly in the dashboard's state registry and referenced from surfaces by id, with coherence diagnostics flagging stale or incompatible links across features. The dashboard also gains searchable behavior inventories, agrees a port with the MCP automatically (the default moves off `3000` to `43171`), runs cleanly embedded in a Lyriks host, and lets entity enum fields reference reusable value sets. Codebase adoption now steers an extractor toward the right taxonomy and an honest hard-vs-soft split, and gains `outline_repo`, a bounded map of the source tree so a feature split starts from real structure. No breaking changes: legacy surface state stays readable and no snapshots are rewritten.

### Added

- **Canonical project state variables connect behavior across features.** Projects can now own stable state identities with explicit owners, readers, writers, and optional links to entity fields or Builder nodes. New MCP tools create, update, link, list, and remove them; `add_state_definition` can project a canonical variable onto a surface by id; project aggregates and spec-gap diagnostics report stale or incompatible data-field links. Legacy surface state remains readable and is grouped by path without rewriting snapshots.
- **Behavior inventories now roll up from actions to features and projects.** The dashboard exposes searchable project and feature views for actions, surfaces, states, surface rules, and personas, with shared context sidebars and compact action statistics. Action rollups preserve feature/surface provenance and identify reusable cross-feature concepts such as state paths, events, resources, roles, parameters, value sets, and effect types.
- **`outline_repo` gives codebase adoption a map of the source.** A new MCP tool returns a bounded outline of the repository's source tree - directories, a file count per directory, and a file-type histogram - with `node_modules`, build output, caches, and dot-directories skipped and the walk capped by `depth` and `maxEntries`. The server reads the tree from disk itself (the same access behind `attach_source_path`), so an LLM can ground a feature split in real structure even on a host that gives it no filesystem tools of its own. It surfaces structure only and never decides the taxonomy - you still name the features and confirm the split. Scope a monorepo package with `subPath`. The bundled `unspa-adopt` skill and the `unspa adopt` prompt now point at it.

### Changed

- **The dashboard and MCP now agree on a port automatically, and the default moved off `3000`.** `unspa dashboard` (and `npm run dev`) start on the uncommon default `43171` - so they no longer fight the usual `3000` / `5173` / `8080` - and advance to the next free port if it's taken, printing the URL they bound. The running dashboard publishes that URL to `~/.unspa-hub/.dashboard.json`, and the MCP sync-notifier reads it before falling back to probing loopback ports, so live edit refresh (and activity toasts) work with zero config even when a WSL2 / Docker relay squats the old ports. Pin a specific port with a loopback `UNSPA_SYNC_URL` if you run the dashboard somewhere unusual.
- **Entity enum fields can reference reusable value sets.** Entity and entity-field MCP tools now accept `valueSetId`, allowing canonical state and data-field coherence checks to compare shared enum vocabularies.
- **The dashboard can run cleanly inside a Lyriks host.** `?embed=1` hides the complete header and other standalone chrome, suppresses onboarding, toasts, and floating widgets, and applies the Lyriks skin without overwriting the browser's saved theme. Global host context (`embed`, optional `user` history attribution, and `brand`) now persists automatically across every same-origin navigation, while page-local deep-link state remains scoped to its page. Independently, `?brand=lyriks` keeps the header visible but replaces its Unspaghettit lockup with the official Lyriks v3 logo, wordmark, and a "Behavior editor" product label. Vite now selects the first available development port instead of requiring port 8173.
- **Codebase adoption steers taxonomy and hard-vs-soft faithfully.** The `unspa adopt` prompt and the bundled `unspa-adopt` skill now tell the extractor to record the product's pillars as the project's core features (`declare_core_feature` + `set_feature_core`) instead of re-deriving the taxonomy from folder names on every pass, and to model a constraint as an invariant only when the code truly enforces it (it rejects or throws). An advisory check that merely warns and proceeds becomes a non-blocking rule, not a hard invariant that would claim a guarantee the code never made. Both fixes close the fidelity gaps that a real code-to-spec extraction surfaced.

## [0.10.1] - 2026-07-15

Two engine fixes found by dogfooding through the MCP: a condition-less invariant can no longer silently evict a whole feature on the next load, and the digest's "Where you can go" stops duplicating and mislabelling navigation. No breaking changes.

### Fixed

- **A condition-less invariant can no longer make a whole feature vanish.** `apply_batch`'s invariant ops (`add_surface_invariant` and the action / feature variants) accepted an invariant with a `description` but no `condition` and wrote it to disk; the standalone `add_*_invariant` tools already required one, so the write path and the read path disagreed. On the next cold load the expression normalizer walked that missing condition, threw, and the loader silently dropped the ENTIRE feature: `get_feature` returned "not found", the feature disappeared from `list_features` with no error, and a restart did not recover it. Three defenses now close this. The structural validator rejects a condition-less invariant at write time, so the batch path fails fast like the standalone tools and the poison never reaches disk. The expression normalizer tolerates a missing or malformed condition instead of crashing, so an already-poisoned snapshot loads and becomes fixable rather than staying evicted. And the loader warns to stderr when it skips an unreadable snapshot, so a dropped file is diagnosable instead of a feature silently going missing.
- **The digest's "Where you can go" no longer duplicates or mislabels navigation.** A surface reachable more than one way (a declared transition plus one or more actions whose `transition_surface` effect opens the same surface) rendered one bullet per route, so N routes to a destination read as N destinations; an edge whose target did not resolve to a surface rendered as a bare "... to another surface". `get_digest`'s navigation section now collapses every route from a surface to a given destination into a single entry named on both ends, and drops any edge whose target is not a surface in the feature (such as an action-to-action sequence). Each place you can go is listed once.

## [0.10.0] - 2026-07-13

Five additive fixes found by dogfooding the engine through its own MCP: model checking now exercises the values a rule gates on, pure-UI surfaces stop dragging maturity, scope errors name the exact fix, and authoring a batch is cheaper to commit and easier to discover. No breaking changes.

### Added

- **Presentation surfaces are excluded from maturity scoring.** A consumer that projects UI screens as surfaces (nav/click actions, no rules, events, or scenarios) used to see a feature's maturity capped low even when its behavioral surfaces were fully modeled, because scoring a "Grade B" button has no payoff. A surface now carries an optional `presentation` flag; when set, `scoreFeature` and `scoreFeatureBreakdown` skip it in the rollup and in the empty-feature short-circuit (so a feature whose only surfaces are presentation ones reads as not built, 0%, rather than dragged down by empty bodies), while keeping it in the model and in the path-sharing context so cross-surface reads of state shared from it still resolve. `scoreSurface` is unchanged, so a presentation surface can still be scored on its own. Not inferred from `type: 'screen'` (a hand-authored screen can hold real behavior). Purely additive: a surface with no flag reads exactly as before.
- **`apply_batch` dry runs return a reusable commit token.** `apply_batch` was stateless: `dryRun: true` validated and scored the result, then discarded it, so committing meant resending the whole `operations` array, real duplication for a large batch. A valid dry run now also returns a single-use `commitToken` (5-minute TTL); calling `apply_batch({ commit })` with no operations re-loads the current feature, re-applies and re-validates the cached ops, then saves. It never blind-saves the precomputed result: the feature may have changed since the dry run, so a stale batch is caught and asked to re-run rather than silently overwriting. An unknown or expired token returns a clear "re-run the dry run" error. The existing operations-carrying path is unchanged.
- **`describe_operations`, and the operations reference is discoverable.** The dense `apply_batch` op and Expression schema (param-left vs state-left, composite all/any, the `add_resource` nested-`kind` gotcha) lives in the `unspa://operations` resource, but a one-line pointer in a tool description is easy to miss. That resource is now guaranteed in `resources/list` (not only resolvable by URI), joined by a new `describe_operations` tool that returns the schema for one op kind, or the list of known kinds when called with none, so an author can pull just what they need without loading the whole reference. It reads the same reference the resource serves, so the two never drift.

### Fixed

- **Model checking now tries the boundary values a rule gates on.** Bounded exploration builds a parameter grid per action; a required `number` parameter with no default and no min/max validation produced an empty grid, so the whole action was marked unexplorable and skipped, and any state it would produce (and any liveness goal or downstream action behind it) was falsely reported "never reached" or "dead". The explorer now mines boundary values from the numeric thresholds the in-scope conditions compare that parameter against, directly (an action rule's `{kind:"param"}` left) or via the state path it binds to (`bindToStatePath`, the route open to surface rules, surface invariants, and feature invariants). Each threshold T contributes T-1, T, and T+1, so both sides of every `>`/`>=`/`<`/`<=`/`==` guard are exercised: an "approve" action gated by `amount >= 500` is now explored at 499 and 500 instead of skipped. A required number that no condition references still stays honestly unexplored, since no invented value should give false confidence.

### Changed

- **The "not shared into surface" error names the surface and the fix.** Writing or binding a state path that is declared on another surface but not shared into this one hard-blocked the batch with a terse "...is not declared on surface X (or shared into it)", leaving the author to guess whether the path was undeclared everywhere or just unshared. When the path is declared on another surface, the effect-write and parameter `bindToStatePath` errors now name it and prescribe the exact edit: `...is declared on surface "srf-triage" but not shared into "srf-refund". Add "srf-refund" to that StateDefinition's sharedWith.` The genuinely-undeclared case keeps its existing wording. Still a hard block (nothing that was valid becomes invalid); only the message improves.

## [0.9.0] - 2026-07-12

Make the model's own claims trustworthy, then start catching the defects a green model used to hide.

### Added

- **Sources can be ranked by authority, so a contradiction resolves by weight, not by ingestion order.** Provenance proves every model element came from somewhere, but not that the right source won when two of them disagreed. Each attached source now carries an optional `authority` (normative: the source of truth for intended behavior; supporting: evidences behavior but is not the authority on intent; observed: a report of what happens, not a decision; unknown: the honest default) and `artifact` (implementation, test, contract, documentation, interview). An unstated authority is derived from the artifact (a `contract` is normative; code, tests and docs support; an `interview` is an observation) and read through a single `effectiveAuthority` function, so the ranking policy lives in one place and storage stays minimal. Set both at attach time (`attach_source_file` / `attach_source_path`), or re-tag an already-stored or deduped source with the new `classify_source` tool (metadata only: the document text, its hash and id are untouched, so recorded spans stay valid). `list_sources`, `get_source`, and `get_provenance` now surface the effective authority. Purely additive: a source with no ranking reads as `unknown`, and pre-authority sources round-trip untouched. This is the foundation for treating contradictions between sources as first-class.
- **Contradictions between sources are first-class, not silently resolved.** When two sources disagree about the same behavior (code vs docs, a test vs the implementation, two specs), you can now `flag_conflict` it: a summary, at least two `claims` each attributed to a source, and the model elements it affects. The conflict starts `open`, a hole in the analysis's completeness that is distinct from an untraced element (a hole in its attribution), and it is settled with `resolve_conflict` as either `resolved` (one reading won) or `accepted_ambiguity` (the disagreement is real and left open on purpose), always with a written reason. Ranking pays off here: flagging a conflict returns a suggested winner derived from source authority (the higher-authority claim wins; a tie at the top is reported as genuine ambiguity for a human to settle), so a disagreement resolves by weight rather than by which document was read last. `get_provenance` and the `finalize_analysis` ack now report the open-conflict count, so "traced but not settled" is visible. Purely additive: conflicts live on the provenance sidecar (absent = none) and older sidecars still parse.
- **Behavior candidates: stage what a source proposes before committing it to the model.** A recorded span points from a modeled element back to its source; the new `stage_candidate` (and batch `stage_candidates`) points the other way, from a source range forward to a proposed behavior, with a `proposedKind`, a plain-language `summary`, an optional `confidence`, and a review `disposition`. It starts `unreviewed` and moves via `dispose_candidate` to `accepted` (it reached the model, and must name the `elementId` it became), `merged` (a duplicate, also element-linked), `rejected` / `out_of_scope` (deliberately excluded), or `conflict` (tied up in an open disagreement). This makes a reviewed behavior distinguishable from an unreviewed guess, so nothing a source describes goes silently unaccounted. `get_provenance` reports the candidate and unreviewed counts. The groundwork for source-coverage accounting: the share of a source's behavior that actually reached the model. Purely additive: candidates live on the provenance sidecar (absent = none) and older sidecars still parse.
- **Bidirectional source coverage: `get_source_coverage` answers "what might we be missing?".** Provenance's finalize gate asks whether every MODEL element traces to a source; this asks the reverse, whether every staged SOURCE behavior has a disposition, and reports the share of each source's behavior that reached the model. Every candidate falls into exactly one of four buckets (`modeled` = new behavior that reached the model, `duplicate` = already there, `excluded` = deliberately left out, `unresolved` = still undecided), so the buckets always sum to the source's candidate total. The tool returns per-source shares (sorted worst-unresolved first), an analysis-wide rollup, and the actual still-unresolved candidates, so the unresolved share stops being an abstract number and becomes a concrete review list. This closes the extraction-completeness loop the audit opened: attribution (every element came from somewhere) plus completeness (every source behavior is accounted for), resolved by source authority when they conflict. Coverage is candidate-based, so a source with nothing staged simply has nothing to account for yet.
- **External dependencies are now first-class.** A feature can declare the external systems it calls out to — services, datastores, queues, devices, humans, filesystems — each with its `operations` and, per operation, the contract code hides: a `timeout`, `retries`, whether it is `idempotent`, and its `failureModes`, plus feature-level `assumptions`. This is distinct from a `resource` (which describes where DATA lives): a dependency captures the behavior at the boundary, "a system's important logic often sits at its boundary with something else." Authored via the `apply_batch` `add_dependency` / `remove_dependency` ops; `get_spec_gaps` flags an external operation with no documented timeout or failure modes (the "which external calls have no timeout?" question), so the boundary risk stays visible. Purely additive: features that declare no dependencies are unchanged.
- **The `invoke_operation` effect wires an action to a dependency call.** An action (or rule) can now invoke an operation on a declared dependency — the explicit act of calling across the boundary. When given a `resultPath` + `resultValue` it writes the modeled return value there exactly like `set_state`, so downstream rules and first-class outcomes can branch on what the call "returned" (a decline, a timeout); omit them for a fire-and-forget call. Integrated end to end: the simulator applies it, `BehaviorSemantics` counts its reads/writes (so impact analysis, permissions, and the graph account for it), `find_state_references` sees its paths (rename-safe), the digest and global search describe it, and both effect authoring schemas (`add_effect`, rule effects) accept it. A failure is modeled as an action outcome on the result; the dependency's operation carries the timeout/retry/idempotency contract.
- **Event delivery semantics: a mandatory handler failure no longer hides as a success.** A registered event gains a `delivery` guarantee: `best_effort` (default, fire-and-forget, the historical behavior), `required`, or `transactional`. When an action emits a `required` or `transactional` event and one of its `triggeredByEvent` handlers fails, the emitting action is now reported blocked instead of a clean success — so "the command was accepted but the mandatory downstream update failed" is modelled honestly rather than swallowed; `transactional` additionally rolls the emitter's state back to before the action ran, so nothing partial lands. Wired through the simulator cascade, `add_event` / `update_event`, the `apply_batch` event ops, and the operations reference. `best_effort` events, and features that register no delivery, are unchanged.
- **An honest, explainable confidence matrix in `score_feature`.** A single maturity percentage mixes "are the fields filled in?" with "is the behavior actually covered and consistent?", so a high number can hide a weak spot. `score_feature` now also returns a `confidence` breakdown: five independent dimensions (structural completeness, behavioral coverage, guardrails, executability, consistency), each a share of concrete, checkable facts about the model carrying the exact counts it was derived from — and an `overall` set to the WEAKEST dimension, not an average, so a strong score can never bury a zero. A feature with a contradictory rule set or no invariants anywhere now reads its true, low confidence instead of a comfortable percentage. The existing `percentage` is unchanged.
- **Model checking explores parameter domains, not just defaults.** Bounded state exploration used to fire each action with a single parameter set (its defaults) and skip any action whose required parameter had no default — so it never exercised the branches a parameter value gates, and under-counted its own coverage. It now derives a small, bounded set of value combinations from each parameter's domain (every enum value, both booleans, a number's min/max validation bounds) and fires the action across them, so branches gated on those inputs get explored and the `--strict` gate's skipped-actions failure stops firing on them. An action stays honestly "not explored" only when a required parameter has no default and no enumerable domain (a free-form string, an unbounded number); a capped parameter grid marks the run truncated so a green result is never mistaken for exhaustive.
- **First-class action outcomes: model what actually happens, not just success or blocked.** An action can now declare `outcomes` — the terminal results it resolves to (a charge `declined`, a call that `timeout`s, a job left `pending`, a `partial` batch), each with a `kind` (success | rejected | failure | timeout | cancelled | partial | pending), an optional `condition` that selects it, and its own `effects`. The simulator applies the action's effects, then picks the first outcome whose condition holds (a condition-less outcome is the catch-all default) and runs its effects; the resolved outcome rides in the simulation result. Deliberately additive and built from vocabulary you already know: `status` stays exactly `success` / `blocked` so nothing generated or downstream breaks, an outcome is just "a named result with a when-condition and effects" (a transition or emitted event is just one of those effects), and with no outcomes declared an action simply succeeds as before. Authored via the `apply_batch` `add_action_outcome` / `remove_action_outcome` ops; outcome effects and conditions flow through the shared `BehaviorSemantics` analyzer, so impact analysis, permission scoring, and emitted-event tracking all account for them.
- **An evidence-first strict gate: `unspa check --strict` (and the `verify` MCP tool's `strict`).** One flag turns the exploratory report into a completeness claim: it enables bounded model checking, requires scenarios and 100% maturity and 100% verified implementation coverage, and promotes every advisory limitation — drift, dead actions, unmet reachability goals, actions model checking could not exercise, and a truncated exploration — from a warning to a failure. The ordinary defaults are unchanged and still fail only on the unambiguous things (a failing scenario, a reachable invariant violation), so nobody's CI changes unless they opt in. Skipped actions and truncated exploration are now first-class verdict checks either way.
- **Scoped invariant relaxation: `invariantRelaxation` replaces the blunt `bypassInvariants`.** A repair or admin action could previously only opt out of invariant checking with `bypassInvariants: true`, which silently skips EVERY feature, surface, and action invariant after it runs — one boolean disables all your safety properties. The new `invariantRelaxation` names exactly which invariants (by id) an action may leave temporarily violated, with a required `rationale` and an optional `recoveryCondition`; the simulator skips only those and still enforces the rest. Wired through `add_action` / `update_action`, the `apply_batch` action ops, and the operations reference; `get_spec_gaps` now nudges any `bypassInvariants` user toward the scoped form and flags a relaxation that names an invariant which does not exist. `bypassInvariants` still works (and still wins if both are set) for backward compatibility.
- **Decision-table analysis in `get_spec_gaps`.** The gap report now inspects each action's rule set and flags defects it can PROVE, never guesses: a rule whose condition can never hold (a conjunction that requires one state to equal two values, or to be both true and false), and two rules that fire on the same condition with disagreeing effects (allow vs block, or the same path set to different values) surface as critical gaps; a duplicate rule, a rule shadowed by an earlier unconditional block, and an action that is unconditionally blocked surface as recommended. Sound but deliberately incomplete: it stays silent where satisfiability is undecidable rather than cry wolf.
- **Core features: a precise, filterable grouping of a project's features, backed by a controlled vocabulary.** A project can now declare its CORE FEATURES: a curated registry of product pillars (each `{ value, description }`), and a feature joins one by carrying a reserved `core:<value>` tag. Reserving the `core` tag type is what makes the grouping precise instead of a sea of free-form tags: a descriptive tag like `security` lives under a different type and can never masquerade as a core feature, and a `core:` value only counts when it resolves to a declared registry entry. A feature belongs to at most one. Authored via `declare_core_feature` / `update_core_feature` / `remove_core_feature` (project registry) and `set_feature_core` (a feature's membership, which replaces any existing core tag in one write); the dashboard adds a Core features tab per project that declares the registry, groups every feature under its pillar, and offers per-feature assignment. Precision is enforced softly, never blocking a save: `get_project_aggregate` reports the grouping plus warnings for a feature tagged with an undeclared value or with more than one core feature. Purely additive: a project that declares none is unchanged, and the field round-trips untouched.
- **Feature-level acceptance criteria: prose Given/When/Then, the documentation facet beside model-checked scenarios.** A feature can now carry `acceptanceCriteria`: optional, feature-level prose acceptance tests, each with a `title`, `given` / `when` / `then` text, an `expectedOutcome` (success, failure, or blocked), an optional `relatedSurfaceId`, and a note. They are the honest home for an edge case a human writes in words, the complement to the structured, action-level `Scenario` the simulator proves. Rendered and searchable in the dashboard (a new Acceptance criteria tab), carried in the model, two-way editable, but deliberately never simulated, model-checked, or scored, because prose is not a formal assertion. Authored in the dashboard, via the `add_acceptance_criterion` / `update_acceptance_criterion` / `remove_acceptance_criterion` MCP tools, or the matching `apply_batch` ops. Validation is intentionally lenient: only a unique id and a non-empty title are required, and a dangling `relatedSurfaceId` never hard-fails, so a platform writer can point it at a surface on a sibling feature. Purely additive: a feature that declares none round-trips byte-for-byte, and the field is invisible to maturity and verification.

### Fixed

- **Two maturity checks could never fail.** Scenario coverage and required-state coverage had both collapsed into tautologies, so a complex action with no scenarios, or a partial `requiredStates` declaration, still scored the point. Both now actually gate. Alongside them a new shared `BehaviorSemantics` analyzer is the single source of truth for what an action reads, writes, and emits — it counts list mutations (`append/remove/update_list_item`), rule-carried effects, and parameter state bindings that the old scattered walkers missed, so mutating actions no longer slip past permission and dependency scoring. The permission check now keys off `persistence` / `destructive` roles rather than any transient write.
- **Standard-library blueprints stopped over-promising.** They were documented and tested as scoring 100% maturity on insertion; they are starter models — structurally valid and free of critical defects, but rescored after insertion and expected to need domain-specific rules, scenarios, and permissions.
- **Impact analysis and the behavior graph stop losing collection mutations.** `get_neighborhood` and the dashboard behavior graph built their own state read/write/emit walkers that only understood `set_state`, so an action that grew or shrank a list (`append_to_list` / `remove_from_list` / `update_list_item`), advanced time, bound a parameter into state, or emitted an event from a rule silently dropped those edges — the impact map under-reported what actually depends on a state path. Both now route through the shared `BehaviorSemantics` analyzer, so "what reads / writes / emits this?" is complete.

## [0.8.0] - 2026-07-10

Read the model in plain language, and compare against thresholds honestly: any scope of the behavior model now projects to a "what happens here" summary over MCP, and rules gained inclusive `>=` / `<=` comparisons.

### Added

- **`get_digest`: the plain-language digest is now an MCP tool.** The "what happens here" summary the dashboard renders at the top of its inspector — the things you can do here with their guards, the guardrails that always hold, and where you can navigate next — was previously dashboard-only. `get_digest` exposes the same projection to an agent for any scope: `projectId` (one clickable line per feature), `featureId` (a whole feature), `+surfaceId` (one surface), or `+surfaceId`+`actionId` (a single action). `detailLevel` gates depth (`glance` | `standard` | `full`), and `format` returns either the structured `DigestSpec` (each line carries the id of the model element it was derived from, so a caller can jump straight to it) or serialized Markdown ready to paste into a pull request or README; `hasContent` is `false` when the scope has no behavior to summarize. The prose is derived deterministically from the model — each action's intent, its block-rule reasons as guards, its effects and emitted events, invariant messages, transition labels — never LLM-generated, so it can never describe behavior that is not in the spec. Thin orchestration over the existing digest projector and Markdown exporter, so the MCP surface and the dashboard always describe behavior identically.
- **Inclusive comparison operators `>=` and `<=` (`greater_or_equal` / `lower_or_equal`).** Rules, invariants, and scenario assertions can now say "at least" / "at most" directly instead of forcing a strict `greater_than` / `lower_than` with an off-by-one literal like `greater_than 19` to mean `>= 20` — a trick that made specs lie slightly about intent. Wired end to end: the operator union and labels, the condition evaluator (numeric and ISO-date), the scenario assertion enum, scenario test codegen (`toBeGreaterThanOrEqual` / `toBeLessThanOrEqual`), the rule and scenario MCP tools, and the operations reference. UI operator dropdowns pick them up automatically.

### Changed

- **`get_spec_gaps` stops crying wolf, and catches an inert declaration it used to miss.** The "no effects" gap no longer fires on an action whose behavior lives entirely in rule-carried effects (every Rule has a required effect) or in `onBlockedEffects` — correct actions were being flagged as incomplete. In exchange it gains an honest new recommended gap: an action that declares `emittedEvents` which no `emit_event` effect actually fires, so the declaration is inert at runtime (no cascade or `triggeredByEvent` handler runs). The operations resource now also documents the evaluation semantics the diagnostics assume (sequential effects, derived recompute after each, surface-rules-before-action-rules, block suppression, post-cascade assertions).

## [0.7.0] - 2026-07-07

Adopt what you already built, and wear the brand: code-to-spec becomes a first-class, evidence-gated flow that yields the model, its provenance, and implementation coverage in one pass; the dashboard now defaults to the Lyriks look with the Unspaghettit lockup in every theme.

### Added

- **Codebase adoption: code → spec is now a first-class, evidence-gated flow.** Turning an existing codebase into a behavior model used to be four lines of prose in the docs; now the product backs it end to end. Source-code files attach as `kind:'code'` sources (their name is the repo-relative path, backslashes normalized, absolute paths and `..`-walks rejected), every extracted element is traced to the exact code span it came from, and the finalize gate keeps the extraction honest: nothing can be modeled without a source. The payoff is the new **`seed_index_from_analysis`** MCP tool, the bridge between the two previously disconnected mapping systems: every span recorded against a code source becomes a `.unspa.json` behavioral-index entry (`{file, line, signature}`, `specVersion` stamped), so one analysis pass yields the model, its provenance (browsable in the Source Viewer), AND non-zero implementation coverage with drift detection armed from day one. Existing index entries are never clobbered without `overwrite:true`; every traced element is seeded, including entities, feature-level invariants, surface-declared transitions, and declared events (kinds the per-action coverage report doesn't display, but whose entries document the location and arm drift detection); only elements that no longer resolve in the feature are reported as `skipped`, never dropped silently. Entry points: **`unspa adopt`** prints the paste-ready agent prompt (`--prompt-only` for piping) and the new bundled **`unspa-adopt`** skill (installed by default via `unspa init`) encodes the whole recipe: where each element hides in code, how to record spans that survive refactors, and the finalize → seed → sync → verify loop. For code sources, dedupe is path-aware: identical content at two paths stays two sources, and a pasted document can no longer swallow a code attach.
- **Adoption token costs roughly halved: `attach_source_path` + `record_element_spans`.** The two hot spots in the adoption loop each got a cheaper form. `attach_source_path` takes a repo-relative path and the MCP server reads the file from disk itself, so the file content never has to be re-emitted through the conversation (previously every adopted file was paid for twice, once read and once attached); it is the one deliberate, opt-in exception to "the MCP never reads source files": path-validated (no absolute paths or dot-walks), resolved against the linked repo root, size-capped, CRLF normalized to LF so span offsets are OS-independent, with `contentHash`/`totalChars` returned for verification. `record_element_spans` stamps many elements in one call (one load, one save) instead of one round-trip per span; failures are reported per item with the reason, without aborting the rest. The single-item tools remain. The `unspa adopt` prompt, the `unspa-adopt` skill, the MCP guide, and the init context template all now steer agents to the cheap forms.
- **Project source store + paste-to-analyze.** Documents an AI analyzes for provenance now live as immutable, content-hash deduplicated files in the owning project's `sources/` folder (next to the feature files), instead of being embedded one-per-feature inside the provenance sidecar. A new **Sources** tab on the project page lets you paste a document (PRD, spec, notes) straight into the dashboard; agents pull it through the new `list_sources` / `get_source` MCP tools instead of receiving it pushed through chat, and `remove_source` / `reset_analysis` finally give both stores a way out (the old sidecars were attach-once and permanently locked). One document can feed several features with zero duplication, an analysis can link several documents (`record_element_span` takes an optional `sourceId`), and the provenance viewer grew a document picker for multi-source analyses.

### Changed

- **The Lyriks skin is now the default theme; the teal look lives on as "classic".** A fresh install (no `unspa theme set`, no in-app choice) now boots with the Lyriks.io violet→fuchsia brand. The original teal/cyan skin is still one switch away as the `classic` theme (`unspa theme set classic` or the header palette button), and `unspa theme set default` / `unspa theme reset` keep working as an explicit revert to the default. Themes remain purely cosmetic.
- **The header brand is the same across every theme: the Unspaghettit lockup plus a "Powered by Lyriks.io" badge.** The Lyriks theme no longer swaps the header to the Lyriks logo and "Community Edition" label; every theme shows the Unspaghettit logo and wordmark with a pill badge underneath, carrying the Lyriks three-bar mark and linking out to lyriks.io.
- **Docs and agent guidance caught up with codebase adoption.** The `unspa init` context template (`CLAUDE.md`/`AGENTS.md` block) gains an "Adopting an existing codebase" section and drops its em dashes; the `unspa://guide` MCP resource documents the adoption flow, adds the missing `entity:<id>` key to the index contract, and fixes its stale `.unspa.json` shape (the link is `projectId`/`projectName` since the project-link change, not `featureId`/`featureName`); the server instructions, core concepts (new "Source provenance & codebase adoption" section), getting-started, and CLI README all reference `unspa adopt` and the `unspa-adopt` skill.

- **Provenance sidecar format v2.** `<featureId>.provenance.json` now stores span-to-source links instead of the whole document (`sourceIds` + per-span `sourceId`). Existing v1 sidecars are migrated automatically at startup: the embedded document is extracted into the project's `sources/` folder and every span is stamped, idempotently and with identical documents shared rather than duplicated. Older dashboards cannot read v2 sidecars, so update dashboard and MCP together.

### Fixed

- **Code snippets stay black under the Lyriks theme.** The Lyriks skin remaps the dark slate/neutral utility classes to violet so primary buttons read as brand-coloured, but that remap also caught the code surfaces sharing those classes: the implementation panel's snippet blocks and the MCP page's expanded JSON rendered on purple. `pre`/`code`/`textarea` elements now keep their un-themed near-black backgrounds in every theme; buttons and toggles keep the violet emphasis.
- **MCP live sync reaches the dev dashboard again.** When the dev server moved off the WSL2-reserved port 5173 to 8173, the MCP's reload notifier kept probing 5173: every MCP write since then silently failed to reach a `npm run dev` dashboard, so open editors went stale until a manual refresh, no toasts fired, and no `mcp` history entries were recorded (a feature built through MCP during that window shows a lone "Initial state" seed instead of its edit timeline). The default probe list now targets `127.0.0.1:3000` (the `unspa dashboard` production build) plus both the IPv6 and IPv4 literals on `:8173` (the Vite dev port). The stale `:5173` candidates are dropped on purpose: on Windows that port is frequently held by a WSL2/Hyper-V relay, so probing it can hand the notify to a foreign process. The per-attempt timeout also grew from 300 ms to 1 s: a dead loopback port refuses instantly either way, but a dev server busy re-transforming its SSR graph could exceed 300 ms and get misclassified as down. `UNSPA_SYNC_URL` still pins a custom port and skips the probe.
- **History entries name their author instead of `unknown`.** Writes arriving through the dashboard's own REST API (queueing an action for implementation, saving a project) logged `author: 'unknown'` because the Y.Doc transaction carried no origin. They are now attributed to the connected user's display name, falling back to a neutral `dashboard` badge when nobody has set a name. The identity registry also stops treating the client-side "Anonymous" default as a real name, so MCP-driven entries no longer render as "AI · Anonymous".
- **`sync_from_index` no longer flags documented key forms as orphans.** The orphan check compared `.unspa.json` keys against only the entity kinds the per-action/per-surface coverage reports consume, while the documented contract (and `get_drift`'s resolver) also mints `entity:<id>`, feature-level `invariant:<id>`, surface-declared `transition:<id>`, and declared-but-not-yet-emitted `event:<name>`. Recording one of those exactly as the docs instruct made sync return `ok:false` with a misleading "key not found in any feature spec" hint. The orphan universe now accepts the full documented contract, matching drift detection.
- **The graph page fits the viewport exactly.** The behavior-graph pages reserved `100dvh - 4rem` under a sticky header that is actually 4rem + 1px (its bottom border), leaving a permanent 1px overflow and a window scrollbar on an otherwise fixed-height page.

## [0.6.0] - 2026-07-04

Widen the on-ramp and the toolbox: one-step setup for everyone, a much larger surface library, and a plain-language digest of any scope.

### Added

- **Zero-setup bootstrap scripts.** `install.ps1` (Windows) and `install.sh` (macOS/Linux) take a machine from nothing to a working MCP: they check for Node.js and install it (winget / Homebrew) when missing or too old, install the CLI, then register the MCP globally with whatever AI clients they detect. One line, no terminal knowledge required:
  - macOS / Linux: `curl -fsSL https://raw.githubusercontent.com/lyriks-io/unspaghettit/main/install.sh | sh`
  - Windows: `irm https://raw.githubusercontent.com/lyriks-io/unspaghettit/main/install.ps1 | iex`
- **Codex is now auto-configured (CLI + VS Code).** A real Codex adapter writes the `[mcp_servers.unspa]` table into `~/.codex/config.toml` (global) or `.codex/config.toml` (project), replacing the old paste-this-snippet stub. The Codex CLI and the VS Code extension share that file, so one write wires up both. Merges into your existing `[mcp_servers.*]` tables without disturbing them; `unspa uninstall` strips it back out.
- **A much larger surface library.** The "Add a surface" template library grew from a handful of blueprints to 100 ready-made, 100%-mature surfaces across 28 categories (auth, commerce, messaging, dashboard, scheduling, billing, search, maps, finance, media, learning, CRM, productivity, developer, AI, community, and more). Selecting a template now highlights the sibling surfaces it will connect to and dims the rest, so the transitions you are about to create are visible before you click Add.
- **Behavioral Digest.** Turn any scope, a single feature or a whole project, into a plain-language "what happens" summary, reached from a Summary link on the feature header and the project toolbar. Every sentence deep-links back to the surface, action, or invariant it came from, and the whole digest exports to Markdown.

### Changed

- **`unspa init` registers the MCP globally by default.** The behavior model already lives in the shared hub (one machine-wide source of truth), so the matching default is a machine-wide MCP registration: the tools attach in *every* repo after one install, including clients with no per-project scope (Claude Desktop, Windsurf). A per-repo `.mcp.json` pointing at hub data was the odd combination. Use `--scope project` (pairs with `--local`) for an entry that travels with the repo in git. Per-repo context blocks (`CLAUDE.md` / `AGENTS.md`) and skills still land in the current repo regardless of MCP scope, because they document the repo, not the machine.

### Fixed

- **Claude Desktop on macOS now works out of the box.** GUI apps on macOS launch with a minimal PATH (no `/usr/local/bin`, Homebrew, or nvm), so the old bare `unspa-mcp` command failed to spawn with `ENOENT`. On macOS / Linux `unspa init` now writes an absolute node + script entry (`command: <node>, args: [<.../mcp-server/bin.cjs>]`) that depends on nothing in PATH. Windows keeps `cmd /c unspa-mcp` (GUI apps inherit the user PATH); Claude Code in a terminal was never affected. A node version change can stale the pinned path; re-run `unspa init` to refresh.
- **Detection catches installed-but-unlaunched clients.** The old check only saw a client after its config directory existed (i.e. after first launch), so installing a client and then running setup wired up nothing. Each CLI client is now also detected by its executable on PATH, and Claude Desktop (no CLI) by its install directory, so a fresh install is recognized immediately.
- **Template library dialog polish.** The surface picker gained a real close button and no longer shows a second, outer scrollbar, so only the surface list scrolls.

## [0.5.1] - 2026-07-02

A usability and hardening pass: make the dashboard legible on first run, scope MCP setup to the project it belongs to, and close two local-attack surfaces.

### Added

- **First-run onboarding banner.** A "Getting started" strip under the header offers the 3-minute interactive tour, a one-click sample project, and the full guide. It persists per browser and retires itself once the tour is completed or dismissed; the Help page keeps the same shortcuts as the permanent re-entry point.

### Changed

- **Project-first navigation.** The header now surfaces a single top-level destination, Projects, since a Feature only exists inside a project. The MCP playground moved to a per-project page (`/projects/[id]/mcp`), reached from an MCP button on the project header next to Graph, and is auto-scoped to that project (feature selector only, no project dropdown). The old `/mcp` route redirects to the project list.
- **Plainer first-run copy** on the Projects and Features lists, with empty states that explain the Project/Feature model and offer the tour or the sample project.
- **Human-facing docs** (README-adjacent guides, SECURITY, CONTRIBUTING, AGENTS) no longer use em dashes.

### Fixed

- **MCP page load time.** `get_project_aggregate` now loads a project's features concurrently instead of one HTTP round trip at a time, the live tool examples stream in off the main thread instead of freezing the tab, and each example's JSON is formatted only when expanded. The page paints immediately with skeleton/spinner loading states instead of a blank screen.

### Security

- **DNS-rebinding / CSRF hardening on the default loopback dashboard (always on).** A loopback bind alone doesn't keep a browser out: a page you visit can rebind its own hostname to `127.0.0.1` and issue *same-origin* requests to the dashboard, bypassing CORS to read, delete, or import over your local models. Every `/api/*` request and Yjs WebSocket upgrade now must carry a loopback `Host` header, and state-changing requests a same-origin (or absent) `Origin` - a rebinding page sends its own hostname and fails closed with `403`. Needs no configuration; add hostnames with `UNSPA_ALLOWED_HOSTS`, and it steps aside on a wildcard (`--host 0.0.0.0`) bind where `UNSPA_AUTH_TOKEN` is the intended gate.
- **Path-traversal fix on bundle import.** A hand-crafted `.unspa` bundle whose `statuses[].featureId` / `features[].id` contained `../` could make the implementation-status / provenance sidecar write escape the snapshot tree (arbitrary JSON file write). Every id that becomes a filename is now charset-validated at the path-builder layer, and a malformed bundle is rejected with `400` before anything is persisted.

## [0.5.0] - 2026-06-28

The provenance & projection release. Two ways to *see* the model: where every modeled element came from, and what the model looks like as a diagram.

### Added

- **Source Provenance - store the source a model was extracted from, and trace every element back to it.** When an AI agent analyzes an uploaded file through the MCP, Unspaghettit now stores the original file alongside the model and stamps every extracted element (surface, action, rule, invariant, transition, …) with the exact source span it was derived from. A **Source Capture** workflow on the MCP side (`attach_source_file` → `record_element_span` → `finalize_analysis`, gated so finalize requires every element traced) and a dashboard **Source Viewer** that renders the stored file with each span highlighted and bidirectionally linked to its element - click an element to reveal its span and vice versa, toggle and filter highlights by type.

- **Diagram Projections - project one model into many diagram formats.** Render a single feature or a whole project as a statechart (surfaces + transitions), a sequence diagram (event chains), an ER diagram (entities + fields), a per-action flowchart, or a containment mindmap, alongside the existing free behavior graph. Each format is a pure projector that emits a neutral `DiagramSpec`; a **Projection Viewer** draws it interactively (pick scope + format, drill into elements) and an **Export** panel emits it as copyable **Mermaid** or **Graphviz DOT**, or downloads **SVG/PNG**. Projectors register behind a `Projector` port and exporters behind a `DiagramExporter` port, so the viewer depends on the abstraction, not the concrete formats.

### Fixed

- **Graph view fills the viewport** instead of overflowing into a page scrollbar (the new projection toolbar had pushed the canvas past `100dvh`).
- **Dragging the behavior graph / diagram canvas no longer selects surrounding page text.**
- **Feature cards refresh their implementation-coverage score live** when an MCP coverage report arrives, instead of only after a full page reload.

### Changed

- **Documentation restructured** - the README is now a concise overview, with full guides split into `docs/` (getting started, concepts, prompting, collaboration, security, architecture, worlds & quests).
- The dev server moved off Vite's default `5173` (reserved by WSL2/Hyper-V on Windows) to `8173`.

## [0.4.0] - 2026-06-23

The verification release. Unspaghettit moves from *describing* behavior to *proving* it. Bounded model checking explores a feature's reachable state space for invariant violations; **liveness / reachability goals** prove "good is reachable", not just "bad never happens"; **project-level invariants** span features; **cross-feature event coherence** catches dead wiring; and spec→code **drift** plus **verified coverage** close the loop so a divergence between model and code fails the build. A headless **`unspa check`** gate, an **`unspa ci`** scaffold, the **`verify` / `get_drift`** MCP tools, and a dashboard **Verify** view (with navigable counterexample traces) make it executable from CLI, chat, and browser. Plus **global search** across the whole model (⌘K / Ctrl+K) and a **reachability-goals editor**. Additive and non-breaking.

### Added

- **Verified coverage - prove the code matches the spec, and gate on it.** Closes the spec↔code loop, turning the model from "claimed implemented" into "proven against the spec". The generated scenario spec now tags each test with a machine token (`[unspa:surface:action:scenario]`); run it (`vitest run --reporter=json --outputFile=…`) and **`unspa coverage ingest <report>`** stamps `verifiedAt` on the matching `.unspa.json` entries when every one of an action's scenarios passed (and clears the stamp when a scenario regresses). `verify` and **`unspa check --min-verified <pct>`** then gate on the share of a feature's actions that are proven, so a divergence between spec and code fails the build - not just a stale doc. The verdict gains a `verified` check (claimed vs. proven). The full loop: `scenarios adapter` → fill → `scenarios export` → `vitest --reporter=json` → `coverage ingest` → `check --min-verified`.

- **`unspa ci` - scaffold the CI gate.** Writes `.github/workflows/unspaghettit.yml` running `unspa check` on every push / PR, so a failing scenario, a reachable invariant/liveness violation, or spec→code drift fails the build. `--model-check` bakes in the deep checks; idempotent (refuses to clobber without `--force`). Requires the model to travel with the repo (`unspa init --local`).

- **Author reachability goals in the dashboard.** A new **Reachability goals** tab on the feature page (beside Invariants) with add / edit / remove, a `reachable` vs `always_reachable` selector, and the shared condition builder (`StatePathSelect` + operator + right-value editor, leaf or composite). Closes the last dashboard↔MCP parity gap - every authored entity is now editable in both surfaces (feature invariants already had their editor; goals were the one hole).

- **Reachability goals render in the behavior graph.** A `Liveness goal` node wired by `reads` to the state paths it targets, alongside the existing invariant nodes - so the safety (invariants) and liveness (goals) properties of a feature are both visible in the graph.

- **Project-level (cross-feature) invariants.** A `Project` can declare `projectInvariants` - safety properties that span its member features, referencing state paths owned by *different* features (e.g. "the orders feature's open count equals the billing feature's unpaid count"), which a feature invariant structurally cannot express. The verification spine enforces them during bounded model checking: each is checked at every explored state of every feature, over a snapshot seeded with the other features' defaults, and a reachable violation is reported with the action path that reaches it (riding the same counterexample channel as feature invariants). Authored via granular `add_project_invariant` / `update_project_invariant` / `remove_project_invariant` (or `update_project` for a full-replace), evaluated per project cohort by `verify` / `unspa check --model-check`.

- **`unspa scenarios adapter` - scaffold the spec↔code adapter.** Generates the `UnspaAdapter` stub the export command needs: one `case` per scenario-bearing action, pre-seeded with the implementation location recorded in `.unspa.json` (file:line - signature). Removes the last hand-written step in the code-vs-spec loop - `scenarios adapter` → fill the TODOs → `scenarios export` → `vitest`, so a scenario that disagrees with the real implementation fails CI. Experimental, same as the export wedge.

- **Verify view in the dashboard.** A new **Verify** tab on the feature page (`/features/<id>/verify`, beside Graph) that runs the whole verification spine server-side and renders the per-feature verdict: every check `pass` / `warn` / `fail` with its detail, and invariant / liveness **counterexamples rendered as navigable step-chip traces, each with a deep-link that jumps straight to the violating action in the editor** - the model checker's most useful output finally has a human surface. A model-check toggle and re-run button; scoped to the feature's project so cross-feature checks resolve, with sibling verdicts tucked under a "Project context" disclosure. Backed by a new `/api/snapshots/<id>/verify` endpoint over the same `VerifyFeatures` use case the CLI and MCP use, so the dashboard, `unspa check`, and `verify` all agree.

- **Cross-feature event coherence.** `verify` / `unspa check` now reason across a whole project, not one feature at a time. A new pure `analyzeEventCoherence` flags every event handler (`triggeredByEvent`) whose event is emitted by no action anywhere in the cohort - dead wiring a per-feature check structurally cannot see, because the emitter may live in a sibling feature. Surfaced as an advisory `event wiring` check on the feature verdict and an `eventCoherence` block on the report. (The simulator already *resolves* cross-feature cascades at run time; this is the static dual that catches the ones that can never fire.)

- **Liveness / reachability goals - the model checker now proves "good is reachable", not just "bad never happens".** A new feature-level `reachabilityGoals[]` entity, the complement to `featureInvariants` (safety). Each goal has a `kind`: `reachable` (some reachable state satisfies the condition - catches a target the product can never actually get to, like an order status no action sequence reaches) or `always_reachable` (from EVERY reachable state the target stays reachable - catches a flow that can get permanently stuck short of completion, the classic liveness trap). The bounded model checker evaluates goals over the reachable state space and returns, for an `always_reachable` failure, the shortest action path to the trap state. Surfaced in `model_check`, folded into `verify` / `unspa check` as a `liveness` check (a warning by default - bounded, like dead-action findings - escalating to a hard failure with `--fail-on-unmet-goals` / `failOnUnmetGoals`). Authorable via `add_reachability_goal` / `update_reachability_goal` / `remove_reachability_goal` and the matching `apply_batch` ops; validated like a feature invariant (declared condition paths, no param scope). Pure-domain `analyzeSurfaceReachability` and the goal evaluation live in the simulator's `StateExplorer`; persistence is a free round-trip through the snapshot.

- **`unspa check` - headless verification gate.** A non-interactive command that runs the whole verification spine over a project and **exits non-zero on failure**, so the spec can finally break a build instead of staying advisory in a chat window. Per feature it runs every scenario as an executable spec test, scores maturity, analyses surface (navigation) reachability, optionally model-checks the reachable state space (`--model-check`), and folds in spec→code drift. Each check is `pass` / `warn` / `fail`; the run fails only on genuine failures (a failing scenario, a reachable invariant violation, or - when explicitly gated via `--min-maturity` / `--fail-on-drift` / `--require-scenarios` / `--fail-on-dead-actions` - those). Human output by default, `--json` for CI dashboards; scopes to the repo's linked project, or narrow with `--project` / a positional `featureId`. Built as a new `verification` **bounded context** (pure `detectDrift` + `aggregateVerdict` domain, a `VerifyFeatures` use case over a `BehavioralIndexReader` port, file + static adapters); the CLI command and the two new MCP tools are thin driving adapters over the same use case, so chat and CI verify identically.

- **`verify` + `get_drift` MCP tools.** `verify` is the in-chat form of `unspa check` - one gated `pass`/`warn`/`fail` verdict per feature, with optional bounded model checking. `get_drift` makes spec→code drift detection executable: it compares each `.unspa.json` entry's recorded `specVersion` against the owning feature's current `updatedAt` and returns `stale` (re-audit - the spec changed under the code), `unversioned` (audited but never stamped), and `orphans` (index keys that no longer resolve to any spec entity). Previously this comparison was documented but left for the agent to do by hand.

- **Navigation reachability in the model checker.** A new pure static analysis (`analyzeSurfaceReachability`) over the surface-transition graph (declared transitions + `transition_surface` effects) finds surfaces the user can never navigate to (`unreachableSurfaces`) and surfaces with no way out (`terminalSurfaces`). Surfaced in `model_check` next to the state-space results and folded into `verify` / `unspa check` as an advisory check.

- **Global search in the header.** A search bar in the dashboard header (focus it or press **⌘K / Ctrl+K**) that indexes the *entire* model - projects, domains, features, surfaces, actions, parameters, rules, effects, invariants, state definitions, transitions, personas, resources, entities (and nested fields), events, value sets, and scenarios - and opens a big, grouped results menu. Tag text is folded into its project/feature so a tag query still finds its carrier. Results are ranked (exact › prefix › word-prefix › substring, weighted by kind), grouped by type, and keyboard-navigable (↑/↓/Enter); selecting one **deep-links to the exact element**, expands it (an action's card opens so you see the searched item itself, not a collapsed header), and pulses it for ~3s (reusing the feature editor's `?surface=&panel=&focus=` contract + focus observer, now honoring a one-shot `focus` URL param). Built as a hexagonal feature slice (`global-search`): a pure, unit-tested index builder + scorer, an application use case over the repository ports, and a presentation store behind a driven `SearchHost` port. The index builds lazily on first open, is cached, and rebuilds on model-change sync events. Builder mode keeps its own local filter.

### Changed

- **Wider test coverage and a lint gate in CI.** Added end-to-end MCP-tool tests (the implement-next queue, the read/query wrappers, and entity add→update→remove round-trips) driven through the real MCP client, and an **ESLint (flat config) + Prettier** setup wired into CI and `prepublishOnly`. Lint runs alongside the existing cross-OS type-check + test + build matrix, so unused code, unsafe casts, and Svelte template mistakes now fail the build too. No runtime behavior change.

### Fixed

- **A rule-blocked action no longer false-fails its own post-condition invariant.** Action-level invariants are post-conditions of the action *completing*; when a rule blocks the action, no effects run, so the simulator now skips them (feature + surface invariants - state predicates that must hold in every reachable state - still apply). Before, an action invariant like "Confirm delivery → `order.status == delivered`" was evaluated even when a precondition rule blocked the action from a state where it shouldn't fire, so `model_check` reported a reachable "violation" for a guard working exactly as intended. Mirrors the scenario runner already skipping assertions on a blocked action. Surfaced by running the new model checker against the bundled eShop sample, whose **Order fulfillment** feature now verifies clean.

## [0.3.0] - 2026-06-18

Two additive surfaces - an interactive **behavior graph** and an opt-in **Lyriks** dashboard skin - plus a round of Builder-view scaling and two robustness fixes. Non-breaking: the default look and every existing view are unchanged, and the new theme/graph are opt-in.

### Added

- **Behavior graph view.** Renders a feature - or a whole project's features - as an interactive node/edge map of the executable model: surfaces, actions, state, events, parameters, rules, effects, invariants, scenarios, personas, resources, and entities, wired by `contains` / `reads` / `writes` / `emits` / `transitions` / `asserts` / `uses` / `handles` edges. A pure `BehaviorGraphModel` builds the graph from the domain (unit-tested); presentation is split into a `vis-network` renderer adapter and a thin Svelte view. Reachable from a **Graph** link in the feature header and the project editor at `/features/<id>/graph` and `/projects/<id>/graph`; the project graph live-refreshes on sync events.

- **Lyriks community-edition theme + `unspa theme` CLI.** A purely cosmetic skin that overrides the design-system color tokens (and the header/shell chrome) without adding, removing, or moving any feature - every surface and control is identical between themes. Ships the opt-in `lyriks` violet skin alongside the default. Pick it with `unspa theme set <id>` / `reset` / `list` (persisted in `<snapshots>/theme.json`), `unspa init --theme`, or `unspa dashboard --theme`; the dashboard header also has a live palette switcher (persists to `localStorage`). Server-rendered with a no-flash bootstrap, and unknown ids fall back to the default rather than blanking the UI.

### Changed

- **Builder view scales to a full hub.** Project cards now load **progressively** - the cheap project list first, then each scored card streamed in as it resolves (with skeleton placeholders), and a deep-linked `?project=` open loads only that project until you return to the all-projects view. Features list under their **surface** heading. Sync events do a **scoped** rebuild of just the affected project's card (mirroring the Expert view) instead of blanking the dashboard, and the activity toast's **View** button deep-links into the active Builder card, falling back to the Expert route. Tag chips on cards gain an opt-in collapsible mode to reclaim space.

### Fixed

- **A malformed assertion no longer crashes a scenario run.** Untyped scenario data could deserialize an assertion with no state path; evaluating it threw and took down the whole feature's run. A missing/empty path is now reported as not-held, so one bad assertion fails only its own scenario.

- **MCP live-refresh works with zero config in dev too.** With no `UNSPA_SYNC_URL`, the sync notifier now probes the production dashboard port and both loopback families of the Vite dev port (Node 20+ resolves `localhost` to `::1` first on Windows), sticking to the first that answers - so both `unspa dashboard` and `npm run dev` get live refresh and activity toasts without configuring anything.

## [0.2.0] - 2026-05-31

Adds an opt-in **Builder** view alongside the Expert dashboard, with a per-project build queue and per-item goals. Additive and non-breaking: the default dashboard is unchanged (Expert only, no view switcher) and every new MCP field/tool is optional.

### Added

- **Builder view - an opt-in, simpler dashboard.** A second view over the same model: browse projects → core features → features with Maturity / Built dials, accept Evolution-driven suggestions inline, add/edit/delete tags (renames propagate everywhere via the shared `RenameTag` use case), and fill a per-project build queue. Off by default - enable with `unspa init --with builder` (or the init prompt), `unspa view add builder`, or one-off with `unspa dashboard --view builder`. A view registry renders the **Expert | Builder** switcher only when more than one view is on, and `/builder-mode` redirects to Expert when the view is off. Enabled views persist next to the model in `<snapshots>/views.json`. New CLI command group: `unspa view list|add|remove`.

- **Build-queue goals.** Each queued item can carry its own optional goals - a **Maturity** target, an **Implementation (Built)** target (each a drag-to-set progress bar that starts at the item's current score and is tone-colored by value), and/or a **"report it exists in code"** flag. Surfaced to the assistant over MCP: `enqueue` accepts an optional `target`, the new `set_queue_target` tool sets or clears it, and `list_queue` / `get_next_queued` return a plain-language `goal` line. The `unspa-implement` skill now honors a queued item's goals and always records at least presence in `.unspa.json`.

- **Evolutions - LLM-proposed improvements as dashed placeholders.** After building a feature or action, the assistant can now raise forward-looking suggestions (e.g. "Sign in with SSO - most competitors offer it", "rate-limit failed logins") via the new `propose_evolution` MCP tool. An Evolution is a real Action carrying an `evolution: { rationale, category?, source? }` marker and an empty body: it has an id, renders in the dashboard with a dashed violet border + its rationale, and can be added to the implementation queue like any action - but it is **excluded from maturity scoring and `get_spec_gaps`** until accepted, so proposing never lowers the score or generates "does nothing" noise. Accept one with `update_action evolution:null` (clears the marker, promotes it to committed behavior) or dismiss it with `remove_action`. `add_action` (granular + `apply_batch`) also accepts an `evolution` field. The `unspa-edit` skill now instructs the assistant to surface 1–3 high-signal evolutions each build pass.

### Fixed

- **Setting a description (or any field) no longer requires the whole feature to already be valid.** Every MCP write re-validated the entire feature structurally and blocked on *any* error - so a single missing description elsewhere made it impossible to set a description on a feature/action ("impossible without validating the whole feature"). Structural validation is now **diff-aware**, matching the reference-integrity check that already worked this way: a write is blocked only when it *introduces* a new error, never by a pre-existing one. Pre-existing issues stay editable and remain visible via `get_spec_gaps` / `score_feature`. Applied uniformly across all write paths - granular tools (`MutateFeature`), `apply_batch`, and `save_feature` (both the MCP tool and the dashboard's full-replace use case). A brand-new feature with no prior snapshot must still be fully valid; newly-introduced mistakes (bad enum default, duplicate id, new dangling reference) are still rejected.

### Changed

- **The shared hub is now the zero-config default for `unspa init`.** Snapshot discovery (used by both the MCP server and `unspa dashboard`) now falls back to `~/.unspa-hub/unspa` instead of an empty `<cwd>/unspa`, so a bare `init` writes a clean MCP entry with no `UNSPA_SNAPSHOTS` and the dashboard/MCP agree on the first run - no more configuring an env var to make them line up. Cross-platform via `os.homedir()`. Discovery order is otherwise unchanged: explicit override → per-repo `unspa/` found by walk-up → hub. Claude Desktop now resolves the hub automatically (it previously needed `--hub`). Per-repo storage is **not removed** - it's demoted to opt-in: `unspa init --local` (model travels with the repo in git), `unspa init --hub <path>` (custom hub, pins `UNSPA_SNAPSHOTS`), or `unspa init --custom` (interactive picker). New `unspa dashboard --snapshots <dir>` points the UI at any folder for a one-off. Re-run `init` anytime to repoint.

## [0.1.8] - 2026-05-29

Two additive modeling features plus one repository fix. Safe to upgrade in place.

### Added

- **Multi-step scenarios (`Scenario.steps[]`).** A scenario can now carry an ordered list of preceding action invocations, replayed through the simulator before the action under test. Turns a single-action preset into an arrange→act→assert flow, so `run_all_scenarios` verifies cross-action paths (add to cart → apply coupon → checkout). Each step takes its own `parameterOverrides` plus optional `expectedStatus` and `expectedAssertions`; a step that blocks unexpectedly fails the scenario. Backward compatible - scenarios without `steps` behave as before. Authorable via `add_scenario` / `update_scenario` and `apply_batch`.

- **Named value sets (`feature.valueSets[]`).** A reusable enum declared once at the feature level. A StateDefinition or Parameter of type `enum` references it via `valueSetId` instead of inlining `enumValues`, so allowed values live in one place - no more "edit the enum in two places" drift between a state path and the parameters that feed it. Inline `enumValues` still work; no migration. New tools `add_value_set` / `update_value_set` / `remove_value_set` plus matching `apply_batch` ops; values resolve at read time in the validator, the TypeScript codegen, and the simulator.

### Fixed

- **`list()` no longer breaks on shells with a missing `updatedAt`.** All six repositories (Feature/Project/Domain × JsonFolder/InMemory) sorted with an unguarded `b.updatedAt.localeCompare(a.updatedAt)`. `null` threw a `TypeError`; `undefined` silently floated the shell to the top. The bug surfaces via any MCP tool that resolves a short id (`score_feature`, `get_feature`, `apply_batch`, …) because they all call `repo.list()` first. Both sides of the comparator now coalesce to `''`, so shells with no timestamp sink to the bottom.

## [0.1.7] - 2026-05-27

Cosmetic re-release of 0.1.6. The npm tarball is functionally identical - **0.1.6 users do not need to upgrade.** The bump exists so the `v0.1.7` git tag points at a green CI run.

### Fixed

- **Repo tracks the `.claude/skills/` copies of the two opt-in narrative skills.** A stale `.git/info/exclude` on the maintainer's machine was hiding `.claude/skills/unspa-worldbuild/SKILL.md` and `.claude/skills/unspa-worldplay/SKILL.md` locally, so they were never committed. The vitest `cli/skills/skills-sync.test.ts` enforces byte-identity between `cli/skills/` (canonical, ships via npm) and `.claude/skills/` (used when working on this repo), and a fresh CI clone was failing on the missing files. The published 0.1.6 npm tarball was always fine - `.claude/` is not in `package.json` `files`, so the package never carried those copies.

## [0.1.6] - 2026-05-27

Adds an experimental Vitest spec generator that closes the spec-vs-code loop - every authored scenario becomes a real unit test driven through a user-written adapter. Plus a small UX pass on tag filtering and the Projects index, and a README restructure for non-tech readability. All changes additive - no schema migration, safe to upgrade in place.

### Added

- **`unspa scenarios export <featureId>` (experimental).** Generates a Vitest spec from a feature's authored scenarios. The deterministic simulator runs each scenario at codegen time and embeds its predicted outcome (status + expected assertions) as the test oracle. The user writes a thin adapter - `UnspaAdapter` from `unspaghettit/cli/scenarios` - that calls their real implementation; the generated test drives every scenario through that adapter and asserts state path-by-path. Drift between authored `expectedStatus` and simulator prediction is reported per scenario but not gated (the generator emits tests as authored; the human picks which oracle wins). Default output is `./<feature-slug>.scenarios.spec.ts`; flags: `--out`, `--adapter`, `--adapter-export`, `--dry-run`, `--force`. Refuses to clobber an existing file without `--force`. Adapter contract (`UnspaAdapter`, `AdapterInvocation`, `AdapterResult`) is preview and may change between minor versions until the wedge graduates; every emitted file carries that banner in its header.

### Changed

- **Tag filter shows per-type color inside the dropdown.** Each `<optgroup>` gets a background-color tint at 28% of the type's color (a clear colored band on the type header) and each `<option>` beneath gets a lighter 12% wash. Text stays at default; the color reminder reads as a row-background swimlane that doesn't recolor labels. Replaces the inline `TagPillBar` chip row that used to render above the Projects, Features-in-Project, and global Features list views - the selector now carries the color signal alone.
- **Import .unspa button repositioned** to the top of the Projects index header, paired with the "Home" eyebrow. Mirrors the Export .unspa position on a project page and drops the heavier `h-10` styling for the same compact look used by Export.

### Documentation

- **README restructured for audience clarity.** Non-tech one-line hook ("a way to keep AI-assisted software aligned with what you actually meant"), MCP defined on first use with a link, "Who it's for" anchor, Quickstart vs Installation properly differentiated (no duplicate `npm install -g` block), Scenarios callout clarifies spec self-test (`run_all_scenarios`) vs code-vs-spec test (`unspa scenarios export`), Architecture section gains a runtime data-flow diagram before the folder tree, Status + Why-open-source merged into a single "Where this came from", Philosophy tightened from seven mixed-register lines to four consistent principles. Logo URL switched from the npm/jsDelivr CDN to `raw.githubusercontent` so it survives any future change to the npm `files` list.

### Migration

- None. The new CLI command is purely additive. The TagPillBar removal is internal - users who relied on the colored chip row above tag lists now see the same color information in the filter dropdown.

## [0.1.5] - 2026-05-25

Closes every silent-failure path on the report/sync side that 0.1.4 users hit, plus an interactive guided tutorial, project-level history, broader rule expressivity, and a UI / encoding pass. All changes additive - no schema migration, safe to upgrade in place.

### Added

- **Interactive guided tour from project to simulator.** New "Run interactive tutorial" button on the Tutorial page launches a 20-step spotlight tour that walks Project → Feature → Surface → Action → Parameter → Rule → Simulator, prefilling fields and gating each step on the right element being typed or clicked. Implemented as a hexagonal slice (TourStep / TourDefinition / SubmitGuard domain, SpecEventBus port, SharedSpecEventBusAdapter adapter, TourOverlay / TourPanel / TourSpotlight presentation). Required a handful of tour-supporting behavior on existing editors so prefilled content lands in genuinely-blank inputs: empty defaults on new editor rows, ParametersEditor auto-focus on new-row name input, and boolean param auto-seed to `false` so a default "No" registers as a value the validator can read.

- **Read-only project history tab.** The Y.Doc room serving each project already maintained a shared history log, but nothing on the client subscribed. The project page now renders that stream - same visual language as the feature-level HistoryPanel, intentionally stripped of `jumpTo` / `Clear` so a stray click can't time-travel a project out from under its features. Author chips reuse the AI / sys / user palette and surface `actingFor` for MCP-driven edits.

- **Parameters on the left of a rule condition.** `LeafRuleCondition.left` now accepts either a state path or `{ kind: 'param', name }`, so an action rule can branch on its own parameter without an intermediate state write. Threaded through Expression evaluation, FeatureValidator (param-left is action-rule only; rejected on surface rules + feature invariants because they have no parameter scope), MaturityScorer, the `get_action` MCP tool, and the RuleEditor / InvariantEditor UIs (State / Param toggle on the IF row).

- **Labeled MAT / IMPL chips on feature cards.** Replaces the single unlabeled "%" badge with two small stacked chips: `MAT 75%` (color-tiered emerald / amber / red against the maturity scorer) and `IMPL 50%` (same tier scheme when a `.unspa.json` report exists; muted grey "-" with explanatory tooltip when there's nothing taggable yet). Per-feature implementation status fetched lazily so each card updates in place once its report lands.

- **Cross-feature dedupe in project-level tabs.** When the same logical item lives in several features inside one project (a `users` table read by two flows, a `cart.cleared` event emitted from two features, …), the resources / entities / events / transitions tabs previously rendered one row per (feature, item) pair and the tab counter summed across - giving inflated numbers and visually duplicate rows. A new `crossFeatureGroups` service groups by identity (kind|provider|name for resources, namespace for entities, event name, from|to|label for transitions); each panel renders one row per unique item with a "From features" chip column.

- **Library chooser step on add-surface dialog.** Blank-surface creation used to live behind a `<details>` collapsible at the bottom of the template library - invisible unless you knew to look for it. The dialog now opens on a two-button chooser ("Create new" vs "From template"), each route leading to a focused step with a back arrow.

- **Easter eggs.** Type "spaghetti" or punch in the Konami code anywhere outside an input - a noodle drifts across the dashboard.

### Fixed

- **`sync_from_index` now surfaces orphan keys instead of silently skipping them.** Response carries an `orphans: { total, entries: [{ key, hint }] }` block listing every `.unspa.json` key that does not correspond to a spec entity. Each entry includes a targeted hint - slug-shaped ids on id-keyed types (e.g. `action:add-to-cart`) get "use 8-char hex from `get_behavioral_index`"; malformed keys (no `:` separator) get the parse error; the generic case explains the likely causes. `ok` is `false` when orphans are present, OR when `synced === 0` (100% failure to land anything is overwhelmingly misconfiguration, not a successful no-op) - neither situation can pass as success silently.

- **`report_implementation_status` / `_batch` returns `rejectedEntities` for unmatched ids.** Pre-0.1.5, when a `foundEntities[]` entry's `entityId` didn't match any spec entity (wrong format, removed entity, typo), the entry was silently bucketed into `extraTags`. The caller saw `foundCount: 0` with no diagnostic. Now each ack carries `rejectedEntities: [{ entityType, entityId, reason }]` (single-call) or `rejected[]` + `rejectedCount` (batch ack), each with an actionable per-entry reason. `ok: false` is returned whenever rejections are present. `extraTags` is now reserved for caller-supplied tags only.

- **`report_implementation_status` accepts state PATH or hex ID interchangeably.** Pre-0.1.5 state entities had to be reported by their hex id, but `get_implementation_gaps` and the `.unspa.json` index keyed them by path (e.g. `state:cart.itemCount`) - so the natural value the LLM had wasn't accepted, with no error. Now `entityType: "state"` matches on either form. Event entities continue to match on their literal name string (unchanged).

- **Documented behavioral-index key format matches the implementation.** The `CLAUDE.md` / `AGENTS.md` template (`cli/util/context-files.ts`) and both bundled skills (`unspa-implement`, `unspa-audit`) previously documented `action:<slug>` and `invariant:<slug>` - formats the spec never actually mints. They now correctly show `action:<id>` etc. with the 8-char hex contract spelled out and `get_behavioral_index` flagged as the way to look ids up. Existing 0.1.4 users will see the corrected docs the next time they run `unspa init`.

- **Tag chip close icon.** The remove button rendered a literal `Ã-` - UTF-8 bytes for `×` reinterpreted as CP1252 by a Windows editor pass. Swapped for an inline SVG so the glyph is encoding-proof, with `shrink-0` so the icon stops jumping when chips wrap.

- **Restored `cursor: pointer` on interactive elements.** Tailwind v4 Preflight changed the base cursor on `<button>`, `<select>`, `[role=button]` to `default`, making every clickable control feel like plain text. Restored in `@layer base` with a `:not(:disabled)` guard so existing `disabled:cursor-not-allowed` opt-ins keep winning.

- **Sync breadcrumb separator escape.** `formatChangeLabel` previously joined the breadcrumb path with literal `›` bytes that an editor round-trip had mangled to UTF-8-as-CP1252 (`â€º`). Every change since carried the corrupt bytes straight into the persisted Y.Doc history log. Runtime separator now uses the Unicode escape `'›'` so the source file stays ASCII-safe; SyncToast renders `&rsaquo;` for the same reason. Older entries on disk stay corrupt (history is immutable) but everything written from here is clean.

- **MCP server `version` no longer hardcoded.** `mcp-server/server.ts` advertised `0.1.2` in capability negotiation long after the package shipped 0.1.5. Now reads from `package.json` at module load.

### Improved

- **`get_implementation_gaps` exposes the canonical `entityId` per entry** (8-char hex id for state entities, alongside the existing path-shaped `key`). Removes the need for `get_feature(verbose:true)` just to look up a state id.
- **`get_implementation_gaps` returns a `hints[]` block** pointing at follow-up tools when the response calls for them: `get_neighborhood` for batching co-located implementation work; the path-or-id rule for state-entity reporting. Improves discoverability without forcing the LLM to read the full guide.

### Changed

- **Positioning reframed** as "Executable specifications for AI-assisted software development" across the tagline, meta tags, READMEs, tutorial prose, and contributor docs. Same product, sharper words.
- **MCP tool descriptions normalized to ASCII** - em-dashes and curly quotes → ASCII (`-`, `.`, `n/a`). LLM clients render tool descriptions as plain text, and encoding round-trips on the agent side were producing mojibake.
- **Feature card footer** says "X actions" instead of "X capabilities" to match the renamed model.
- **Repo encoding hygiene.** BOM-stripped CLI / docs / skills; mojibake stand-ins replaced with proper UTF-8 (`×`, `↔`, `§`, `›`); `.gitattributes` enforces LF on commit so Windows editor round-trips can't reintroduce CRLF + BOM drift. Most critical fix: `cli/util/context-files.ts` - the `unspa init` template that lands in every user's `CLAUDE.md` / `AGENTS.md` - carried a corrupt `~10Ã- larger` that was about to ship to every new user.

### Infrastructure

- **`scripts/sync-skills.cjs`.** `cli/skills/` is canonical - it's what `unspa init` ships into each user's repo. The same three skills also live under `.claude/skills/` so they apply when working on this repo. They drifted once already. The new script mirrors src → dest; `--check` mode fails byte-identical asserts on drift. Wired into `npm test` and `prepublishOnly` so a one-sided edit can never reach npm.

### Dependencies

- `@sveltejs/kit` → 2.61.0, `vite` → 8.0.14, `ws` → 8.21.0. CI `actions/checkout` → v6, `actions/setup-node` → v6.

### Migration

- None. 0.1.4 `.unspa.json` files with correct (hex) keys keep working unchanged. Files written against the old (incorrect) docs with slug-shaped keys now surface in `sync_from_index`'s `orphans` block with hints for fixing them. Code paths that read `extraTags` continue to work (the field is now narrower - caller-supplied only - but never grew unbounded with rejected entries in the first place).

## [0.1.0] - 2026-05-20

Initial public release. Early but functional.

### Highlights

- **Structured behavioral runtime.** Domain → Project → Feature → Surface → Action, with states, rules, invariants, transitions, effects, events, entities, resources, personas, and scenarios. Every shape validated on every write.
- **MCP-native tool surface.** Locked at v0.1: ~100 tools across read, granular write, atomic batch (`apply_batch`), simulation (`dry_run_simulate`, `run_all_scenarios`), diagnostics (`score_feature`, `get_spec_gaps`, `get_implementation_gaps`), and code-side audit (`get_behavioral_index`, `sync_from_index`, `report_implementation_status`).
- **Deterministic simulator with executable scenarios.** Every scenario is an assertion with pass/fail per `expectedAssertions[]`. Cascade event handlers, persona overrides, surface invariants in result.
- **Index-only code↔spec mapping.** `.unspa.json` is the single source of truth for where each entity lives in code. No source-code tag annotations.
- **Typed scaffolding.** `generate_types` emits TypeScript types for state shapes, event names, and action parameter types. Drift surfaces at the TypeScript level the moment the spec changes.
- **Local-first.** Everything in your repo. No telemetry, no hosted servers, no cloud dependency. Snapshots are plain JSON.
- **Multi-agent ready.** Bundled Yjs WebSocket server lets multiple humans and/or LLMs edit the same runtime in real time.
- **SvelteKit dashboard.** Browse the model, run the simulator, inspect maturity + coverage. `unspa dashboard` boots it locally.

### CLI

`unspa init` registers the MCP server with Claude Code, Cursor, Gemini, Windsurf, Kiro, and Codex (manual snippet). Scaffolds `unspa/`, seeds `CLAUDE.md`/`AGENTS.md` with the runtime instructions, installs the bundled `unspa-edit` / `unspa-implement` / `unspa-audit` skills. Idempotent.

`unspa serve` runs the bundled MCP server on stdio.

`unspa dashboard` opens the SvelteKit dashboard at http://localhost:3000.

### Sample project

The Load samples button delivers an end-to-end **eShop** project (4 LLM-sized features: Account & auth, Catalog & reviews, Cart & checkout, Order fulfillment). Every feature scores 100% maturity. Designed to exercise the full capability surface - composite + Expression conditions, feature invariants, event cascade, `bypassInvariants`, action invariants, scenarios, persona overrides, entity/resource mapping.

### Known limitations

- The public contract - MCP tool surface, `.unspa.json` index format, snapshot JSON schema, dashboard REST API, CLI flags, and generated TypeScript types - is at v0.1. Breaking changes to any of these are signalled by a bump to `0.2.0`, so `"unspaghettit": "^0.1.x"` is safe to auto-upgrade.
