import type { SurfaceBlueprint } from '../../../domain/entities/SurfaceBlueprint';
import { defineBrick } from '../_shared/brick';

export const FILES_IDS = {
  browser: 'library.files.browser',
  uploader: 'library.files.uploader'
} as const;

const browser = defineBrick({
  id: FILES_IDS.browser,
  name: 'File browser',
  category: 'files',
  surfaceType: 'screen',
  summary: 'Folder navigation with grid/list view and a guarded bulk delete.',
  description:
    'A file manager surface. Navigation validates the path; deletion needs a selection and an editor role so members cannot destroy shared files.',
  surfaceName: 'Files',
  surfaceDescription: 'Browse folders, switch views, and manage files.',
  tags: ['files', 'browser', 'folders', 'storage'],
  siblings: [{ id: FILES_IDS.uploader, label: 'Upload' }],
  states: [
    { path: 'files.path', type: 'string', default: '/', description: 'Current folder path.' },
    { path: 'files.selectedCount', type: 'number', default: 0, description: 'Files currently selected.' },
    { path: 'files.view', type: 'enum', default: 'list', description: 'Layout.', enumValues: ['grid', 'list'] },
    { path: 'session.role', type: 'enum', default: 'editor', description: 'Role of the current session.', enumValues: ['owner', 'editor', 'viewer'] }
  ],
  invariants: [
    { name: 'Selection count is non-negative', path: 'files.selectedCount', op: 'greater_than', value: -1, message: 'The selection count can never be negative.' }
  ],
  actions: [
    {
      name: 'Open folder',
      intent: 'Navigate into a folder.',
      emits: 'files.folder.opened',
      roles: ['entry'],
      params: [
        { name: 'path', type: 'string', description: 'Folder path.', bindTo: 'files.path', validations: [{ type: 'non_empty' }, { type: 'max_length', value: 1024 }] }
      ],
      rules: [{ category: 'ux_feedback', message: { text: 'Folder opened.', tone: 'info' } }]
    },
    {
      name: 'Set view',
      intent: 'Toggle between grid and list layout.',
      emits: 'files.view.changed',
      roles: ['primary'],
      params: [
        { name: 'view', type: 'enum', description: 'Layout.', enumValues: ['grid', 'list'], bindTo: 'files.view' }
      ],
      rules: [{ category: 'ux_feedback', message: { text: 'View changed.', tone: 'info' } }]
    },
    {
      name: 'Delete selected',
      intent: 'Delete the selected files.',
      emits: 'files.deleted',
      roles: ['destructive'],
      requiredStates: ['files.selectedCount', 'session.role'],
      rules: [
        { category: 'business', when: { path: 'files.selectedCount', op: 'equals', value: 0 }, block: 'Select at least one file to delete.' },
        { category: 'permissions', when: { path: 'session.role', op: 'equals', value: 'viewer' }, block: 'Viewers cannot delete files.' }
      ]
    }
  ]
});

const uploader = defineBrick({
  id: FILES_IDS.uploader,
  name: 'File uploader',
  category: 'files',
  surfaceType: 'dialog_area',
  summary: 'Drag-and-drop uploader with an in-flight guard and cancel.',
  description:
    'The upload modal. Starting an upload is blocked while one is already running; cancel only works when something is uploading.',
  surfaceName: 'Upload',
  surfaceDescription: 'Add files, watch progress, and cancel in-flight uploads.',
  tags: ['files', 'upload', 'dropzone'],
  states: [
    { path: 'upload.uploading', type: 'boolean', default: false, description: 'True while a transfer is active.' },
    { path: 'upload.progress', type: 'number', default: 0, description: 'Percent complete (0-100).' },
    { path: 'upload.maxSizeMb', type: 'number', default: 25, description: 'Per-file size cap in MB.' }
  ],
  invariants: [
    { name: 'Progress is non-negative', path: 'upload.progress', op: 'greater_than', value: -1, message: 'Upload progress can never be negative.' }
  ],
  actions: [
    {
      name: 'Start upload',
      intent: 'Begin uploading a file.',
      emits: 'upload.started',
      roles: ['async'],
      requiredStates: ['upload.uploading'],
      params: [
        { name: 'fileName', type: 'string', description: 'Name of the file.', validations: [{ type: 'non_empty' }, { type: 'max_length', value: 255 }] },
        { name: 'sizeMb', type: 'number', description: 'File size in MB.', validations: [{ type: 'min', value: 0 }, { type: 'finite' }] }
      ],
      rules: [
        { category: 'async', when: { path: 'upload.uploading', op: 'is_true' }, block: 'An upload is already in progress.' },
        { category: 'business', description: 'Flag the transfer as active.', set: { path: 'upload.uploading', value: true } }
      ]
    },
    {
      name: 'Cancel upload',
      intent: 'Abort the active upload.',
      emits: 'upload.cancelled',
      roles: ['primary'],
      requiredStates: ['upload.uploading'],
      rules: [
        { category: 'business', when: { path: 'upload.uploading', op: 'is_false' }, block: 'Nothing is uploading.' },
        { category: 'business', description: 'Clear the active flag.', set: { path: 'upload.uploading', value: false } }
      ]
    }
  ]
});

export const filesBlueprints: readonly SurfaceBlueprint[] = [browser, uploader];
