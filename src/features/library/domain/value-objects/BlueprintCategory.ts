export type BlueprintCategory =
  | 'auth'
  | 'commerce'
  | 'content'
  | 'settings'
  | 'onboarding'
  | 'messaging'
  | 'social'
  | 'dashboard'
  | 'scheduling'
  | 'support'
  | 'files'
  | 'admin'
  | 'forms'
  | 'billing'
  | 'marketing'
  | 'search'
  | 'maps'
  | 'finance'
  | 'media'
  | 'learning'
  | 'crm'
  | 'productivity'
  | 'devtools'
  | 'ai'
  | 'community'
  | 'hr'
  | 'loyalty'
  | 'utility';

export const ALL_BLUEPRINT_CATEGORIES: readonly BlueprintCategory[] = [
  'auth',
  'commerce',
  'content',
  'settings',
  'onboarding',
  'messaging',
  'social',
  'dashboard',
  'scheduling',
  'support',
  'files',
  'admin',
  'forms',
  'billing',
  'marketing',
  'search',
  'maps',
  'finance',
  'media',
  'learning',
  'crm',
  'productivity',
  'devtools',
  'ai',
  'community',
  'hr',
  'loyalty',
  'utility'
];

export const blueprintCategoryLabel = (c: BlueprintCategory): string => {
  switch (c) {
    case 'auth':
      return 'Auth';
    case 'commerce':
      return 'Commerce';
    case 'content':
      return 'Content';
    case 'settings':
      return 'Settings';
    case 'onboarding':
      return 'Onboarding';
    case 'messaging':
      return 'Messaging';
    case 'social':
      return 'Social';
    case 'dashboard':
      return 'Dashboard';
    case 'scheduling':
      return 'Scheduling';
    case 'support':
      return 'Support';
    case 'files':
      return 'Files';
    case 'admin':
      return 'Admin';
    case 'forms':
      return 'Forms';
    case 'billing':
      return 'Billing';
    case 'marketing':
      return 'Marketing';
    case 'search':
      return 'Search';
    case 'maps':
      return 'Maps';
    case 'finance':
      return 'Finance';
    case 'media':
      return 'Media';
    case 'learning':
      return 'Learning';
    case 'crm':
      return 'CRM';
    case 'productivity':
      return 'Productivity';
    case 'devtools':
      return 'Developer';
    case 'ai':
      return 'AI';
    case 'community':
      return 'Community';
    case 'hr':
      return 'HR';
    case 'loyalty':
      return 'Loyalty';
    case 'utility':
      return 'Utility';
  }
};
