import type { SurfaceBlueprint } from '../../../domain/entities/SurfaceBlueprint';
import { defineBrick } from '../_shared/brick';

export const AI_IDS = {
  assistant: 'library.ai.assistant',
  promptPlayground: 'library.ai.prompt_playground',
  modelSettings: 'library.ai.model_settings',
  agentRun: 'library.ai.agent_run'
} as const;

const assistant = defineBrick({
  id: AI_IDS.assistant,
  name: 'Assistant chat',
  category: 'ai',
  surfaceType: 'screen',
  summary: 'Conversational assistant with streaming guard and model switch.',
  description:
    'A chat surface for an AI assistant. Sending is blocked while a response streams; stop only works mid-stream; the model tier is an explicit enum.',
  surfaceName: 'Assistant',
  surfaceDescription: 'Converse with an AI assistant.',
  tags: ['ai', 'assistant', 'chat', 'llm'],
  siblings: [{ id: AI_IDS.promptPlayground, label: 'Playground' }],
  states: [
    { path: 'assistant.turnCount', type: 'number', default: 0, description: 'Turns in the conversation.' },
    { path: 'assistant.streaming', type: 'boolean', default: false, description: 'True while a response streams.' },
    { path: 'assistant.model', type: 'enum', default: 'balanced', description: 'Model tier.', enumValues: ['fast', 'balanced', 'max'] }
  ],
  invariants: [
    { name: 'Turn count is non-negative', path: 'assistant.turnCount', op: 'greater_than', value: -1, message: 'Turn count can never be negative.' }
  ],
  actions: [
    {
      name: 'Send prompt',
      intent: 'Send a message to the assistant.',
      emits: 'assistant.message.sent',
      roles: ['primary', 'async'],
      requiredStates: ['assistant.streaming'],
      params: [
        { name: 'prompt', type: 'string', description: 'User message.', validations: [{ type: 'non_empty' }, { type: 'max_length', value: 20000 }] }
      ],
      rules: [
        { category: 'async', when: { path: 'assistant.streaming', op: 'is_true' }, block: 'Wait for the current response to finish.' }
      ]
    },
    {
      name: 'Stop generation',
      intent: 'Cancel the streaming response.',
      emits: 'assistant.generation.stopped',
      roles: ['primary'],
      requiredStates: ['assistant.streaming'],
      rules: [
        { category: 'business', when: { path: 'assistant.streaming', op: 'is_false' }, block: 'Nothing is generating.' },
        { category: 'business', description: 'Clear the streaming flag.', set: { path: 'assistant.streaming', value: false } }
      ]
    },
    {
      name: 'Set model',
      intent: 'Switch the model tier.',
      emits: 'assistant.model.changed',
      roles: ['primary'],
      params: [
        { name: 'model', type: 'enum', description: 'Model tier.', enumValues: ['fast', 'balanced', 'max'], bindTo: 'assistant.model' }
      ],
      rules: [{ category: 'ux_feedback', message: { text: 'Model switched.', tone: 'info' } }]
    }
  ]
});

const promptPlayground = defineBrick({
  id: AI_IDS.promptPlayground,
  name: 'Prompt playground',
  category: 'ai',
  surfaceType: 'api_playground',
  summary: 'Tune system/user prompts and sampling with an in-flight guard.',
  description:
    'A prompt-engineering console. Running is blocked while a run is in progress; temperature binds a validated 0-100 value.',
  surfaceName: 'Playground',
  surfaceDescription: 'Experiment with prompts and sampling parameters.',
  tags: ['ai', 'prompt', 'playground', 'llm'],
  states: [
    { path: 'prompt.temperature', type: 'number', default: 70, description: 'Sampling temperature (0-100).' },
    { path: 'prompt.maxTokens', type: 'number', default: 1024, description: 'Max output tokens.' },
    { path: 'prompt.running', type: 'boolean', default: false, description: 'True while a run is in progress.' }
  ],
  invariants: [
    { name: 'Max tokens is positive', path: 'prompt.maxTokens', op: 'greater_than', value: 0, message: 'Max tokens is always positive.' }
  ],
  actions: [
    {
      name: 'Run prompt',
      intent: 'Execute the configured prompt.',
      emits: 'prompt.run.started',
      roles: ['async'],
      requiredStates: ['prompt.running'],
      params: [
        { name: 'system', type: 'string', description: 'System prompt.', required: false, defaultValue: '', validations: [{ type: 'max_length', value: 8000 }] },
        { name: 'user', type: 'string', description: 'User prompt.', validations: [{ type: 'non_empty' }, { type: 'max_length', value: 20000 }] }
      ],
      rules: [
        { category: 'async', when: { path: 'prompt.running', op: 'is_true' }, block: 'A run is already in progress.' }
      ]
    },
    {
      name: 'Set temperature',
      intent: 'Change the sampling temperature.',
      emits: 'prompt.temperature.changed',
      roles: ['primary'],
      params: [
        { name: 'temperature', type: 'number', description: 'Temperature 0-100.', bindTo: 'prompt.temperature', validations: [{ type: 'min', value: 0 }, { type: 'max', value: 100 }, { type: 'integer' }] }
      ],
      rules: [{ category: 'ux_feedback', message: { text: 'Temperature updated.', tone: 'info' } }]
    }
  ]
});

