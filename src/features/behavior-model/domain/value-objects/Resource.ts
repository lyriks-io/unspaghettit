/**
 * Enums describing a Resource. A piece of data the feature reads from
 * or writes to. Designed to be broad enough to cover databases, object
 * stores, message queues, APIs, browser storage, and external services.
 */

export type ResourceKind =
  | 'relational_db'
  | 'document_db'
  | 'key_value_store'
  | 'object_storage'
  | 'file_system'
  | 'cache'
  | 'message_queue'
  | 'event_stream'
  | 'http_api'
  | 'graphql_api'
  | 'browser_storage'
  | 'in_memory'
  | 'other';

export const ALL_RESOURCE_KINDS: readonly ResourceKind[] = [
  'relational_db',
  'document_db',
  'key_value_store',
  'object_storage',
  'file_system',
  'cache',
  'message_queue',
  'event_stream',
  'http_api',
  'graphql_api',
  'browser_storage',
  'in_memory',
  'other'
];

export const resourceKindLabel = (k: ResourceKind): string => {
  switch (k) {
    case 'relational_db':
      return 'Relational DB';
    case 'document_db':
      return 'Document DB';
    case 'key_value_store':
      return 'Key/Value store';
    case 'object_storage':
      return 'Object storage';
    case 'file_system':
      return 'File system';
    case 'cache':
      return 'Cache';
    case 'message_queue':
      return 'Message queue';
    case 'event_stream':
      return 'Event stream';
    case 'http_api':
      return 'HTTP API';
    case 'graphql_api':
      return 'GraphQL API';
    case 'browser_storage':
      return 'Browser storage';
    case 'in_memory':
      return 'In-memory';
    case 'other':
      return 'Other';
  }
};

/**
 * Hint to the editor about what the (database, container, field) triple
 * naturally maps to for this kind of resource.
 */
export const resourceTerminology = (
  k: ResourceKind
): { readonly database: string; readonly container: string; readonly field: string } => {
  switch (k) {
    case 'relational_db':
      return { database: 'Database', container: 'Table', field: 'Column' };
    case 'document_db':
      return { database: 'Database', container: 'Collection', field: 'Field' };
    case 'key_value_store':
      return { database: 'Namespace', container: 'Key prefix', field: 'Sub-key' };
    case 'object_storage':
      return { database: 'Bucket', container: 'Prefix', field: 'Object key' };
    case 'file_system':
      return { database: 'Volume', container: 'Directory', field: 'File' };
    case 'cache':
      return { database: 'Namespace', container: 'Key pattern', field: 'Field' };
    case 'message_queue':
      return { database: 'Cluster', container: 'Queue / topic', field: 'Message attribute' };
    case 'event_stream':
      return { database: 'Cluster', container: 'Stream / topic', field: 'Field' };
    case 'http_api':
      return { database: 'Base URL', container: 'Path', field: 'Field' };
    case 'graphql_api':
      return { database: 'Endpoint', container: 'Type', field: 'Field' };
    case 'browser_storage':
      return { database: 'Database', container: 'Store / key', field: 'Field' };
    case 'in_memory':
      return { database: 'Process', container: 'Module', field: 'Field' };
    case 'other':
      return { database: 'Container', container: 'Sub-container', field: 'Field' };
  }
};

export type ResourceScope = 'local' | 'external' | 'cloud' | 'on_prem';
export const ALL_RESOURCE_SCOPES: readonly ResourceScope[] = ['local', 'external', 'cloud', 'on_prem'];
export const resourceScopeLabel = (s: ResourceScope): string => {
  switch (s) {
    case 'local':
      return 'Local (browser/device)';
    case 'external':
      return 'External third-party';
    case 'cloud':
      return 'Cloud';
    case 'on_prem':
      return 'On-premise';
  }
};

export type ResourceSensitivity = 'public' | 'internal' | 'confidential' | 'restricted';
export const ALL_SENSITIVITIES: readonly ResourceSensitivity[] = [
  'public',
  'internal',
  'confidential',
  'restricted'
];
export const sensitivityLabel = (s: ResourceSensitivity): string => {
  switch (s) {
    case 'public':
      return 'Public';
    case 'internal':
      return 'Internal';
    case 'confidential':
      return 'Confidential';
    case 'restricted':
      return 'Restricted';
  }
};

export type AuthenticationMethod =
  | 'none'
  | 'api_key'
  | 'oauth2'
  | 'jwt'
  | 'basic_auth'
  | 'iam_role'
  | 'mtls'
  | 'session_cookie'
  | 'service_account';

export const ALL_AUTH_METHODS: readonly AuthenticationMethod[] = [
  'none',
  'api_key',
  'oauth2',
  'jwt',
  'basic_auth',
  'iam_role',
  'mtls',
  'session_cookie',
  'service_account'
];

export const authMethodLabel = (m: AuthenticationMethod): string => {
  switch (m) {
    case 'none':
      return 'None';
    case 'api_key':
      return 'API key';
    case 'oauth2':
      return 'OAuth 2.0';
    case 'jwt':
      return 'JWT';
    case 'basic_auth':
      return 'Basic auth';
    case 'iam_role':
      return 'IAM role';
    case 'mtls':
      return 'Mutual TLS';
    case 'session_cookie':
      return 'Session cookie';
    case 'service_account':
      return 'Service account';
  }
};

export type AccessMode = 'read' | 'write' | 'read_write';
export const ALL_ACCESS_MODES: readonly AccessMode[] = ['read', 'write', 'read_write'];
export const accessModeLabel = (m: AccessMode): string => {
  switch (m) {
    case 'read':
      return 'Read-only';
    case 'write':
      return 'Write-only';
    case 'read_write':
      return 'Read & write';
  }
};

export const COMMON_COMPLIANCE_TAGS: readonly string[] = [
  'gdpr',
  'ccpa',
  'hipaa',
  'pci_dss',
  'sox',
  'iso27001',
  'soc2',
  'ferpa',
  'coppa'
];
