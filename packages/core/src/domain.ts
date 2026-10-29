export const GROUP_TYPES = ['TRIP', 'HOME', 'DINNER', 'FAMILY', 'OFFICE', 'GENERAL'] as const;
export type GroupType = (typeof GROUP_TYPES)[number];

export const GROUP_TYPE_LABELS: Record<GroupType, string> = {
  TRIP: 'Trip',
  HOME: 'Shared home',
  DINNER: 'Dinner or outing',
  FAMILY: 'Family event',
  OFFICE: 'Office event',
  GENERAL: 'General group',
};

export const ROLES = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  MEMBER: 'Member',
  VIEWER: 'Viewer',
};

/** What each role may do inside a group. Enforced on the server; mirrored in the UI for affordances. */
export const PERMISSIONS = {
  viewGroup: ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'],
  editRecords: ['OWNER', 'ADMIN', 'MEMBER'],
  manageSettings: ['OWNER', 'ADMIN'],
  manageMembers: ['OWNER', 'ADMIN'],
  manageRoles: ['OWNER'],
  archiveGroup: ['OWNER'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role | null | undefined, permission: Permission): boolean {
  return !!role && (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export const ACCENTS = ['#386641', '#274C35', '#D58B42', '#C96F52', '#6B7F5E', '#8A6A4F', '#4C8157', '#A2674A'] as const;

export interface CategoryDef {
  id: string;
  label: string;
}

export const DEFAULT_CATEGORIES: readonly CategoryDef[] = [
  { id: 'food', label: 'Food' },
  { id: 'groceries', label: 'Groceries' },
  { id: 'transport', label: 'Transport' },
  { id: 'accommodation', label: 'Accommodation' },
  { id: 'flights', label: 'Flights and trains' },
  { id: 'activities', label: 'Activities' },
  { id: 'shopping', label: 'Shopping' },
  { id: 'utilities', label: 'Utilities' },
  { id: 'rent', label: 'Rent' },
  { id: 'tickets', label: 'Tickets' },
  { id: 'entertainment', label: 'Entertainment' },
  { id: 'medical', label: 'Medical' },
  { id: 'gifts', label: 'Gifts' },
  { id: 'events', label: 'Event costs' },
  { id: 'misc', label: 'Miscellaneous' },
];

export function categoryLabel(id: string, custom: readonly CategoryDef[] = []): string {
  return DEFAULT_CATEGORIES.find((c) => c.id === id)?.label ?? custom.find((c) => c.id === id)?.label ?? id;
}

export const SETTLEMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'UPI', 'OTHER'] as const;
export type SettlementMethod = (typeof SETTLEMENT_METHODS)[number];
export const SETTLEMENT_METHOD_LABELS: Record<SettlementMethod, string> = {
  CASH: 'Cash',
  BANK_TRANSFER: 'Bank transfer',
  UPI: 'UPI',
  OTHER: 'Other',
};

export const PLAN_TYPES = ['TRIP', 'DINNER', 'OUTING', 'BIRTHDAY', 'CELEBRATION', 'OFFICE', 'SHOPPING', 'CUSTOM'] as const;
export type PlanType = (typeof PLAN_TYPES)[number];
export const PLAN_TYPE_LABELS: Record<PlanType, string> = {
  TRIP: 'Trip',
  DINNER: 'Dinner',
  OUTING: 'Weekend outing',
  BIRTHDAY: 'Birthday',
  CELEBRATION: 'Wedding or celebration',
  OFFICE: 'Office event',
  SHOPPING: 'Group shopping',
  CUSTOM: 'Custom event',
};

export const PLAN_STATUSES = ['IDEA', 'PLANNING', 'CONFIRMED', 'COMPLETED', 'CANCELLED'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];
export const PLAN_STATUS_LABELS: Record<PlanStatus, string> = {
  IDEA: 'Idea',
  PLANNING: 'Planning',
  CONFIRMED: 'Confirmed',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const NOTIFICATION_TYPES = [
  'INVITATION',
  'EXPENSE_CREATED',
  'EXPENSE_UPDATED',
  'EXPENSE_DELETED',
  'COMMENT',
  'SETTLEMENT',
  'BUDGET_WARNING',
  'PLAN_UPCOMING',
  'POLL_DEADLINE',
  'POLL_CLOSED',
  'MEMBER_JOINED',
  'PAYMENT_REMINDER',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Notification preference keys; every key is honoured by the server when creating notifications. */
export const NOTIFICATION_PREF_KEYS = ['expenses', 'comments', 'settlements', 'budget', 'plans', 'polls', 'members'] as const;
export type NotificationPrefKey = (typeof NOTIFICATION_PREF_KEYS)[number];

export function notificationPrefKey(type: NotificationType): NotificationPrefKey | null {
  switch (type) {
    case 'EXPENSE_CREATED':
    case 'EXPENSE_UPDATED':
    case 'EXPENSE_DELETED':
      return 'expenses';
    case 'COMMENT':
      return 'comments';
    case 'SETTLEMENT':
    case 'PAYMENT_REMINDER':
      return 'settlements';
    case 'BUDGET_WARNING':
      return 'budget';
    case 'PLAN_UPCOMING':
      return 'plans';
    case 'POLL_DEADLINE':
    case 'POLL_CLOSED':
      return 'polls';
    case 'MEMBER_JOINED':
      return 'members';
    case 'INVITATION':
      return null; // invitations are always delivered in-app
  }
}
