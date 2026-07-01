import type { TourDefinition } from '../../domain/entities/TourDefinition';
import { isNameMatch } from '../../domain/services/NameMatch';
import { featureStore } from '$features/behavior-model/presentation/stores/featureStore.svelte';
import { isParamLeft } from '$features/behavior-model/domain/value-objects/RuleCondition';

const matchName =
  (expected: string) =>
  (payload: Record<string, unknown> | undefined): boolean =>
    typeof payload?.name === 'string' && isNameMatch(payload.name, expected);

/**
 * Find the most recently-added action in the loaded feature. Tour
 * predicates inspect THIS action to verify the user did what each form
 * step asked. Returns null when there's no loaded feature or no
 * actions yet.
 */
const latestAction = () => {
  const feature = featureStore.feature;
  if (!feature) return null;
  for (let i = feature.surfaces.length - 1; i >= 0; i--) {
    const surface = feature.surfaces[i];
    if (!surface) continue;
    if (surface.actions.length === 0) continue;
    return surface.actions[surface.actions.length - 1] ?? null;
  }
  return null;
};

const actionHasPolitelyParameter = (): boolean => {
  const action = latestAction();
  if (!action) return false;
  return action.parameters.some(
    (p) => isNameMatch(p.name, 'politely') && p.type === 'boolean'
  );
};

const countParameterShowMessageRules = (): number => {
  const action = latestAction();
  if (!action) return 0;
  return action.rules.filter((rule) => {
    if (!rule.condition || 'kind' in rule.condition) return false;
    return isParamLeft(rule.condition.left) && rule.effect.type === 'show_message';
  }).length;
};

const actionHasOneParameterRule = (): boolean => countParameterShowMessageRules() >= 1;
const actionHasTwoParameterRules = (): boolean => countParameterShowMessageRules() >= 2;

/**
 * Concrete first-run tour. Lives in infrastructure because it's
 * authored content (data + copy), not domain logic. The domain layer
 * only knows the *shape* of a TourDefinition; what counts as "the
 * first tour" is a fixture.
 *
 * Each step pairs a `target` selector with the most reliable advance
 * trigger we have for that interaction:
 *   - `click` for steps where the next action is a single button press
 *   - `event` for steps where a submit can come from Enter or click and
 *     a domain event fires either way
 *   - `manual` for narrative framing - gated by `canAdvance` when the
 *     user is expected to have configured something first
 *
 * Fixed names ("Hello World", "Greeting", …) make screenshots, support,
 * and follow-up tutorials all unambiguous.
 */
