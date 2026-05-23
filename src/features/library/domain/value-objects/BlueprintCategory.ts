export type BlueprintCategory =
  | 'auth'
  | 'commerce'
  | 'content'
  | 'settings'
  | 'onboarding'
  | 'utility';

export const ALL_BLUEPRINT_CATEGORIES: readonly BlueprintCategory[] = [
  'auth',
  'commerce',
  'content',
  'settings',
  'onboarding',
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
    case 'utility':
      return 'Utility';
  }
};
