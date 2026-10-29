/** Response shapes returned by the ShareSpace API. Money values are integer minor units. */
import type {
  BudgetStatus,
  GroupType,
  PlanStatus,
  PlanType,
  Preferences,
  Role,
  SettlementMethod,
  SettlementStatus,
  SplitMethod,
  Transfer,
  MemberBalance,
  Granularity,
} from '@sharespace/core';

export type { Preferences, Transfer, MemberBalance };

export interface User {
  id: string;
  email: string;
  name: string;
  avatarColor: string;
  createdAt: string;
}

export interface MeResponse {
  user: User | null;
  preferences: Preferences | null;
}

export interface MemberPreview {
  id: string;
  displayName: string;
  avatarColor: string | null;
}

export interface GroupCard {
  id: string;
  name: string;
  description: string | null;
  type: GroupType;
  currency: string;
  accent: string;
  archivedAt: string | null;
  createdAt: string;
  role: Role | null;
  myMemberId: string | null;
  memberCount: number;
  members: MemberPreview[];
  totalSpendingMinor: number;
  expenseCount: number;
  myNetMinor: number;
  myPaidMinor: number;
  pendingTransfers: number;
  budget: { totalMinor: number; spentMinor: number; usedBps: number; state: BudgetStatus['state'] } | null;
  upcomingPlan: { id: string; title: string; startDate: string; location: string | null } | null;
}

export interface Member {
  id: string;
  displayName: string;
  email: string | null;
  role: Role;
  status: 'ACTIVE' | 'LEFT' | 'REMOVED';
  userId: string | null;
  hasAccount: boolean;
  isYou: boolean;
  avatarColor: string | null;
  joinedAt: string;
  leftAt: string | null;
}

export interface Category {
  id: string;
  label: string;
}

export interface GroupDetail {
  group: GroupCard & { multiCurrency: boolean; ownerId: string; updatedAt: string };
  role: Role;
  myMemberId: string;
  members: Member[];
  categories: Category[];
}

export interface CreatedInvite {
  email: string;
  displayName: string;
  inviteUrl: string;
}

export interface Invitation {
  id: string;
  email: string;
  role: Role;
  memberId: string | null;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'REVOKED' | 'EXPIRED';
  expiresAt: string;
  createdAt: string;
  acceptedAt: string | null;
}

export interface IncomingInvitation extends Invitation {
  groupId: string;
  groupName: string;
  groupType: GroupType;
  invitedByName: string;
}

export interface MoneyPart {
  memberId: string;
  amountMinor: number;
}

export interface ExpenseSummary {
  id: string;
  groupId: string;
  title: string;
  amountMinor: number;
  currency: string;
  originalAmountMinor: number;
  originalCurrency: string;
  fxRate: string | null;
  date: string;
  category: string;
  splitMethod: SplitMethod;
  planId: string | null;
  payers: MoneyPart[];
  shares: MoneyPart[];
  createdById: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  version: number;
  commentCount: number;
  attachmentCount: number;
}

export interface ExpenseDetail extends Omit<ExpenseSummary, 'payers' | 'shares' | 'commentCount' | 'attachmentCount'> {
  description: string | null;
  notes: string | null;
  fxDate: string | null;
  fxSource: string | null;
  plan: { id: string; title: string } | null;
  payers: (MoneyPart & { originalAmountMinor: number })[];
  shares: (MoneyPart & { originalAmountMinor: number; inputValue: number | null })[];
  items: { id: string; description: string; quantity: number; unitPriceMinor: number; memberIds: string[] }[];
  adjustments: { taxMinor: number; serviceMinor: number; discountMinor: number };
  revisions: { id: string; version: number; action: 'CREATED' | 'UPDATED' | 'DELETED' | 'RESTORED'; summary: string; changedById: string; createdAt: string }[];
  comments: Comment[];
  attachments: Attachment[];
  updatedById: string | null;
}

export interface Comment {
  id: string;
  authorId: string;
  body: string;
  createdAt: string;
}

