export type RuleCategory =
  | 'business'
  | 'security'
  | 'permissions'
  | 'compliance'
  | 'validation'
  | 'data'
  | 'ux_feedback'
  | 'error_handling'
  | 'async'
  | 'collaboration'
  | 'billing_quota'
  | 'audit';

export const ALL_RULE_CATEGORIES: readonly RuleCategory[] = [
  'business',
  'security',
  'permissions',
  'compliance',
  'validation',
  'data',
  'ux_feedback',
  'error_handling',
  'async',
  'collaboration',
  'billing_quota',
  'audit'
];

export const ruleCategoryLabel = (c: RuleCategory): string => {
  switch (c) {
    case 'business':
      return 'Business';
    case 'security':
      return 'Security';
    case 'permissions':
      return 'Permissions';
    case 'compliance':
      return 'Compliance';
    case 'validation':
      return 'Validation';
    case 'data':
      return 'Entity';
    case 'ux_feedback':
      return 'UX Feedback';
    case 'error_handling':
      return 'Error handling';
    case 'async':
      return 'Async';
    case 'collaboration':
      return 'Collaboration';
    case 'billing_quota':
      return 'Billing / Quota';
    case 'audit':
      return 'Audit';
  }
};
