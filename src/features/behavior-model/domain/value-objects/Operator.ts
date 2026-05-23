export type Operator =
  | 'equals'
  | 'not_equals'
  | 'greater_than'
  | 'lower_than'
  | 'contains'
  | 'is_true'
  | 'is_false'
  | 'exists'
  | 'does_not_exist';

export const ALL_OPERATORS: readonly Operator[] = [
  'equals',
  'not_equals',
  'greater_than',
  'lower_than',
  'contains',
  'is_true',
  'is_false',
  'exists',
  'does_not_exist'
];

export const operatorRequiresRightOperand = (op: Operator): boolean => {
  switch (op) {
    case 'is_true':
    case 'is_false':
    case 'exists':
    case 'does_not_exist':
      return false;
    default:
      return true;
  }
};

export const operatorLabel = (op: Operator): string => {
  switch (op) {
    case 'equals':
      return 'equals';
    case 'not_equals':
      return 'does not equal';
    case 'greater_than':
      return 'is greater than';
    case 'lower_than':
      return 'is lower than';
    case 'contains':
      return 'contains';
    case 'is_true':
      return 'is true';
    case 'is_false':
      return 'is false';
    case 'exists':
      return 'exists';
    case 'does_not_exist':
      return 'does not exist';
  }
};