export interface Attachment {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedById: string;
  createdAt: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface BalancesResponse {
  currency: string;
  totalSpendingMinor: number;
  balances: MemberBalance[];
  suggestions: Transfer[];
}

export interface Settlement {
  id: string;
  groupId: string;
  fromMemberId: string;
  toMemberId: string;
  amountMinor: number;
  currency: string;
  method: SettlementMethod;
  methodNote: string | null;
  date: string;
  notes: string | null;
  status: SettlementStatus;
  recordedById: string;
  createdAt: string;
  reversedAt: string | null;
  reversedById: string | null;
  reversalReason: string | null;
}

export interface SettlementsOverview {
  groups: {
    groupId: string;
    groupName: string;
    currency: string;
    accent: string;
    role: Role;
    myMemberId: string;
    myNetMinor: number;
    suggestions: Transfer[];
  }[];
  history: Settlement[];
  members: { id: string; displayName: string; isYou: boolean }[];
}

export interface BudgetResponse {
  budget: {
    id: string;
    totalMinor: number;
    currency: string;
    startDate: string | null;
    endDate: string | null;
    warningThresholdPct: number;
    categories: { category: string; amountMinor: number }[];
    updatedAt: string;
  } | null;
  status?: BudgetStatus;
  categories?: (BudgetStatus & { category: string })[];
  byCategory?: { key: string; amountMinor: number; count: number }[];
  trend?: { key: string; amountMinor: number; cumulativeMinor: number }[];
  granularity?: Granularity;
  recent?: ExpenseSummary[];
}

export interface PlanSummary {
  id: string;
  groupId: string;
  title: string;
  description: string | null;
  type: PlanType;
  status: PlanStatus;
  startDate: string;
  endDate: string | null;
  location: string | null;
  estimatedBudgetMinor: number | null;
  participantIds: string[];
  actualSpendingMinor: number;
  expenseCount: number;
  checklistDone: number;
  checklistTotal: number;
  itineraryCount: number;
  createdById: string;
  createdAt: string;
}

export interface GlobalPlan extends PlanSummary {
  groupName: string;
  groupAccent: string;
  currency: string;
}

export interface ItineraryItem {
  id: string;
  position: number;
  title: string;
  description: string | null;
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  estimatedCostMinor: number | null;
  notes: string | null;
}

export interface ChecklistItem {
  id: string;
  position: number;
  title: string;
  assigneeMemberId: string | null;
  dueDate: string | null;
  completedAt: string | null;
  completedById: string | null;
}

export interface Poll {
  id: string;
  groupId: string;
  planId: string | null;
  question: string;
  closesAt: string | null;
  closedAt: string | null;
  allowVoteChange: boolean;
  createdById: string;
  createdAt: string;
  eligibleMemberIds: string[];
  totalVotes: number;
  options: { id: string; label: string; votes: number }[];
  myVote: string | null;
  canVote: boolean;
  isEligible: boolean;
}

export interface Activity {
  id: string;
  groupId: string;
  actorUserId: string | null;
  actorName: string;
  type: string;
  entityType: string;
  entityId: string | null;
  planId: string | null;
  summary: string;
  createdAt: string;
}

export interface PlanDetail extends PlanSummary {
  notes: string | null;
  itinerary: ItineraryItem[];
  checklist: ChecklistItem[];
  expenses: ExpenseSummary[];
  activity: Activity[];
  polls: Poll[];
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  groupId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface SearchHit {
  id: string;
  title: string;
  subtitle: string;
  link: string;
}

export interface SearchResponse {
  query: string;
  results: Record<'groups' | 'members' | 'expenses' | 'settlements' | 'plans' | 'polls', SearchHit[]>;
}

export interface Bucket {
  key: string;
  amountMinor: number;
  count: number;
}

export interface ReportResponse {
  currency: string;
  currencies: string[];
  from: string;
  to: string;
  granularity: Granularity;
  groupId: string | null;
  groups: { id: string; name: string; accent: string }[];
  excludedGroups: { id: string; name: string; currency: string }[];
  totals: { spendingMinor: number; expenseCount: number; myShareMinor: number; myPaidMinor: number; settlementsMinor: number };
  byCategory: (Bucket & { label: string })[];
  byGroup: { groupId: string; name: string; accent: string; amountMinor: number; count: number }[];
  byMember: { key: string; name: string; paidMinor: number; shareMinor: number; isYou: boolean }[];
  overTime: Bucket[];
  byPlan: { planId: string; title: string; groupId: string; estimatedMinor: number | null; actualMinor: number; count: number }[];
  budgetVsActual: { groupId: string; groupName: string; budgetMinor: number; spentMinor: number; startDate: string | null; endDate: string | null }[];
  expenses: ExpenseSummary[];
  expensesTruncated: boolean;
}

export interface DashboardResponse {
  totals: { currency: string; oweMinor: number; owedMinor: number; paidMinor: number; groupSpendingMinor: number }[];
  activeGroups: number;
  pendingSettlements: number;
  reminders: { groupId: string; groupName: string; currency: string; fromMemberId: string; toMemberId: string; amountMinor: number; direction: 'pay' | 'receive' }[];
  groups: GroupCard[];
  members: { id: string; displayName: string; isYou: boolean }[];
  recentExpenses: (ExpenseSummary & { groupName: string; groupAccent: string; myShareMinor: number })[];
  upcomingPlans: { id: string; groupId: string; groupName: string; groupAccent: string; title: string; type: PlanType; status: PlanStatus; startDate: string; endDate: string | null; location: string | null }[];
  recentActivity: (Activity & { groupName: string })[];
}

export interface Session {
  id: string;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}
