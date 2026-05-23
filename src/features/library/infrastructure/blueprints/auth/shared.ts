import type { Persona } from '$features/behavior-model/domain/entities/Persona';
import type { Resource } from '$features/behavior-model/domain/entities/Resource';
import {
  asPersonaId,
  asResourceId
} from '$features/behavior-model/domain/value-objects/ids';
import { asStatePath } from '$features/behavior-model/domain/value-objects/StatePath';
import { asBlueprintId } from '../../../domain/value-objects/BlueprintId';

/**
 * Canonical blueprint ids for the auth quad. Centralised so the four files
 * agree on identity (used by sibling references and the library card view).
 */
export const AUTH_BLUEPRINT_IDS = {
  signIn: asBlueprintId('library.auth.signin'),
  signUp: asBlueprintId('library.auth.signup'),
  verifyEmail: asBlueprintId('library.auth.verify_email'),
  resetPassword: asBlueprintId('library.auth.reset_password')
} as const;

/**
 * Shared resources every auth blueprint advertises. The applier dedupes by
 * name, so declaring them on each blueprint is harmless. The first one in
 * wins and subsequent identical declarations are skipped.
 */
export const authResources: readonly Resource[] = [
  {
    id: asResourceId('library-auth-res-users'),
    name: 'Users (Postgres)',
    description: 'Primary customer account records. PII; GDPR-relevant.',
    kind: 'relational_db',
    provider: 'PostgreSQL',
    scope: 'cloud',
    location: 'eu-west (configurable)',
    database: 'auth',
    container: 'users',
    field: undefined,
    sensitivity: 'confidential',
    containsPii: true,
    complianceTags: ['gdpr', 'iso27001'],
    accessMode: 'read_write',
    authentication: 'iam_role',
    encryptionAtRest: true,
    encryptionInTransit: true,
    retention: 'until account deletion + 30 days',
    owner: 'identity-team'
  },
  {
    id: asResourceId('library-auth-res-tokens'),
    name: 'Auth tokens (Redis)',
    description:
      'Short-lived cache for verification codes and password-reset tokens. TTL on each key.',
    kind: 'cache',
    provider: 'Redis',
    scope: 'cloud',
    location: 'eu-west (configurable)',
    database: 'auth-cache',
    container: 'tokens:*',
    field: undefined,
    sensitivity: 'confidential',
    containsPii: false,
    complianceTags: [],
    accessMode: 'read_write',
    authentication: 'iam_role',
    encryptionAtRest: true,
    encryptionInTransit: true,
    retention: '15 min TTL',
    owner: 'identity-team'
  }
];

/**
 * Canonical personas the auth library advertises. Personas answer "WHO is
 * using the feature?". They describe stable user identities, not the
 * transient system state for one action run (those are scenarios).
 *
 * The applier dedupes by name when blueprints are imported, so any library
 * that ships these same personas will reuse the existing entries instead of
 * creating duplicates. Naming is the key. Keep these stable.
 */
export const authPersonas: readonly Persona[] = [
  {
    id: asPersonaId('library-persona-anonymous'),
    name: 'Anonymous visitor',
    description:
      'Not signed in, no verified email. The default user on entry surfaces (sign in, sign up, public catalog).',
    stateOverrides: [
      { path: asStatePath('user.authenticated'), value: false },
      { path: asStatePath('user.emailVerified'), value: false }
    ],
    parameterOverrides: []
  },
  {
    id: asPersonaId('library-persona-authenticated'),
    name: 'Authenticated user',
    description:
      'Signed in with a verified email. The standard happy-path user across most authenticated surfaces.',
    stateOverrides: [
      { path: asStatePath('user.authenticated'), value: true },
      { path: asStatePath('user.emailVerified'), value: true },
      { path: asStatePath('user.role'), value: 'member' },
      { path: asStatePath('user.tier'), value: 'standard' }
    ],
    parameterOverrides: []
  },
  {
    id: asPersonaId('library-persona-admin'),
    name: 'Admin',
    description:
      'Authenticated, verified, role=admin. Use to test privileged actions and admin-only paths.',
    stateOverrides: [
      { path: asStatePath('user.authenticated'), value: true },
      { path: asStatePath('user.emailVerified'), value: true },
      { path: asStatePath('user.role'), value: 'admin' },
      { path: asStatePath('user.tier'), value: 'standard' }
    ],
    parameterOverrides: []
  },
  {
    id: asPersonaId('library-persona-premium'),
    name: 'Premium customer',
    description:
      'Authenticated, verified, tier=premium. Use to test tier-gated features (price overrides, exclusive content, no ads).',
    stateOverrides: [
      { path: asStatePath('user.authenticated'), value: true },
      { path: asStatePath('user.emailVerified'), value: true },
      { path: asStatePath('user.role'), value: 'member' },
      { path: asStatePath('user.tier'), value: 'premium' }
    ],
    parameterOverrides: []
  },
  {
    id: asPersonaId('library-persona-suspended'),
    name: 'Suspended account',
    description:
      'Authenticated but flagged or suspended. Use to test rules that gate sensitive actions on account status.',
    stateOverrides: [
      { path: asStatePath('user.authenticated'), value: true },
      { path: asStatePath('user.emailVerified'), value: true },
      { path: asStatePath('user.role'), value: 'member' },
      { path: asStatePath('user.tier'), value: 'standard' },
      { path: asStatePath('user.suspended'), value: true }
    ],
    parameterOverrides: []
  }
];