const modelSettings = defineBrick({
  id: AI_IDS.modelSettings,
  name: 'Model settings',
  category: 'ai',
  surfaceType: 'screen',
  summary: 'Choose model tier and hosting behind an admin gate.',
  description:
    'Workspace-level AI configuration. Tier and hosting are vendor-neutral enums; both changes are admin-only.',
  surfaceName: 'Model',
  surfaceDescription: 'Configure the default model tier and hosting.',
  tags: ['ai', 'model', 'settings', 'configuration'],
  states: [
    { path: 'model.tier', type: 'enum', default: 'balanced', description: 'Default model tier.', enumValues: ['fast', 'balanced', 'max'] },
    { path: 'model.hosting', type: 'enum', default: 'hosted', description: 'Where the model runs.', enumValues: ['hosted', 'self_hosted'] },
    { path: 'session.role', type: 'enum', default: 'admin', description: 'Role of the current session.', enumValues: ['owner', 'admin', 'member'] }
  ],
  invariants: [
    { name: 'A tier is always set', path: 'model.tier', op: 'exists', message: 'A model tier must always be selected.' }
  ],
  actions: [
    {
      name: 'Set tier',
      intent: 'Change the default model tier.',
      emits: 'model.tier.changed',
      roles: ['primary'],
      requiredStates: ['session.role'],
      params: [
        { name: 'tier', type: 'enum', description: 'Model tier.', enumValues: ['fast', 'balanced', 'max'], bindTo: 'model.tier' }
      ],
      rules: [
        { category: 'permissions', when: { path: 'session.role', op: 'equals', value: 'member' }, block: 'Only owners and admins can change the model tier.' }
      ]
    },
    {
      name: 'Set hosting',
      intent: 'Change where the model runs.',
      emits: 'model.hosting.changed',
      roles: ['primary'],
      requiredStates: ['session.role'],
      params: [
        { name: 'hosting', type: 'enum', description: 'Hosting mode.', enumValues: ['hosted', 'self_hosted'], bindTo: 'model.hosting' }
      ],
      rules: [
        { category: 'permissions', when: { path: 'session.role', op: 'equals', value: 'member' }, block: 'Only owners and admins can change hosting.' }
      ]
    }
  ]
});

const agentRun = defineBrick({
  id: AI_IDS.agentRun,
  name: 'Agent run',
  category: 'ai',
  surfaceType: 'workflow',
  summary: 'Start, pause, and cancel an autonomous agent run.',
  description:
    'A control panel for an agentic run. Starting is blocked while active, pausing requires an active run, and cancel always returns to idle.',
  surfaceName: 'Agent',
  surfaceDescription: 'Drive an autonomous agent run through its lifecycle.',
  tags: ['ai', 'agent', 'autonomous', 'workflow'],
  states: [
    { path: 'agent.status', type: 'enum', default: 'idle', description: 'Run status.', enumValues: ['idle', 'running', 'paused', 'done', 'error'] },
    { path: 'agent.stepCount', type: 'number', default: 0, description: 'Steps executed.' }
  ],
  invariants: [
    { name: 'Step count is non-negative', path: 'agent.stepCount', op: 'greater_than', value: -1, message: 'Step count can never be negative.' }
  ],
  actions: [
    {
      name: 'Start run',
      intent: 'Kick off an agent run toward a goal.',
      emits: 'agent.run.started',
      roles: ['primary', 'async'],
      requiredStates: ['agent.status'],
      params: [
        { name: 'goal', type: 'string', description: 'Objective for the run.', validations: [{ type: 'non_empty' }, { type: 'max_length', value: 2000 }] }
      ],
      rules: [
        { category: 'async', when: { path: 'agent.status', op: 'equals', value: 'running' }, block: 'A run is already active.' },
        { category: 'async', description: 'Mark the run active.', set: { path: 'agent.status', value: 'running' } }
      ]
    },
    {
      name: 'Pause run',
      intent: 'Pause the active run.',
      emits: 'agent.run.paused',
      roles: ['primary'],
      requiredStates: ['agent.status'],
      rules: [
        { category: 'business', when: { path: 'agent.status', op: 'not_equals', value: 'running' }, block: 'There is no active run to pause.' },
        { category: 'business', description: 'Move the run to paused.', set: { path: 'agent.status', value: 'paused' } }
      ]
    },
    {
      name: 'Cancel run',
      intent: 'Stop the run and reset to idle.',
      emits: 'agent.run.cancelled',
      roles: ['destructive'],
      rules: [{ category: 'business', description: 'Return the run to idle.', set: { path: 'agent.status', value: 'idle' } }]
    }
  ]
});

export const aiBlueprints: readonly SurfaceBlueprint[] = [assistant, promptPlayground, modelSettings, agentRun];
