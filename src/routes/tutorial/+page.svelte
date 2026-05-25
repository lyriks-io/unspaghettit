<script lang="ts">
  import TutorialSection from "$features/tutorial/presentation/components/TutorialSection.svelte";
  import CodeBlock from "$features/tutorial/presentation/components/CodeBlock.svelte";
  import Callout from "$features/tutorial/presentation/components/Callout.svelte";
  import { goto } from "$app/navigation";
  import { featuresStore } from "$features/behavior-model/presentation/stores/featuresStore.svelte";
  import {
    alertDialog,
    chooseDialog,
  } from "$shared/presentation/dialogs/dialogStore.svelte";
  import { formatSampleSummary } from "$features/behavior-model/presentation/loadSamplesMessage";
  import { tourStore } from "$features/tutorial/presentation/stores/tourStore.svelte";
  import { firstFeatureTour } from "$features/tutorial/infrastructure/tours/firstFeatureTour";

  function startInteractiveTour(): void {
    tourStore.start(firstFeatureTour);
  }

  const sections = [
    { id: "why", title: "1. Why executable specs" },
    { id: "model", title: "2. The core model" },
    { id: "concepts", title: "3. Concept by concept" },
    { id: "walkthrough", title: "4. Walkthrough: eShop project" },
    { id: "simulator", title: "5. Running the simulator" },
    { id: "maturity", title: "6. Reading the maturity score" },
    { id: "editor", title: "7. Editing in the app" },
    { id: "build", title: "8. Build your own feature" },
    { id: "queue", title: "9. Implementation queue" },
    { id: "backup", title: "10. Backup & share with .unspa" },
    { id: "mcp", title: "11. Connect AI agents with MCP" },
    { id: "collab", title: "12. Multi-user & identity" },
    { id: "security", title: "13. Hosting on a network" },
    { id: "next", title: "14. Where to go next" },
  ];

  let busyLoadingSamples = $state(false);

  async function ensureSamples() {
    if (busyLoadingSamples) return;
    busyLoadingSamples = true;
    try {
      const result = await featuresStore.loadSamples();
      const addedAny =
        result.addedProjects.length + result.addedFeatures.length > 0;
      const skippedAny =
        result.skippedProjects.length + result.skippedFeatures.length > 0;
      if (!addedAny && !skippedAny) {
        await alertDialog({
          title: "Nothing to load",
          message: "No samples are bundled in this build.",
          tone: "warning",
        });
      } else if (!addedAny) {
        await alertDialog({
          title: "Already available",
          message:
            formatSampleSummary(result, "skipped") +
            "\n\nDelete them and load again to restore from the sample.",
          tone: "info",
        });
      } else {
        if (result.addedProjects.length > 0) {
          const projectCount = result.addedProjects.length;
          const featureCount = result.addedFeatures.length;
          const projectNoun = projectCount === 1 ? "project" : "projects";
          const featureNoun = featureCount === 1 ? "feature" : "features";
          const summary =
            featureCount > 0
              ? `Added ${projectCount} ${projectNoun} and ${featureCount} ${featureNoun}.`
              : `Added ${projectCount} ${projectNoun}.`;
          const featureLine = result.addedFeatures
            .map((f) => f.name)
            .join(" · ");
          const chosenId = await chooseDialog({
            title: "Samples loaded",
            message: summary,
            options: result.addedProjects.map((p) => ({
              id: p.id,
              label: `Open ${p.name}`,
              description: featureLine || undefined,
            })),
            cancelLabel: "Close",
            tone: "success",
          });
          if (chosenId) {
            await goto(`/projects/${chosenId}`);
          }
        } else {
          await alertDialog({
            title: "Samples loaded",
            message:
              formatSampleSummary(result, "added") +
              (skippedAny
                ? `\n\nAlready present:\n${formatSampleSummary(result, "skipped")}`
                : ""),
            tone: "success",
          });
        }
      }
    } finally {
      busyLoadingSamples = false;
    }
  }
</script>