export const firstFeatureTour: TourDefinition = {
  id: 'first-feature',
  name: 'Build your first feature, end to end',
  summary:
    'Walks you from an empty app to a Feature with one Action you run in the simulator. About 3 minutes. Uses fixed names so the experience is the same for everyone.',
  steps: [
    {
      id: 'welcome',
      title: 'Welcome',
      body:
        "We'll build a tiny Feature together and run it in the simulator. " +
        "We'll use fixed names so the rest of the tutorial reads the same way for you as for anyone else. Click Next when you're ready.",
      advance: { kind: 'manual' }
    },
    {
      id: 'new-project',
      title: 'Create a project',
      body:
        "Click 'New project'. A Project groups Features that belong to the same product or codebase.",
      target: '[data-tour="new-project-button"]',
      route: { pathname: '/projects', label: 'Go to Projects' },
      advance: { kind: 'click', selector: '[data-tour="new-project-button"]' }
    },
    {
      id: 'fill-project',
      title: 'Name the project',
      body:
        "Type exactly 'Hello World' in the Name field, then click 'New project'. " +
        'The description is pre-filled - keep it as-is or tweak if you want.',
      target: '[data-tour="new-project-form"]',
      focusSelector: '[data-tour="new-project-form"] input[type="text"]',
      prefill: [
        {
          selector: '[data-tour="new-project-description"]',
          value: 'A first project to learn Unspaghettit.'
        }
      ],
      requireExact: { formId: 'new-project', value: 'Hello World' },
      advance: {
        kind: 'event',
        event: 'project.created',
        match: matchName('Hello World')
      }
    },
    {
      id: 'new-feature',
      title: 'Create a feature',
      body:
        "Inside your project, click 'New feature'. A Feature is one coherent slice of behavior. Keep it small.",
      target: '[data-tour="new-feature-button"]',
      advance: { kind: 'click', selector: '[data-tour="new-feature-button"]' }
    },
    {
      id: 'fill-feature',
      title: 'Name the feature',
      body:
        "Type 'Greeting' in the Name field, then click 'Create feature'. " +
        'The description is pre-filled.',
      target: '[data-tour="new-feature-form"]',
      focusSelector: '[data-tour="new-feature-form"] input[type="text"]',
      prefill: [
        {
          selector: '[data-tour="new-feature-description"]',
          value: 'User opens the app and is welcomed.'
        }
      ],
      requireExact: { formId: 'new-feature', value: 'Greeting' },
      advance: {
        kind: 'event',
        event: 'feature.created',
        match: matchName('Greeting')
      }
    },
    {
      id: 'add-surface',
      title: 'Add a surface',
      body:
        "Click 'Add surface'. A Surface is one context where actions happen (a screen, a terminal, a workflow).",
      target: '[data-tour="add-surface-button"]',
      advance: { kind: 'click', selector: '[data-tour="add-surface-button"]' }
    },
    {
      id: 'chooser-create-new',
      title: 'Pick "Create new"',
      body: "We're starting from scratch, so click the 'Create new' card.",
      target: '[data-tour="chooser-create-new"]',
      advance: { kind: 'click', selector: '[data-tour="chooser-create-new"]' }
    },
    {
      id: 'fill-surface',
      title: 'Name the surface',
      body:
        "Surface name: type exactly 'Welcome Screen'. " +
        "Keep the type on Screen. Click 'Create surface' to submit.",
      target: '[data-tour="blank-surface-form"]',
      focusSelector: '[data-tour="blank-surface-form"] input[type="text"]',
      requireExact: { formId: 'blank-surface', value: 'Welcome Screen' },
      advance: {
        kind: 'event',
        event: 'editor.surface.added',
        match: matchName('Welcome Screen')
      }
    },
    {
      id: 'add-action',
      title: 'Add an action',
      body:
        "Type exactly 'Say Hello' in the action form, then click 'Add action' (or press Enter). " +
        'An Action is something the user or system can do on this surface.',
      target: '[data-tour="add-action-form"]',
      focusSelector: '[data-tour="add-action-form"] input[type="text"]',
      requireExact: { formId: 'add-action', value: 'Say Hello' },
      advance: {
        kind: 'event',
        event: 'editor.action.added',
        match: matchName('Say Hello')
      }
    },
    {
      id: 'add-parameter',
      title: 'Give the action a parameter',
      body:
        "The Say Hello editor just opened. In the Parameters section, click '+ Parameter'. " +
        "The name field will focus automatically. Then:\n" +
        "1. type 'politely' for the Name\n" +
        "2. change Type to 'boolean'\n" +
        "Next unlocks once a 'politely' boolean parameter exists on Say Hello.",
      target: '[data-tour="action-parameters-section"]',
      advance: { kind: 'manual' },
      canAdvance: actionHasPolitelyParameter
    },
    {
      id: 'add-rule-not-polite',
      title: 'Rule 1: the casual hello',
      body:
        "We want the action to say 'Hi.' only when politely is NO. Add the first rule:\n\n" +
        "1. Click '+ Rule' at the top right of the Rules section.\n" +
        "2. On the IF row, click 'Param' (next to 'State'), then pick 'politely' in the dropdown.\n" +
        "3. Change the operator dropdown from 'equals' to 'is false'. The right-side value field disappears - that's expected.\n" +
        "4. On the THEN row, change 'Block action' to 'Show message'.\n" +
        "5. In the text field that appears, type: Hi.\n\n" +
        "Next unlocks once one parameter-based Show message rule exists.",
      target: '[data-tour="action-rules-section"]',
      advance: { kind: 'manual' },
      canAdvance: actionHasOneParameterRule
    },
    {
      id: 'add-rule-polite',
      title: 'Rule 2: the friendly hello',
      body:
        "Now the inverse - when politely is YES, the action greets warmly instead. Click '+ Rule' again, then:\n\n" +
        "1. IF row: click 'Param', pick 'politely'\n" +
        "2. operator: 'is true' (right-side value field disappears)\n" +
        "3. THEN row: 'Show message'\n" +
        "4. Message: Hello, friend, lovely to see you.\n\n" +
        "Next unlocks once you have TWO parameter-based Show message rules.",
      target: '[data-tour="action-rules-section"]',
      advance: { kind: 'manual' },
      canAdvance: actionHasTwoParameterRules
    },
    {
      id: 'open-simulator',
      title: 'Open the simulator',
      body:
        "Click the Simulator tile in the health strip. It lets you run any action against the feature's current state.",
      target: '[data-tour="simulator-toggle"]',
      advance: { kind: 'click', selector: '[data-tour="simulator-toggle"]' }
    },
    {
      id: 'inspect-parameter',
      title: 'The simulator picked up your parameter',
      body:
        "The 'politely' parameter you added is now an input here. " +
        "You'll flip it between 'No' and 'Yes' in the next steps to see the rule fire.",
      target: '[data-tour-sim-param="politely"]',
      panelPosition: 'avoid-target',
      advance: { kind: 'manual' }
    },
    {
      id: 'run-polite-false',
      title: "Try it first with politely = No",
      body:
        "Leave 'politely' on 'No' and click 'Run Say Hello'.\n\n" +
        "The tour will move on automatically once the run completes.",
      target: '[data-tour="simulator-run"]',
      panelPosition: 'avoid-target',
      advance: { kind: 'event', event: 'action.simulated' }
    },
    {
      id: 'inspect-result',
      title: "Read the result, then try the other side",
      body:
        "Look at the Result panel below the Run button.\n\n" +
        "Right now (politely = No):\n" +
        "- 'Hi.' fired - rule 1 matched\n" +
        "- rule 2 was checked but its condition didn't hold\n\n" +
        "Now flip politely to 'Yes' and click Run again. The output flips:\n" +
        "- 'Hello, friend, lovely to see you.' fires - rule 2 matches\n" +
        "- rule 1 stays silent\n\n" +
        "Same action, same rules on disk, ONE OR THE OTHER message at runtime - just because one input flipped. " +
        "That's the whole point of rules: fork behaviour by parameters or state, not by writing two actions. " +
        "Toggle politely and re-run as many times as you like; click Next when done.",
      target: '[data-tour="simulator-panel"]',
      panelPosition: 'avoid-target',
      advance: { kind: 'manual' }
    },
    {
      id: 'maturity-tour',
      title: 'Maturity score',
      body:
        "The MAT tile shows how complete your spec is. Every action without scenarios, every rule without a description, every state without a default - all chip points off. " +
        "Click it later to see exactly what's missing and a 'Fix' button that jumps you to the right place. " +
        "Your AI agent reads the same checklist via MCP and can write the missing bits for you.",
      target: '[data-tour="maturity-toggle"]',
      panelPosition: 'below-target',
      advance: { kind: 'manual' }
    },
    {
      id: 'implementation-tour',
      title: 'Implementation score',
      body:
        "The IMPL tile is a dash today - we haven't tagged any code yet. " +
        "Once your AI agent writes the implementation and updates `.unspa.json` with `{ action: 'a1b2c3d4' -> file, line }`, this turns green in real time. " +
        "You'll see, action by action, what's coded and what's still spec-only - and the agent can resolve the gaps without losing context.",
      target: '[data-tour="implementation-toggle"]',
      panelPosition: 'below-target',
      advance: { kind: 'manual' }
    },
    {
      id: 'mcp-tour',
      title: 'Hook up your AI agent',
      body:
        "Every project page has an MCP button (next to Graph) that registers this dashboard as an MCP server for your AI coding agent, scoped to that project's features. " +
        "Once connected, the agent can list features, add actions, run scenarios, score maturity, and report implementation - all through typed tool calls instead of pasting prose. " +
        "That's the loop: you sketch behaviour, the agent fills it in, the spec stays the source of truth.",
      advance: { kind: 'manual' }
    },
    {
      id: 'done',
      title: "That's the model in miniature",
      body:
        "A Project holds Features. A Feature holds Surfaces. A Surface holds Actions. " +
        "An Action takes parameters, fires effects, and rules fork the outcome. " +
        "The shape doesn't change as you go deeper. " +
        "Now hand it to your AI agent and let them build the rest with you.",
      lockScroll: true,
      advance: { kind: 'manual' }
    }
  ]
};