<div class="mx-auto grid max-w-7xl grid-cols-12 gap-8 px-4 py-8 sm:px-6">
  <aside class="col-span-12 lg:col-span-3">
    <nav
      class="sticky top-24 space-y-1 rounded-lg border border-hairline bg-white p-3 text-sm"
    >
      <p
        class="px-2 pb-2 text-xs font-medium uppercase tracking-wide text-slate-500"
      >
        Tutorial
      </p>
      {#each sections as s}
        <a
          href={`#${s.id}`}
          class="block rounded-md px-2 py-1.5 text-slate-700 hover:bg-slate-50 hover:text-slate-950"
        >
          {s.title}
        </a>
      {/each}
      <div class="mt-4 space-y-2 border-t border-hairline pt-4">
        <button
          type="button"
          class="sample-cta relative w-full overflow-hidden rounded-md px-3 py-2 text-xs font-medium text-white shadow-sm shadow-slate-950/10 transition disabled:cursor-wait disabled:opacity-70"
          onclick={ensureSamples}
          disabled={busyLoadingSamples}
        >
          <span class="relative z-10">
            {busyLoadingSamples ? "Loading..." : "Load sample project"}
          </span>
        </button>
        <button
          type="button"
          class="w-full rounded-md border border-brand-300 bg-brand-50 px-3 py-2 text-xs font-semibold text-brand-800 transition hover:bg-brand-100"
          onclick={startInteractiveTour}
          title="Side panel walks you through creating your first feature"
        >
          &rarr; Run interactive tutorial
        </button>
        <a
          href="/features"
          class="block w-full rounded-md bg-slate-900 px-3 py-2 text-center text-xs font-medium text-white"
        >
          Back to features
        </a>
      </div>
    </nav>
  </aside>

  <article class="col-span-12 space-y-12 lg:col-span-9">
    <header class="border-b border-slate-200 pb-8">
      <div class="max-w-3xl">
        <p class="text-xs font-semibold uppercase tracking-wide text-brand-700">
          Tutorial
        </p>
        <h1 class="mt-2 text-4xl font-semibold tracking-tight text-slate-950">
          Modeling software as executable behavior
        </h1>
        <p class="mt-3 text-base leading-7 text-slate-600">
          Unspaghettit is a tool for describing what software <em>does</em>, not
          what it
          <em>looks like</em>. This guide walks you through the model, the
          simulator, the maturity score, the manual editor, and the MCP server.
        </p>
        <p class="mt-2 text-xs text-slate-500">
          An open-source project by
          <a
            href="https://lyriks.io"
            class="text-brand-700 hover:underline"
            rel="noopener">Lyriks.io</a
          >.
        </p>
      </div>
      <div class="mt-6">
        <Callout tone="info" title="Tip">
          Click <span class="mono">Load sample project</span> on the left to make
          sure the seeded eShop example is available.
        </Callout>
      </div>
    </header>

    <TutorialSection id="why" title="1. Why executable specs">
      {#snippet children()}
        <p>
          AI coding workflows go sideways fast. Specs drift. Prompts pile up.
          Generated systems lose coherence. The reason is almost always the
          same: humans and LLMs share
          <strong>prose</strong>, markdown specs, giant prompts, chat history,
          scattered README fragments, and prose has no runtime. Nothing executes
          it, nothing validates it, nothing breaks loudly when it goes stale.
        </p>
        <p>
          Unspaghettit turns that prose into an <strong
            >executable specification</strong
          >. The specification describes observable behavior: anything a user,
          system, or AI can do is an
          <em>action</em>; anything true right now is <em>state</em>; anything
          that gates an action is a <em>rule</em>; anything that follows from
          running an action is an <em>effect</em> or an <em>event</em>.
        </p>
        <p>
          A few names appear throughout the app:
          <strong>Unspaghettit</strong> is the product,
          <strong>behavior</strong> is what you model,
          <strong>spec</strong> is the executable contract,
          <strong>MCP</strong> is how your AI agent reads and edits it.
        </p>
        <p>
          The vocabulary is small enough to hold in head and rigid enough to
          execute. Specs stop being documentation you re-explain in every
          prompt; they become a contract you can simulate, score, and break
          loudly.
        </p>
      {/snippet}
    </TutorialSection>

    <TutorialSection id="model" title="2. The core model">
      {#snippet children()}
        <p>The hierarchy fits on one line:</p>
        <CodeBlock
          language="text"
          code={`Domain → Project → Feature → Surface → Action → State / Rule / Effect`}
        />
        <p>
          A <strong>Project</strong> is the umbrella for one product or
          codebase. It groups many
          <strong>Features</strong>. A Feature is one coherent slice of behavior
          (a flow, a screen, a capability) sized so an LLM can hold the whole
          thing in head: ~1–15 surfaces, ~30–100 actions. A Feature is
          <em>not</em> a whole product. Inside a Feature, the rest of the vocabulary
          lives here:
        </p>
        <CodeBlock
          language="text"
          code={`Feature
|-- Resource                  (external or local system/data boundary)
|-- Entity                    (domain schema mapped to state/resource fields)
|-- Event                     (registered signal + optional payload schema)
+-- Surface
    |-- StateDefinition       (typed dynamic state, optionally shared)
    |-- Action
    |   |-- Parameter         (input, default, validations, state binding)
    |   |-- RequiredState     (state the action depends on)
    |   |-- Rule              (condition -> effect)
    |   |-- Effect            (success outcome)
    |   |-- OnBlockedEffect   (fallback when blocked)
    |   |-- Invariant         (must hold post-run)
    |   |-- EmittedEvent      (declared signal)
    |   +-- Scenario          (simulator example + expected result)
    |-- Rule                  (cross-cutting surface gate)
    |-- Invariant             (cross-cutting check)
    +-- Transition            (declared link to another surface)`}
        />
        <p>
          That is the whole behavior graph. The manual editor and MCP tools both
          read and write these same entities.
        </p>
      {/snippet}
    </TutorialSection>

    <TutorialSection id="concepts" title="3. Concept by concept">
      {#snippet children()}
        <h3 class="font-semibold text-neutral-900">Feature</h3>
        <p>
          One coherent slice of behavior inside a Project. A flow, a screen, a
          capability. Sized so an LLM can hold the whole thing in head: roughly
          1–15 surfaces and 30–100 actions. A Feature is <em>not</em> a whole product.
          "Add filter to search results" is one Feature; "Spotify clone" is a Project
          that holds many Features. A Feature contains surfaces plus global resources,
          entity definitions, registered events, personas, and implementation context.
        </p>

        <h3 class="font-semibold text-neutral-900">Resources and Entities</h3>
        <p>
          Resources document the systems your behavior touches: databases, HTTP
          APIs, object storage, queues, browser storage, caches, or local files.
          Entity definitions describe domain objects and map fields back to
          state paths or resources. These are editable from the top-level <strong
            >Resources</strong
          >
          and <strong>Entities</strong> tabs. Example: the eShop sample has a
          <span class="mono">Cart store</span>
          resource and a <span class="mono">Cart</span> entity with
          <span class="mono">lineItems</span> and
          <span class="mono">subtotal</span> fields.
        </p>

        <h3 class="font-semibold text-neutral-900">Surface</h3>
        <p>
          A surface is the only fundamental container. It can represent a
          screen, a canvas, a terminal, a board, a workflow, a command palette,
          a map, a dialog area, an API playground, or anything else. Surfaces
          hold state and actions and link to other surfaces via transitions.
          Example: <span class="mono">Cart &amp; checkout</span> contains the
          <span class="mono">Cart</span>,
          <span class="mono">Address book</span>, and
          <span class="mono">Checkout</span> surfaces.
        </p>

        <h3 class="font-semibold text-neutral-900">Action</h3>
        <p>
          What the user or system can do: <span class="mono">Add to cart</span>,
          <span class="mono">Place order</span>,
          <span class="mono">Search products</span>,
          <span class="mono">Cancel order</span>. An action has parameters,
          rules, default effects, on-block effects, invariants, required state,
          emitted events, and scenarios. Example:
          <span class="mono">Checkout -> Place order</span> blocks until
          <span class="mono">checkout.step</span> is
          <span class="mono">review</span>.
        </p>

        <h3 class="font-semibold text-neutral-900">State</h3>
        <p>
          Typed, dot-notation key/value pairs that vary at runtime. Examples:
          <span class="mono">cart.itemCount</span>,
          <span class="mono">user.authenticated</span>,
          <span class="mono">product.stock</span>. Allowed types: string,
          number, boolean, enum, object, array. State definitions can include
          descriptions, enum values, typed defaults, and
          <span class="mono">sharedWith</span> links so another surface can see
          the same path. Example:
          <span class="mono">cart.lineItems</span> is an array of cart rows, and
          <span class="mono">cart.subtotal</span> is stored in cents.
        </p>

        <h3 class="font-semibold text-neutral-900">Rule</h3>
        <p>
          A deterministic <em>IF condition THEN effect</em> pair. Each rule
          belongs to a category (business, security, permissions, validation,
          ux_feedback, async, billing_quota, …) which makes the model auditable.
          Rules at surface level apply to every action on that surface; rules at
          action level apply only there. The right side of a condition can be a
          literal, another state path, or an expression JSON AST for param/state
          arithmetic. Example: <span class="mono">Place order</span> has a rule
          that blocks when <span class="mono">checkout.step != "review"</span>.
        </p>
        <CodeBlock
          language="text"
          code={`IF cart.itemCount == 0
THEN block_action "Your cart is empty"

IF user.authenticated == false
THEN block_action "Sign in to continue to checkout."

IF cart.subtotal > 3499
THEN show_message "You qualify for free shipping."`}
        />

        <h3 class="font-semibold text-neutral-900">Effect</h3>
        <p>
          The outcome of a rule (when its condition matches) or of an action's
          success path. The six effect types are:
        </p>
        <ul class="ml-5 list-disc space-y-1">
          <li><span class="mono">set_state</span>. Write to a state path</li>
          <li>
            <span class="mono">show_message</span>. Surface text to the user
          </li>
          <li>
            <span class="mono">emit_event</span>. Emit a product-level signal
          </li>
          <li><span class="mono">block_action</span>. Refuse the action</li>
          <li>
            <span class="mono">allow_action</span>. Explicit allow (audit)
          </li>
          <li>
            <span class="mono">transition_surface</span>. Navigate to another
            surface
          </li>
        </ul>

        <h3 class="font-semibold text-neutral-900">Event</h3>
        <p>
          A semantic, product-level signal. Not a UI event. Use lowercase
          dot-separated names:
          <span class="mono">order.placed</span>,
          <span class="mono">cart.item.added</span>,
          <span class="mono">checkout.address.confirmed</span>. Register events
          in the top-level
          <strong>Events</strong> tab so you can document payload fields, then
          reference those names from <span class="mono">emit_event</span>
          effects and action
          <span class="mono">emittedEvents</span>.
        </p>

        <h3 class="font-semibold text-neutral-900">Invariant</h3>
        <p>
          A condition that must always hold after an action runs. Examples:
          <span class="mono">cart.itemCount &gt;= 0</span>,
          <span class="mono">order.amount &gt; 0</span>. Violations turn a
          successful run into a blocked one. The simulator surfaces them so you
          spot inconsistent rules. Example: the cart subtotal must not become
          negative unless a specific admin action explicitly bypasses that
          invariant.
        </p>

        <h3 class="font-semibold text-neutral-900">Scenario</h3>
        <p>
          A saved simulator case for one action. A scenario can pre-fill state
          and parameter values, declare whether the run should succeed or block,
          and assert expected post-run state. Use scenarios to turn examples
          into regression checks. Example: a saved
          <span class="mono">Place order</span> scenario asserts that
          <span class="mono">order.amount</span> becomes
          <span class="mono">cart.subtotal + cart.shipping</span>.
        </p>
      {/snippet}
    </TutorialSection>

    <TutorialSection id="walkthrough" title="4. Walkthrough: eShop project">
      {#snippet children()}
        <p>
          The <strong>eShop</strong> sample is a working e-commerce model you can
          simulate end-to-end. A buyer signs up, browses, reviews a product, fills
          a cart, checks out, and watches the order ship. No UI code involved. Every
          block, every event, every state change is right there in the simulator,
          in front of you.
        </p>
        <p>
          It's split into four features so each one stays small enough to hold
          in head:
        </p>
        <Callout tone="info" title="What you get">
          {#snippet children()}
            <ol class="ml-5 list-decimal space-y-1">
              <li>
                <strong>Account &amp; auth</strong>. Signing up, signing in,
                verifying an email. Locks out repeated failures, caps
                verification retries, blocks duplicate accounts.
              </li>
              <li>
                <strong>Catalog &amp; reviews</strong>. Searching the catalog,
                opening a product, posting and filtering reviews. Stops
                profanity and link spam in reviews, gates age-restricted
                products to 18+ buyers.
              </li>
              <li>
                <strong>Cart &amp; checkout</strong>. Cart updates, coupons,
                addresses, payment, place order. Refuses empty carts, refuses
                checkout from unverified accounts, prices the order from the
                line items, and gives store admins a back-door subtotal
                override.
              </li>
              <li>
                <strong>Order fulfillment</strong>. The post-purchase lifecycle:
                preparing, shipped, out for delivery, delivered. Cancellation is
                allowed before shipping. Signature is required on delivery
                confirmation.
              </li>
            </ol>
          {/snippet}
        </Callout>

        <h3 class="font-semibold text-neutral-900">Loading the sample</h3>
        <p>
          Click <span class="mono">Load sample project</span> on the left. The
          four features and the project are created, ready to open. They're
          plain JSON copied from <span class="mono">samples/</span> into
          <span class="mono">unspa/</span>, so your edits stay yours.
        </p>

        <h3 class="font-semibold text-neutral-900">Three simulator checks</h3>
        <p>
          Open the named feature, select the named surface, pick the action, set
          the listed values, and click <span class="mono">Run action</span>.
          These are quick checks, not hidden UI interactions.
        </p>
        <ol class="ml-5 list-decimal space-y-3">
          <li>
            Open <strong>Catalog &amp; reviews</strong> ->
            <strong>Product details</strong> ->
            <span class="mono">Submit review</span>. In the parameter panel, set
            <span class="mono">rating = 5</span>
            and run: the simulator records a positive badge. Set
            <span class="mono">rating = 1</span> and run again: it records a critical
            badge. The decision lives in the model, not in code.
          </li>
          <li>
            Open <strong>Cart &amp; checkout</strong> ->
            <strong>Cart</strong> ->
            <span class="mono">Recalculate subtotal</span>. Run once and watch
            <span class="mono">cart.subtotal</span> match the sum of
            <span class="mono">cart.lineItems[*].amount</span>. Then edit a line
            item amount in the state panel and rerun: the total follows the line
            items, with no glue code in between.
          </li>
          <li>
            Open <strong>Cart &amp; checkout</strong> ->
            <strong>Checkout</strong> ->
            <span class="mono">Override subtotal (admin)</span>. A regular
            customer cannot make the subtotal negative; an admin can. The
            simulator shows exactly which rule lets the admin through, and which
            check would have blocked anyone else.
          </li>
        </ol>

        <h3 class="font-semibold text-neutral-900">
          Features that talk to each other
        </h3>
        <p>
          Place an order in <em>Cart &amp; checkout</em>. The
          <em>Order fulfillment</em>
          feature notices, creates the tracking record, and starts the lifecycle.
          You don't wire that up. The features just compose, through the events they
          emit and subscribe to. That's the whole point of splitting into LLM-sized
          features: each one stays small, and the simulator handles the seams between
          them.
        </p>

        <Callout tone="success" title="Why this matters">
          You can describe a full e-commerce buying flow, end to end, and have
          it actually run. Without writing a UI, without writing business logic,
          without writing tests that lie about what happened. The model itself
          is the contract. The simulator is the proof.
        </Callout>
      {/snippet}
    </TutorialSection>

    <TutorialSection id="simulator" title="5. Running the simulator">
      {#snippet children()}
        <p>
          The right-side <strong>Simulator</strong> panel runs your model deterministically.
          No AI, no guessing. Just rule evaluation and effect application.
        </p>

        <h3 class="font-semibold text-neutral-900">
          Quick test on the Checkout surface
        </h3>
        <ol class="ml-5 list-decimal space-y-2">
          <li>
            Open <strong>E-commerce. Full customer journey</strong> and select
            <strong>7. Checkout</strong>.
          </li>
          <li>Pick the <span class="mono">Place order</span> action.</li>
          <li>
            Click <span class="mono">Run action</span>. With the default state (<span
              class="mono">checkout.step = "address"</span
            >) you'll see <strong>blocked</strong>
            with the reason <em>"Complete the previous steps first."</em>
          </li>
          <li>
            Change <span class="mono">checkout.step</span> to
            <span class="mono">review</span> and set
            <span class="mono">payment.method</span> to
            <span class="mono">card</span>, then run again. The action succeeds,
            emits
            <span class="mono">order.placed</span>, and proposes a transition to
            the
            <strong>Order tracking</strong> surface.
          </li>
          <li>
            Try setting <span class="mono">order.amount</span> to
            <span class="mono">200000</span>
            (= $2,000). The compliance rule blocks the order.
          </li>
          <li>
            Toggle <span class="mono">user.emailVerified</span> to
            <span class="mono">false</span>. The surface-level rule blocks every
            action before they even evaluate. That's cross-cutting at work.
          </li>
        </ol>

        <h3 class="font-semibold text-neutral-900">Walking the full journey</h3>
        <p>
          To replay the entire customer flow surface by surface, run these
          actions in order. Each one with its default state:
        </p>
        <CodeBlock
          language="text"
          code={`1. Sign up        → Create account
   • Toggle form.termsAccepted = true first, otherwise blocked.

2. Email verify   → Verify email (with default state: code matches)

3. Catalog        → Add to cart (twice if you want, stock allows it)
                  → Go to cart

4. Cart           → Apply coupon (subtotal already > $15)
                  • Set user.authenticated = true and
                    user.emailVerified = true
                  → Proceed to checkout

5. Address book   → Add shipping address
                  → Continue to checkout

6. Checkout       → Confirm shipping address
                  → Select payment method
                  → Place order

7. Order tracking → Mark as shipped (system)
                  → Mark as out for delivery (carrier)
                  → Confirm delivery
                    • Set delivery.signatureCollected = true to clear the gate.`}
        />
        <Callout tone="success" title="What just happened">
          You designed and validated a complete Amazon-like buying feature.
          Onboarding, security, billing-quota, validation, audit, fraud,
          fulfillment, signature on delivery. By clicking through one panel. The
          simulator surfaced every rule that fired, every event that emitted,
          and every state transition that resulted.
        </Callout>

        <h3 class="font-semibold text-neutral-900">Result anatomy</h3>
        <p>Every simulation returns a deterministic record:</p>
        <ul class="ml-5 list-disc space-y-1">
          <li>
            <strong>status</strong>: <span class="mono">success</span> |
            <span class="mono">blocked</span>
            | <span class="mono">failed</span>
          </li>
          <li><strong>parameterErrors</strong>: failed validation</li>
          <li>
            <strong>evaluatedRules</strong>: every rule looked at, with origin
            (surface/action) and whether it matched
          </li>
          <li><strong>appliedEffects</strong>: what actually ran</li>
          <li><strong>messages</strong>: user-visible text</li>
          <li><strong>emittedEvents</strong>: signals fired</li>
          <li>
            <strong>previousState</strong> / <strong>nextState</strong>: full
            state diff
          </li>
          <li>
            <strong>invariantViolations</strong>: anything that must-hold but
            doesn't
          </li>
          <li>
            <strong>transition</strong>: target surface, if the action navigated
          </li>
        </ul>
      {/snippet}
    </TutorialSection>

    <TutorialSection id="maturity" title="6. Reading the maturity score">
      {#snippet children()}
        <p>
          Switch the right panel to the <strong>Maturity</strong> tab. Unspaghettit
          scores your model procedurally. No AI involved. By checking that:
        </p>
        <ul class="ml-5 list-disc space-y-1">
          <li>Every feature has a name and at least one surface.</li>
          <li>
            Every surface has at least one action and some state to react to.
          </li>
          <li>
            Every action has an intent, an effect or rule, and some emitted
            events.
          </li>
          <li>
            Every <strong>mutating</strong> action has a security/permission/compliance
            rule.
          </li>
          <li>Every action with parameters has a validation rule.</li>
        </ul>
        <p>
          Issues are split into <span class="mono">critical</span> (the model is
          incomplete) and
          <span class="mono">recommended</span> (worth fixing but not blocking).
          Use it as a design checklist, not as a grade.
        </p>
        <Callout tone="info" title="Want to see a non-100% score?">
          The bundled eShop project is intentionally complete, so it starts as a
          clean reference model. To see the maturity checker complain, create a
          tiny test feature with one empty surface and one action without
          effects, rules, or scenarios. The score will drop and the panel will
          list exactly what is missing.
        </Callout>
      {/snippet}
    </TutorialSection>

    <TutorialSection id="editor" title="7. Editing in the app">
      {#snippet children()}
        <p>
          The feature editor is split into top-level tabs and surface-level
          tabs. Anything the MCP can add or update should have a visible manual
          editor here too.
        </p>

        <h3 class="font-semibold text-neutral-900">Top-level tabs</h3>
        <ul class="ml-5 list-disc space-y-1">
          <li>
            <strong>Build</strong>: surfaces, state, actions, rules, invariants,
            scenarios.
          </li>
          <li>
            <strong>Resources</strong>: databases, APIs, queues, files, storage,
            compliance metadata.
          </li>
          <li><strong>Entities</strong>: domain schemas and field mappings.</li>
          <li>
            <strong>Events</strong>: event registry plus payload schema fields.
          </li>
          <li>
            <strong>Transitions</strong>: declared links between surfaces.
          </li>
        </ul>

        <h3 class="font-semibold text-neutral-900">Surface tabs</h3>
        <p>
          Inside <strong>Build</strong>, select a surface and use the middle
          panel. The
          <strong>State</strong> tab edits typed defaults, descriptions, enum
          values, and cross-surface sharing. The <strong>Actions</strong> tab edits
          parameters, required states, emitted events, rules, success effects, block
          effects, invariants, and scenarios. Surface rules and invariants live in
          their own tabs because they apply to every action on the surface.
        </p>

        <h3 class="font-semibold text-neutral-900">Advanced values</h3>
        <p>
          Rule condition right-hand sides and <span class="mono">set_state</span
          > effect values have Literal, State, and JSON modes. Use State for state-vs-state
          comparisons. Use JSON for the full MCP expression AST, such as param references
          or arithmetic.
        </p>
        <CodeBlock
          language="json"
          code={`{
  "kind": "add",
  "left": { "kind": "state", "path": "cart.itemCount" },
  "right": { "kind": "literal", "value": 1 }
}`}
        />

        <h3 class="font-semibold text-neutral-900">
          Tagging projects and features
        </h3>
        <p>
          Every project card and feature card has a <span class="mono"
            >+ Tag</span
          >
          chip that appears on hover. A tag is a
          <span class="mono">{`{type, value}`}</span> pair:
          <span class="mono">Team: Growth</span>,
          <span class="mono">Domain: Commerce</span>,
          <span class="mono">Status: WIP</span>. Tags don't change behavior;
          they're cross-cutting metadata that lets you filter the list along
          axes the Project → Feature hierarchy doesn't capture.
        </p>
        <p>
          Click <span class="mono">+ Tag</span>, pick or type a type (existing
          types auto-suggest), enter a value, and confirm. The pill row above
          the project list filters by tag. Tags dedupe case-insensitively, so
          re-adding the same tag is a safe no-op.
        </p>
        <Callout tone="info" title="Dashboard-MCP parity">
          Anything the dashboard can do, the MCP can do too, with the same
          atomicity. Adding a tag from a card calls the same path as
          <span class="mono">add_project_tag</span> /
          <span class="mono">add_feature_tag</span>. If you load a spec made by
          an agent, you should be able to find every entity in the app:
          resources, entities, events, payloads, shared state, scenarios,
          transitions, rules, effects, invariants, parameters, required states,
          emitted events, and tags.
        </Callout>
      {/snippet}
    </TutorialSection>

    <TutorialSection id="build" title="8. Build your own feature">
      {#snippet children()}
        <p>
          Try modeling a small CLI or workflow next. <strong
            >Pick one slice</strong
          >, not a whole product. "Authenticate a CLI", "Approve a refund",
          "Schedule a backup". If your description sounds like a whole app,
          split it first and pick the one slice you want to model now. A
          reliable recipe:
        </p>
        <ol class="ml-5 list-decimal space-y-2">
          <li>
            Write a one-line description of the feature. Avoid UI words
            ("dashboard", "form"). Use behavior words ("manage subscriptions",
            "approve refunds").
          </li>
          <li>
            List the <strong>actions</strong> the user/system can perform. Each action
            is a verb in user vocabulary.
          </li>
          <li>
            Group actions into <strong>surfaces</strong>. A surface is wherever
            those actions live in context. Not necessarily a screen.
          </li>
          <li>
            For each surface, list the <strong>state</strong> it depends on. State
            is anything that could change the outcome. Share state across surfaces
            when the same path is meaningful in both places.
          </li>
          <li>
            For each action, write the <strong>rules</strong> that block it. Use
            real categories. They make the model auditable.
          </li>
          <li>
            Add <strong>default effects</strong> describing the success path: state
            changes, messages, events, transitions.
          </li>
          <li>
            Register <strong>events</strong> and payload schemas, then declare which
            events each action emits.
          </li>
          <li>
            Add <strong>invariants</strong> for things that must always be true after
            the action runs.
          </li>
          <li>
            Add <strong>scenarios</strong> for the happy path and important blocked
            paths.
          </li>
          <li>
            Run the simulator. Iterate until both edge cases and the happy path
            behave.
          </li>
        </ol>
        <Callout tone="warning" title="Common mistakes">
          {#snippet children()}
            <ul class="ml-4 list-disc space-y-1">
              <li>
                Describing UI ("the button changes color") instead of behavior
                ("the
                <span class="mono">order.placed</span> event fires").
              </li>
              <li>
                Putting validation logic inside default effects. Use a <span
                  class="mono">validation</span
                > rule so the failure path is explicit and named.
              </li>
              <li>
                Inventing event names per action. Pick a small dictionary (5–20
                events) that other surfaces can react to.
              </li>
            </ul>
          {/snippet}
        </Callout>
      {/snippet}
    </TutorialSection>

    <TutorialSection id="queue" title="9. Implementation queue">
      {#snippet children()}
        <p>
          Every project has an <strong>Implementation Queue</strong> tab: an ordered
          "implement next" list of Features, Surfaces, or Actions you (or the LLM)
          plan to build. The point: a dev can say "implement the next thing in the
          queue" and the LLM picks it up via the MCP without you naming the entity.
        </p>
        <ul class="list-disc space-y-1 pl-5">
          <li>
            <strong>Add to queue</strong> hover affordance appears on every Feature
            card, every Surface header, and every Action row when the cursor is over
            them. This keeps the design minimal first.
          </li>
          <li>
            <strong>Drag to reorder</strong> on the Queue tab. Order persists to
            disk via the project file.
          </li>
          <li>
            <strong>Auto-prune</strong>: items disappear from the live list as
            <span class="mono">.unspa.json</span>
            flips their behavioral-index entry to
            <span class="mono">implemented</span>. The raw queue stays on disk;
            only the live view filters.
          </li>
        </ul>
        <Callout tone="info" title="MCP tools">
          {#snippet children()}
            <ul class="list-disc space-y-1 pl-5">
              <li>
                <span class="mono">enqueue</span>: add a feature/surface/action.
              </li>
              <li>
                <span class="mono">dequeue</span>: remove by queue item id.
              </li>
              <li>
                <span class="mono">reorder_queue</span>: drag-and-drop equivalent.
              </li>
              <li>
                <span class="mono">list_queue</span>: full live list with done-state.
              </li>
              <li>
                <span class="mono">get_next_queued</span>: peek the next live item
                (drives "implement next").
              </li>
            </ul>
          {/snippet}
        </Callout>
      {/snippet}
    </TutorialSection>

    <TutorialSection id="backup" title="10. Backup & share with .unspa">
      {#snippet children()}
        <p>
          The project page header has an <strong>Export .unspa</strong> button. It
          bundles the project + every attached feature + every implementation-status
          sidecar into a single encrypted file:
        </p>
        <ul class="list-disc space-y-1 pl-5">
          <li>
            <strong>AES-GCM-256</strong> with a key derived from a passphrase
            via
            <strong>PBKDF2-SHA256, 600 000 iterations</strong> (OWASP 2023 minimum).
          </li>
          <li>The passphrase <strong>never leaves the browser</strong>.</li>
          <li>
            The envelope carries <strong>no identifier of contents</strong>: no
            project name, no metadata. A third party holding the file learns only
            that it's an Unspaghettit bundle.
          </li>
          <li>
            Wrong passphrase + tampered ciphertext both fail at AES-GCM's
            auth-tag check and never decrypt to garbage.
          </li>
        </ul>
        <p>
          Restore via the <strong>Import .unspa</strong> button on the projects index.
          Useful for transferring a project between machines, archiving a milestone,
          or sharing with a teammate over an insecure channel.
        </p>
        <Callout tone="warning" title="Passphrase strength is on you">
          {#snippet children()}
            <p>
              A 12-character random passphrase is well outside brute-force range
              at 600k iterations. A 6-character dictionary word is not. Pick
              accordingly.
            </p>
          {/snippet}
        </Callout>
      {/snippet}
    </TutorialSection>

    <TutorialSection id="mcp" title="11. Connect AI agents with MCP">
      {#snippet children()}
        <p>
          Unspaghettit also ships a local MCP server so agents can inspect and
          simulate your behavior models without scraping the UI. It runs over <span
            class="mono">stdio</span
          >, which means each client starts it as a local child process.
        </p>
        <Callout tone="info" title="What the server exposes">
          {#snippet children()}
            The server exposes read, write, validation, simulation, maturity,
            scenario, implementation-audit, resource, entity, event, transition,
            persona, state, surface, action, rule, effect, and invariant tools.
            Use focused reads like
            <span class="mono">get_action</span>, bulk edits through
            <span class="mono">apply_batch</span>, dry validation with
            <span class="mono">apply_batch dryRun:true</span>, behavior checks
            with
            <span class="mono">dry_run_simulate</span> and
            <span class="mono">run_all_scenarios</span>, and quality checks with
            <span class="mono">score_feature</span>. Diagnostics go to stderr so
            stdout stays reserved for the MCP JSON-RPC stream.
          {/snippet}
        </Callout>

        <h3 class="font-semibold text-neutral-900">Prerequisites</h3>
        <ol class="ml-5 list-decimal space-y-2">
          <li>
            Install dependencies once with <span class="mono">npm install</span
            >.
          </li>
          <li>
            Keep exported snapshots in the repo's <span class="mono"
              >unspa/</span
            > folder. The MCP server discovers this folder automatically when it
            starts from the project root.
          </li>
          <li>
            Smoke test the server from the repo root with <span class="mono"
              >npm run mcp</span
            >. It should print a
            <span class="mono">[unspa-mcp] snapshots:</span> line and then wait for
            an MCP client.
          </li>
        </ol>

        <h3 class="font-semibold text-neutral-900">Agent authoring workflow</h3>
        <ol class="ml-5 list-decimal space-y-2">
          <li>
            Read narrowly first: <span class="mono">get_feature</span> for the
            index, then <span class="mono">get_action</span> for the area you are
            changing.
          </li>
          <li>
            Draft multi-entity edits with <span class="mono">apply_batch</span>.
            Batch-created refs work across surfaces, transitions, effects, and
            <span class="mono">sharedWith</span>.
          </li>
          <li>
            Run <span class="mono">apply_batch</span> with
            <span class="mono">dryRun:true</span> before saving risky edits.
          </li>
          <li>
            Run <span class="mono">dry_run_simulate</span> for one action or
            <span class="mono">run_all_scenarios</span> for saved examples.
          </li>
          <li>
            Run <span class="mono">score_feature</span>, then open the app and
            verify the generated spec is manually editable.
          </li>
          <li>
            Tag projects and features the same way the dashboard would:
            <span class="mono">add_project_tag</span> /
            <span class="mono">remove_project_tag</span> for projects,
            <span class="mono">add_feature_tag</span> /
            <span class="mono">remove_feature_tag</span> for features. Each is
            atomic and idempotent. For bulk replacement, pass
            <span class="mono">tags: [...]</span> to
            <span class="mono">create_project</span> /
            <span class="mono">update_project</span> /
            <span class="mono">create_feature</span> /
            <span class="mono">update_feature</span>.
          </li>
        </ol>

        <h3 class="font-semibold text-neutral-900">VS Code / GitHub Copilot</h3>
        <p>
          Create <span class="mono">.vscode/mcp.json</span> in this repo, or
          open it if it already exists. VS Code reads this MCP config file and
          lets Copilot Agent mode start the server. The MCP servers live under
          the top-level
          <span class="mono">servers</span> key.
        </p>
        <CodeBlock
          language="json"
          code={`{
  "servers": {
    "unspa": {
      "command": "npm.cmd",
      "args": ["run", "mcp"],
      "cwd": "\${workspaceFolder}"
    }
  }
}`}
        />
        <p>
          Then run <span class="mono">MCP: List Servers</span> from the Command
          Palette, select
          <span class="mono">unspa</span>, start it, and trust the local MCP
          server when prompted.
        </p>

        <h3 class="font-semibold text-neutral-900">Codex</h3>
        <p>
          Codex stores MCP servers in <span class="mono"
            >~/.codex/config.toml</span
          >. Open the file, keep any existing model or project settings, and add
          this block at the end. Adapt the path if your checkout lives somewhere
          else.
        </p>
        <CodeBlock
          language="toml"
          code={`[mcp_servers.unspa]
command = "npm.cmd"
args = ["run", "mcp"]
cwd = "<your-unspaghettit-clone>"
enabled = true
startup_timeout_sec = 30
tool_timeout_sec = 120`}
        />
        <p>
          Restart Codex, then run <span class="mono">/mcp</span> or
          <span class="mono">codex mcp list</span> to confirm that
          <span class="mono">unspa</span> is available.
        </p>

        <h3 class="font-semibold text-neutral-900">Claude Desktop</h3>
        <p>
          In Claude Desktop, open <span class="mono"
            >Settings -> Developer -> Edit Config</span
          >. On Windows this edits
          <span class="mono">%APPDATA%\Claude\claude_desktop_config.json</span>
          or, for the Microsoft Store build, a path under
          <span class="mono"
            >AppData\Local\Packages\Claude_...\LocalCache\Roaming\Claude</span
          >. If the file already contains <span class="mono">preferences</span>,
          do not replace it. Add <span class="mono">mcpServers</span> as another
          top-level key next to
          <span class="mono">preferences</span>, then fully restart Claude
          Desktop.
        </p>
        <Callout tone="warning" title="Claude Desktop chat vs local agent mode">
          {#snippet children()}
            The normal Claude Desktop chat reads <span class="mono"
              >mcpServers</span
            >
            from
            <span class="mono">claude_desktop_config.json</span>. Claude
            Desktop's local coding agent can also use Claude Code-style project
            config, so this repo includes a root-level
            <span class="mono">.mcp.json</span>. If Claude answers by searching
            the MCP registry instead of calling <span class="mono">unspa</span>,
            the local server was not loaded in that session.
          {/snippet}
        </Callout>
        <CodeBlock
          language="json"
          code={`{
  "preferences": {
    "localAgentModeTrustedFolders": [
      "<your-unspaghettit-clone>"
    ],
    "...": "keep your existing Claude settings here"
  },
  "mcpServers": {
    "unspa": {
      "type": "stdio",
      "command": "cmd",
      "args": ["/c", "npm.cmd", "run", "mcp"],
      "cwd": "<your-unspaghettit-clone>"
    }
  }
}`}
        />
        <p>
          For example, if your file currently starts with only
          <span class="mono">"preferences"</span>, the result should look like
          this shape:
        </p>
        <CodeBlock
          language="json"
          code={`{
  "preferences": {
    "localAgentModeTrustedFolders": [
      "C:\\\\path\\\\to\\\\your\\\\project"
    ],
    "coworkScheduledTasksEnabled": true,
    "ccdScheduledTasksEnabled": true,
    "sidebarMode": "task",
    "coworkWebSearchEnabled": true,
    "epitaxyPrefs": {
      "starred-local-code-sessions": [],
      "starred-cowork-spaces": [],
      "starred-session-groups": [],
      "dframe-local-slice": {
        "pinnedOrder": [],
        "customGroupAssignments": {},
        "customGroupOrder": {}
      }
    }
  },
  "mcpServers": {
    "unspa": {
      "type": "stdio",
      "command": "cmd",
      "args": ["/c", "npm.cmd", "run", "mcp"],
      "cwd": "<your-unspaghettit-clone>"
    }
  }
}`}
        />

        <h3 class="font-semibold text-neutral-900">Claude Code</h3>
        <p>
          Claude Code is configured separately from Claude Desktop. For
          team-friendly setup, commit a <span class="mono">.mcp.json</span> file
          at the project root:
        </p>
        <CodeBlock
          language="json"
          code={`{
  "mcpServers": {
    "unspa": {
      "type": "stdio",
      "command": "cmd",
      "args": ["/c", "npm.cmd", "run", "mcp"],
      "env": {}
    }
  }
}`}
        />
        <p>
          When Claude Code or Claude Desktop local agent mode opens this
          project, approve the project MCP server if prompted. If you prefer a
          private user-level install instead, run this from any terminal:
        </p>
        <CodeBlock
          language="powershell"
          code={`claude mcp add-json unspa '{ "type": "stdio", "command": "cmd", "args": ["/c", "npm.cmd", "run", "mcp"], "cwd": "<your-unspaghettit-clone>" }'
claude mcp list`}
        />
        <Callout tone="info" title="Fast path with Claude Code">
          {#snippet children()}
            If Claude Code is already running in your repo, you can ask it to do
            the setup for you:
            <CodeBlock
              language="text"
              code={`Install Unspaghettit in this repo. Run unspa init, register the MCP server for Claude Code, keep the generated CLAUDE.md/AGENTS.md guidance, then verify the unspa MCP tools are available.`}
            />
            After it finishes, restart Claude Code if the MCP server list does not
            refresh automatically.
          {/snippet}
        </Callout>

        <h3 class="font-semibold text-neutral-900">Generic MCP clients</h3>
        <p>
          Any stdio-compatible MCP client needs the same launcher: command
          <span class="mono">npm.cmd</span>, args
          <span class="mono">["run", "mcp"]</span>, and working directory set to
          the repo root. If a client does not support
          <span class="mono">cwd</span>, launch it from this directory or pass
          an explicit snapshots folder:
        </p>
        <CodeBlock
          language="json"
          code={`{
  "command": "npm.cmd",
  "args": [
    "run",
    "mcp",
    "--",
    "--snapshots",
    "<your-unspaghettit-clone>/unspa"
  ]
}`}
        />
      {/snippet}
    </TutorialSection>

    <TutorialSection id="collab" title="12. Multi-user & identity">
      {#snippet children()}
        <p>
          Multiple humans + AI agents can edit the same runtime live. The
          dashboard's Yjs WebSocket layer makes every change land in every open
          tab without a refresh, and an activity toast carries the breadcrumb (<span
            class="mono">Project › Feature › Surface › Action</span
          >) + a <strong>View</strong> button to jump there.
        </p>
        <p>
          Click the round avatar in the header to set your <strong
            >display name</strong
          >. Every history entry you create is tagged with it and stored only in
          this browser's localStorage, never sent off-machine. First visit
          prompts once; the avatar dropdown is the explicit way to change or
          reset later.
        </p>
        <p>
          MCP-driven changes carry an <strong>AI · for &lt;your-name&gt;</strong
          >
          label: the AI badge stays purple (clear AI/human distinction), and the
          human name is the supporting attribution. The dashboard server resolves
          "who's currently here" from the connected WebSocket clients and tags entries
          accordingly.
        </p>
        <Callout tone="info" title="Reset local data">
          {#snippet children()}
            The avatar dropdown also exposes a <strong>Reset local data</strong>
            option (red, with a danger confirm). It wipes
            <span class="mono">localStorage</span> +
            <span class="mono">sessionStorage</span> and reloads. Server-side project
            data is untouched.
          {/snippet}
        </Callout>
      {/snippet}
    </TutorialSection>

    <TutorialSection id="security" title="13. Hosting on a network">
      {#snippet children()}
        <p>
          Default install is <strong>loopback-only</strong> with no auth. The
          dashboard binds <span class="mono">127.0.0.1:3000</span> and only your
          machine can reach it. That's the right stance for solo dev on a trusted
          workstation; the user is the trust boundary.
        </p>
        <p>
          To <strong>share with teammates on a trusted network</strong> (home wifi,
          office VLAN, Tailscale subnet), opt into the LAN-share tier:
        </p>
        <CodeBlock
          language="bash"
          code={`# Generate a strong token (any random string works):
TOKEN=$(node -e "console.log(crypto.randomBytes(24).toString('base64url'))")

# Set on both the dashboard env AND every MCP server that talks to it:
export UNSPA_AUTH_TOKEN=$TOKEN
# Optional but recommended: lock cross-site browser requests
export UNSPA_ALLOWED_ORIGIN=http://192.168.1.10:3000

unspa dashboard --host 0.0.0.0`}
        />
        <p>
          What it covers: anyone who knows the token can read/write every
          feature; anyone who doesn't gets <span class="mono">401</span>. A
          malicious page in another browser tab can't drive writes against the
          dashboard (origin check).
        </p>
        <p>
          What it does <strong>not</strong> cover: SSO, RBAC, per-user permissions,
          HTTPS termination, audit-trail hardening, encryption at rest. Front the
          dashboard with a reverse proxy (Caddy, Tailscale Serve, cloudflared with
          Access) for HTTPS + extra auth layers.
        </p>
        <Callout
          tone="warning"
          title="Do not expose 0.0.0.0:3000 to the public internet"
        >
          {#snippet children()}
            The OSS install is built for trusted networks. Public exposure
            requires the enterprise tier (SSO + RBAC + audit, separately
            distributed).
          {/snippet}
        </Callout>
        <p class="text-sm text-slate-600">
          Full threat model + mitigations in
          <a
            href="https://github.com/lyriks-io/unspaghettit/blob/main/SECURITY.md"
            class="text-brand-700 hover:underline">SECURITY.md</a
          >.
        </p>
      {/snippet}
    </TutorialSection>

    <TutorialSection id="next" title="14. Where to go next">
      {#snippet children()}
        <ul class="ml-5 list-disc space-y-1">
          <li>
            Open the <a href="/features" class="text-brand-700 underline"
              >features list</a
            > and remix the e-commerce sample. Try modeling a returns/refunds surface.
          </li>
          <li>
            Try modeling a non-UI product: a CLI for project scaffolding, an LLM
            agent that handles support tickets, or an internal approval
            workflow.
          </li>
          <li>
            Watch the <strong>Maturity</strong> panel turn green as you tighten the
            model. The score is a direct readout of how much of the behavior you've
            explicitly named.
          </li>
        </ul>
        <Callout tone="info" title="Where this goes next">
          {#snippet children()}
            Unspaghettit is free and stays local-first. The roadmap tracks the
            app's own behavior: deeper simulator coverage, sharper maturity
            checks, more MCP tools, smoother authoring. If something blocks how
            you model your product, open an issue. What ships next is shaped by
            what the community runs into.
          {/snippet}
        </Callout>
      {/snippet}
    </TutorialSection>
  </article>
</div>

<style>
  .sample-cta {
    background-image: linear-gradient(
      115deg,
      #0e7490 0%,
      #0f766e 22%,
      #06b6d4 45%,
      #7c3aed 68%,
      #db2777 88%,
      #0e7490 100%
    );
    background-size: 260% 100%;
    background-position: 0% 50%;
    animation: sample-cta-flow 9s ease-in-out infinite;
  }
  .sample-cta:hover {
    animation-duration: 5s;
  }
  @keyframes sample-cta-flow {
    0% {
      background-position: 0% 50%;
    }
    50% {
      background-position: 100% 50%;
    }
    100% {
      background-position: 0% 50%;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .sample-cta {
      animation: none;
      background-position: 30% 50%;
    }
  }
</style>
