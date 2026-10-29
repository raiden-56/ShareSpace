import { createApi, fetchBaseQuery, type BaseQueryFn, type FetchArgs, type FetchBaseQueryError } from '@reduxjs/toolkit/query/react';
import type {
  BudgetInput,
  ExpenseInput,
  ExpenseQuery,
  ExpenseUpdateInput,
  FriendSettleInput,
  GroupCreateInput,
  ItineraryItemInput,
  PlanInput,
  PollInput,
  Preferences,
  SettlementInput,
} from '@sharespace/core';
import type {
  Activity,
  BalancesResponse,
  BudgetResponse,
  Category,
  Comment,
  CreatedInvite,
  DashboardResponse,
  ExpenseDetail,
  ExpenseSummary,
  Friend,
  FriendDetailResponse,
  GlobalPlan,
  GroupCard,
  GroupDetail,
  IncomingInvitation,
  Invitation,
  Member,
  MeResponse,
  Notification,
  Paginated,
  PlanDetail,
  PlanSummary,
  Poll,
  ReportResponse,
  SearchResponse,
  Session,
  Settlement,
  SettlementsOverview,
  User,
} from './types';
import { GUEST_MODE_ENABLED, isGuestActive } from '../guest/mode';

export const CSRF_HEADER = { 'X-Requested-With': 'ShareSpace' } as const;

export interface ApiError {
  status: number | string;
  message: string;
  code?: string;
  fields?: Record<string, string>;
}

/** Normalises any RTK Query error into a user-presentable message (never a stack trace). */
export function toApiError(error: unknown): ApiError {
  const e = error as FetchBaseQueryError | undefined;
  if (!e) return { status: 'UNKNOWN', message: 'Something went wrong.' };
  if (e.status === 'FETCH_ERROR') return { status: e.status, message: 'Could not reach ShareSpace. Check your connection and try again.' };
  if (e.status === 'PARSING_ERROR' || e.status === 'TIMEOUT_ERROR') return { status: e.status, message: 'The server returned an unexpected response. Please try again.' };
  const data = (e as { data?: { error?: { message?: string; code?: string; details?: { fields?: Record<string, string> } } } }).data;
  return {
    status: e.status,
    message: data?.error?.message ?? 'Something went wrong. Please try again.',
    code: data?.error?.code,
    fields: data?.error?.details?.fields,
  };
}

const networkQuery = fetchBaseQuery({
  baseUrl: '/api',
  credentials: 'same-origin',
  prepareHeaders: (headers) => {
    headers.set('X-Requested-With', CSRF_HEADER['X-Requested-With']);
    return headers;
  },
});

/** In guest mode (demo builds only) requests are answered in the browser from sample data. */
const baseQuery: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> = async (args, queryApi, extraOptions) => {
  if (GUEST_MODE_ENABLED && isGuestActive()) {
    const { handleGuestRequest } = await import('../guest/server');
    return handleGuestRequest(args);
  }
  return networkQuery(args, queryApi, extraOptions);
};

const qs = (params: Record<string, unknown>) => {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') search.set(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
};

type Ok = { ok: true };

/** Every mutation that moves money invalidates balances, dashboard, reports and budgets together. */
const MONEY_TAGS = ['Balances', 'Dashboard', 'Reports', 'Budget', 'Groups', 'Settlements', 'Plans', 'Activity', 'Notifications', 'Friends'] as const;

export const api = createApi({
  reducerPath: 'api',
  baseQuery,
  tagTypes: [
    'Me',
    'Preferences',
    'Sessions',
    'Groups',
    'Group',
    'Invitations',
    'MyInvitations',
    'Expenses',
    'Expense',
    'Balances',
    'Settlements',
    'Budget',
    'Plans',
    'Plan',
    'Polls',
    'Activity',
    'Notifications',
    'Dashboard',
    'Reports',
    'Friends',
  ],
  endpoints: (b) => ({
    // ---------- Auth & account ----------
    me: b.query<MeResponse, void>({ query: () => '/auth/me', providesTags: ['Me'] }),
    login: b.mutation<MeResponse, { email: string; password: string }>({
      query: (body) => ({ url: '/auth/login', method: 'POST', body }),
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        // Store the session immediately so route guards see the signed-in user before navigation.
        try {
          const { data } = await queryFulfilled;
          await dispatch(api.util.upsertQueryData('me', undefined, data));
        } catch {
          /* the form shows the error */
        }
      },
    }),
    register: b.mutation<MeResponse, { name: string; email: string; password: string }>({
      query: (body) => ({ url: '/auth/register', method: 'POST', body }),
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        // Store the session immediately so route guards see the signed-in user before navigation.
        try {
          const { data } = await queryFulfilled;
          await dispatch(api.util.upsertQueryData('me', undefined, data));
        } catch {
          /* the form shows the error */
        }
      },
    }),
    logout: b.mutation<Ok, void>({ query: () => ({ url: '/auth/logout', method: 'POST' }) }),
    forgotPassword: b.mutation<{ ok: true; emailDelivery: boolean }, { email: string }>({
      query: (body) => ({ url: '/auth/forgot-password', method: 'POST', body }),
    }),
    resetPassword: b.mutation<Ok, { token: string; password: string }>({
      query: (body) => ({ url: '/auth/reset-password', method: 'POST', body }),
    }),
    updateProfile: b.mutation<{ user: User }, { name: string; avatarColor?: string }>({
      query: (body) => ({ url: '/me/profile', method: 'PATCH', body }),
      invalidatesTags: ['Me'],
    }),
    changePassword: b.mutation<Ok, { currentPassword: string; newPassword: string }>({
      query: (body) => ({ url: '/me/password', method: 'PUT', body }),
      invalidatesTags: ['Sessions'],
    }),
    updatePreferences: b.mutation<{ preferences: Preferences }, Partial<Preferences>>({
      query: (body) => ({ url: '/me/preferences', method: 'PATCH', body }),
      async onQueryStarted(patch, { dispatch, queryFulfilled }) {
        // Apply immediately so theme and motion changes feel instant; roll back on failure.
        const undo = dispatch(
          api.util.updateQueryData('me', undefined, (draft) => {
            if (draft.preferences) {
              Object.assign(draft.preferences, patch, {
                notifications: { ...draft.preferences.notifications, ...(patch.notifications ?? {}) },
              });
            }
          }),
        );
        try {
          await queryFulfilled;
        } catch {
          undo.undo();
        }
      },
    }),
    sessions: b.query<{ sessions: Session[] }, void>({ query: () => '/me/sessions', providesTags: ['Sessions'] }),
    revokeSession: b.mutation<Ok, string>({ query: (id) => ({ url: `/me/sessions/${id}`, method: 'DELETE' }), invalidatesTags: ['Sessions'] }),
    revokeOtherSessions: b.mutation<{ revoked: number }, void>({
      query: () => ({ url: '/me/sessions/revoke-others', method: 'POST' }),
      invalidatesTags: ['Sessions'],
    }),
    deleteAccount: b.mutation<Ok, { password: string }>({ query: (body) => ({ url: '/me', method: 'DELETE', body }) }),

    // ---------- Dashboard & search ----------
    dashboard: b.query<DashboardResponse, void>({ query: () => '/dashboard', providesTags: ['Dashboard'] }),
    search: b.query<SearchResponse, string>({ query: (q) => `/search${qs({ q })}` }),
    reports: b.query<ReportResponse, { from?: string; to?: string; groupId?: string; currency?: string }>({
      query: (p) => `/reports${qs(p)}`,
      providesTags: ['Reports'],
    }),

    // ---------- Groups ----------
    groups: b.query<{ groups: GroupCard[] }, { archived?: boolean } | void>({
      query: (p) => `/groups${qs({ archived: p && p.archived ? 'true' : undefined })}`,
      providesTags: ['Groups'],
    }),
    group: b.query<GroupDetail, string>({ query: (id) => `/groups/${id}`, providesTags: (_r, _e, id) => [{ type: 'Group', id }] }),
    createGroup: b.mutation<{ group: GroupCard; invitations: CreatedInvite[] }, GroupCreateInput>({
      query: (body) => ({ url: '/groups', method: 'POST', body }),
      invalidatesTags: ['Groups', 'Dashboard'],
    }),
    updateGroup: b.mutation<{ group: { id: string } }, { groupId: string; name?: string; description?: string | null; type?: string; currency?: string; accent?: string; multiCurrency?: boolean; simplifyDebts?: boolean }>({
      query: ({ groupId, ...body }) => ({ url: `/groups/${groupId}`, method: 'PATCH', body }),
      // Simplify debts changes every suggested repayment, so balance views refresh too.
      invalidatesTags: (_r, _e, a) => [{ type: 'Group', id: a.groupId }, 'Groups', 'Dashboard', 'Activity', 'Balances', 'Settlements', 'Friends'],
    }),
    archiveGroup: b.mutation<Ok, string>({
      query: (id) => ({ url: `/groups/${id}/archive`, method: 'POST' }),
      invalidatesTags: (_r, _e, id) => [{ type: 'Group', id }, 'Groups', 'Dashboard', 'Activity'],
    }),
    restoreGroup: b.mutation<Ok, string>({
      query: (id) => ({ url: `/groups/${id}/restore`, method: 'POST' }),
      invalidatesTags: (_r, _e, id) => [{ type: 'Group', id }, 'Groups', 'Dashboard', 'Activity'],
    }),
    leaveGroup: b.mutation<Ok, string>({
      query: (id) => ({ url: `/groups/${id}/leave`, method: 'POST' }),
      invalidatesTags: ['Groups', 'Dashboard'],
    }),
    createCategory: b.mutation<{ category: Category }, { groupId: string; label: string }>({
      query: ({ groupId, label }) => ({ url: `/groups/${groupId}/categories`, method: 'POST', body: { label } }),
      invalidatesTags: (_r, _e, a) => [{ type: 'Group', id: a.groupId }],
    }),
    addMember: b.mutation<{ member: Member; inviteUrl: string | null }, { groupId: string; displayName: string; email?: string }>({
      query: ({ groupId, ...body }) => ({ url: `/groups/${groupId}/members`, method: 'POST', body }),
      invalidatesTags: (_r, _e, a) => [{ type: 'Group', id: a.groupId }, { type: 'Invitations', id: a.groupId }, 'Groups', 'Activity'],
    }),
    updateMember: b.mutation<Ok, { groupId: string; memberId: string; displayName?: string; role?: string }>({
      query: ({ groupId, memberId, ...body }) => ({ url: `/groups/${groupId}/members/${memberId}`, method: 'PATCH', body }),
      invalidatesTags: (_r, _e, a) => [{ type: 'Group', id: a.groupId }, 'Groups', 'Activity'],
    }),
    removeMember: b.mutation<Ok, { groupId: string; memberId: string }>({
      query: ({ groupId, memberId }) => ({ url: `/groups/${groupId}/members/${memberId}`, method: 'DELETE' }),
      invalidatesTags: (_r, _e, a) => [{ type: 'Group', id: a.groupId }, 'Groups', 'Activity'],
    }),
    groupInvitations: b.query<{ invitations: Invitation[] }, string>({
      query: (groupId) => `/groups/${groupId}/invitations`,
      providesTags: (_r, _e, id) => [{ type: 'Invitations', id }],
    }),
    createInvitation: b.mutation<{ invitation: Invitation; inviteUrl: string }, { groupId: string; email: string; role: 'ADMIN' | 'MEMBER' | 'VIEWER'; memberId?: string | null }>({
      query: ({ groupId, ...body }) => ({ url: `/groups/${groupId}/invitations`, method: 'POST', body }),
      invalidatesTags: (_r, _e, a) => [{ type: 'Invitations', id: a.groupId }, { type: 'Group', id: a.groupId }, 'Activity'],
    }),
    revokeInvitation: b.mutation<Ok, { groupId: string; invitationId: string }>({
      query: ({ groupId, invitationId }) => ({ url: `/groups/${groupId}/invitations/${invitationId}/revoke`, method: 'POST' }),
      invalidatesTags: (_r, _e, a) => [{ type: 'Invitations', id: a.groupId }, 'Activity'],
    }),
    invitationByToken: b.query<{ invitation: IncomingInvitation }, string>({ query: (token) => `/invitations/token/${encodeURIComponent(token)}` }),
    respondToInvitationToken: b.mutation<{ groupId: string }, { token: string; action: 'accept' | 'decline' }>({
      query: ({ token, action }) => ({ url: `/invitations/token/${encodeURIComponent(token)}/${action}`, method: 'POST' }),
      invalidatesTags: ['Groups', 'Dashboard', 'MyInvitations', 'Notifications'],
    }),
    myInvitations: b.query<{ invitations: IncomingInvitation[] }, void>({ query: () => '/invitations/mine', providesTags: ['MyInvitations'] }),
    respondToInvitation: b.mutation<{ groupId: string }, { invitationId: string; action: 'accept' | 'decline' }>({
      query: ({ invitationId, action }) => ({ url: `/invitations/${invitationId}/${action}`, method: 'POST' }),
      invalidatesTags: ['Groups', 'Dashboard', 'MyInvitations', 'Notifications'],
    }),

    // ---------- Expenses ----------
    groupExpenses: b.query<Paginated<ExpenseSummary>, { groupId: string } & ExpenseQuery>({
      query: ({ groupId, ...q }) => `/groups/${groupId}/expenses${qs(q)}`,
      providesTags: ['Expenses'],
    }),
    allExpenses: b.query<Paginated<ExpenseSummary>, { groupId?: string } & ExpenseQuery>({
      query: (q) => `/expenses${qs(q)}`,
      providesTags: ['Expenses'],
    }),
    expense: b.query<{ expense: ExpenseDetail }, { groupId: string; expenseId: string }>({
      query: ({ groupId, expenseId }) => `/groups/${groupId}/expenses/${expenseId}`,
      providesTags: (_r, _e, a) => [{ type: 'Expense', id: a.expenseId }],
    }),
    createExpense: b.mutation<{ expense: ExpenseDetail; replayed: boolean }, { groupId: string; body: ExpenseInput }>({
      query: ({ groupId, body }) => ({ url: `/groups/${groupId}/expenses`, method: 'POST', body }),
      invalidatesTags: ['Expenses', ...MONEY_TAGS],
    }),
    updateExpense: b.mutation<{ expense: ExpenseDetail }, { groupId: string; expenseId: string; body: ExpenseUpdateInput }>({
      query: ({ groupId, expenseId, body }) => ({ url: `/groups/${groupId}/expenses/${expenseId}`, method: 'PUT', body }),
      invalidatesTags: (_r, _e, a) => ['Expenses', { type: 'Expense', id: a.expenseId }, ...MONEY_TAGS],
    }),
    deleteExpense: b.mutation<Ok, { groupId: string; expenseId: string }>({
      query: ({ groupId, expenseId }) => ({ url: `/groups/${groupId}/expenses/${expenseId}`, method: 'DELETE' }),
      invalidatesTags: (_r, _e, a) => ['Expenses', { type: 'Expense', id: a.expenseId }, ...MONEY_TAGS],
    }),
    restoreExpense: b.mutation<Ok, { groupId: string; expenseId: string }>({
      query: ({ groupId, expenseId }) => ({ url: `/groups/${groupId}/expenses/${expenseId}/restore`, method: 'POST' }),
      invalidatesTags: (_r, _e, a) => ['Expenses', { type: 'Expense', id: a.expenseId }, ...MONEY_TAGS],
    }),
    addComment: b.mutation<{ comment: Comment }, { groupId: string; expenseId: string; body: string }>({
      query: ({ groupId, expenseId, body }) => ({ url: `/groups/${groupId}/expenses/${expenseId}/comments`, method: 'POST', body: { body } }),
      invalidatesTags: (_r, _e, a) => [{ type: 'Expense', id: a.expenseId }, 'Expenses'],
    }),
    deleteComment: b.mutation<Ok, { groupId: string; expenseId: string; commentId: string }>({
      query: ({ groupId, expenseId, commentId }) => ({ url: `/groups/${groupId}/expenses/${expenseId}/comments/${commentId}`, method: 'DELETE' }),
      invalidatesTags: (_r, _e, a) => [{ type: 'Expense', id: a.expenseId }, 'Expenses'],
    }),
    deleteAttachment: b.mutation<Ok, { attachmentId: string; expenseId: string }>({
      query: ({ attachmentId }) => ({ url: `/attachments/${attachmentId}`, method: 'DELETE' }),
      invalidatesTags: (_r, _e, a) => [{ type: 'Expense', id: a.expenseId }, 'Expenses', 'Activity'],
    }),

    // ---------- Balances & settlements ----------
    balances: b.query<BalancesResponse, string>({ query: (groupId) => `/groups/${groupId}/balances`, providesTags: ['Balances'] }),
    groupSettlements: b.query<{ settlements: Settlement[] }, string>({ query: (groupId) => `/groups/${groupId}/settlements`, providesTags: ['Settlements'] }),
    settlementsOverview: b.query<SettlementsOverview, void>({ query: () => '/settlements', providesTags: ['Settlements', 'Balances'] }),
    recordSettlement: b.mutation<{ settlement: Settlement; replayed: boolean }, { groupId: string; body: SettlementInput }>({
      query: ({ groupId, body }) => ({ url: `/groups/${groupId}/settlements`, method: 'POST', body }),
      invalidatesTags: [...MONEY_TAGS],
    }),
    reverseSettlement: b.mutation<{ settlement: Settlement }, { groupId: string; settlementId: string; reason: string }>({
      query: ({ groupId, settlementId, reason }) => ({ url: `/groups/${groupId}/settlements/${settlementId}/reverse`, method: 'POST', body: { reason } }),
      invalidatesTags: [...MONEY_TAGS],
    }),

    // ---------- Friends ----------
    friends: b.query<{ friends: Friend[] }, void>({ query: () => '/friends', providesTags: ['Friends'] }),
    friend: b.query<FriendDetailResponse, string>({ query: (key) => `/friends/${encodeURIComponent(key)}`, providesTags: ['Friends'] }),
    /** Settles one currency with a friend across every shared group (see friendSettleSchema). */
    settleWithFriend: b.mutation<{ settlements: Settlement[]; replayed: boolean }, { key: string; body: FriendSettleInput }>({
      query: ({ key, body }) => ({ url: `/friends/${encodeURIComponent(key)}/settle`, method: 'POST', body }),
      invalidatesTags: [...MONEY_TAGS],
    }),
    remindFriend: b.mutation<Ok, string>({
      query: (key) => ({ url: `/friends/${encodeURIComponent(key)}/remind`, method: 'POST' }),
    }),
    /** Finds or creates the private two-person group used for expenses outside any group. */
    openDirectGroup: b.mutation<{ groupId: string; created: boolean }, { key: string; currency?: string }>({
      query: ({ key, currency }) => ({ url: `/friends/${encodeURIComponent(key)}/direct`, method: 'POST', body: currency ? { currency } : {} }),
      invalidatesTags: ['Friends'],
    }),

    // ---------- Budget ----------
    budget: b.query<BudgetResponse, string>({ query: (groupId) => `/groups/${groupId}/budget`, providesTags: ['Budget'] }),
    saveBudget: b.mutation<Ok, { groupId: string; body: BudgetInput }>({
      query: ({ groupId, body }) => ({ url: `/groups/${groupId}/budget`, method: 'PUT', body }),
      invalidatesTags: ['Budget', 'Groups', 'Dashboard', 'Reports', 'Activity', 'Notifications'],
    }),
    deleteBudget: b.mutation<Ok, string>({
      query: (groupId) => ({ url: `/groups/${groupId}/budget`, method: 'DELETE' }),
      invalidatesTags: ['Budget', 'Groups', 'Dashboard', 'Reports', 'Activity'],
    }),

    // ---------- Plans ----------
    groupPlans: b.query<{ plans: PlanSummary[] }, string>({ query: (groupId) => `/groups/${groupId}/plans`, providesTags: ['Plans'] }),
    allPlans: b.query<{ plans: GlobalPlan[] }, void>({ query: () => '/plans', providesTags: ['Plans'] }),
    plan: b.query<{ plan: PlanDetail }, { groupId: string; planId: string }>({
      query: ({ groupId, planId }) => `/groups/${groupId}/plans/${planId}`,
      providesTags: (_r, _e, a) => [{ type: 'Plan', id: a.planId }, 'Plans'],
    }),
    createPlan: b.mutation<{ plan: PlanSummary }, { groupId: string; body: PlanInput }>({
      query: ({ groupId, body }) => ({ url: `/groups/${groupId}/plans`, method: 'POST', body }),
      invalidatesTags: ['Plans', 'Dashboard', 'Groups', 'Activity'],
    }),
    updatePlan: b.mutation<Ok, { groupId: string; planId: string; body: PlanInput }>({
      query: ({ groupId, planId, body }) => ({ url: `/groups/${groupId}/plans/${planId}`, method: 'PUT', body }),
      invalidatesTags: ['Plans', 'Plan', 'Dashboard', 'Groups', 'Activity'],
    }),
    deletePlan: b.mutation<Ok, { groupId: string; planId: string }>({
      query: ({ groupId, planId }) => ({ url: `/groups/${groupId}/plans/${planId}`, method: 'DELETE' }),
      invalidatesTags: ['Plans', 'Dashboard', 'Groups', 'Activity'],
    }),
    addItineraryItem: b.mutation<{ id: string }, { groupId: string; planId: string; body: ItineraryItemInput }>({
      query: ({ groupId, planId, body }) => ({ url: `/groups/${groupId}/plans/${planId}/itinerary`, method: 'POST', body }),
      invalidatesTags: (_r, _e, a) => [{ type: 'Plan', id: a.planId }, 'Activity'],
    }),
    updateItineraryItem: b.mutation<Ok, { groupId: string; planId: string; itemId: string; body: ItineraryItemInput }>({
      query: ({ groupId, planId, itemId, body }) => ({ url: `/groups/${groupId}/plans/${planId}/itinerary/${itemId}`, method: 'PUT', body }),
      invalidatesTags: (_r, _e, a) => [{ type: 'Plan', id: a.planId }],
    }),
    deleteItineraryItem: b.mutation<Ok, { groupId: string; planId: string; itemId: string }>({
      query: ({ groupId, planId, itemId }) => ({ url: `/groups/${groupId}/plans/${planId}/itinerary/${itemId}`, method: 'DELETE' }),
      invalidatesTags: (_r, _e, a) => [{ type: 'Plan', id: a.planId }],
    }),
    reorderItinerary: b.mutation<Ok, { groupId: string; planId: string; ids: string[] }>({
      query: ({ groupId, planId, ids }) => ({ url: `/groups/${groupId}/plans/${planId}/itinerary/reorder`, method: 'POST', body: { ids } }),
      async onQueryStarted({ groupId, planId, ids }, { dispatch, queryFulfilled }) {
        const undo = dispatch(
          api.util.updateQueryData('plan', { groupId, planId }, (draft) => {
            const byId = new Map(draft.plan.itinerary.map((i) => [i.id, i]));
            draft.plan.itinerary = ids.map((id, position) => ({ ...byId.get(id)!, position }));
          }),
        );
        try {
          await queryFulfilled;
        } catch {
          undo.undo();
        }
      },
    }),
    addChecklistItem: b.mutation<{ id: string }, { groupId: string; planId: string; body: { title: string; assigneeMemberId?: string | null; dueDate?: string | null } }>({
      query: ({ groupId, planId, body }) => ({ url: `/groups/${groupId}/plans/${planId}/checklist`, method: 'POST', body }),
      invalidatesTags: (_r, _e, a) => [{ type: 'Plan', id: a.planId }, 'Plans', 'Activity'],
    }),
    updateChecklistItem: b.mutation<Ok, { groupId: string; planId: string; itemId: string; body: { title?: string; assigneeMemberId?: string | null; dueDate?: string | null; completed?: boolean } }>({
      query: ({ groupId, planId, itemId, body }) => ({ url: `/groups/${groupId}/plans/${planId}/checklist/${itemId}`, method: 'PATCH', body }),
      invalidatesTags: (_r, _e, a) => [{ type: 'Plan', id: a.planId }, 'Plans', 'Activity'],
    }),
    deleteChecklistItem: b.mutation<Ok, { groupId: string; planId: string; itemId: string }>({
      query: ({ groupId, planId, itemId }) => ({ url: `/groups/${groupId}/plans/${planId}/checklist/${itemId}`, method: 'DELETE' }),
      invalidatesTags: (_r, _e, a) => [{ type: 'Plan', id: a.planId }, 'Plans'],
    }),
    reorderChecklist: b.mutation<Ok, { groupId: string; planId: string; ids: string[] }>({
      query: ({ groupId, planId, ids }) => ({ url: `/groups/${groupId}/plans/${planId}/checklist/reorder`, method: 'POST', body: { ids } }),
      async onQueryStarted({ groupId, planId, ids }, { dispatch, queryFulfilled }) {
        const undo = dispatch(
          api.util.updateQueryData('plan', { groupId, planId }, (draft) => {
            const byId = new Map(draft.plan.checklist.map((i) => [i.id, i]));
            draft.plan.checklist = ids.map((id, position) => ({ ...byId.get(id)!, position }));
          }),
        );
        try {
          await queryFulfilled;
        } catch {
          undo.undo();
        }
      },
    }),

    // ---------- Polls ----------
    polls: b.query<{ polls: Poll[] }, { groupId: string; planId?: string }>({
      query: ({ groupId, planId }) => `/groups/${groupId}/polls${qs({ planId })}`,
      providesTags: ['Polls'],
    }),
    createPoll: b.mutation<{ id: string }, { groupId: string; body: PollInput }>({
      query: ({ groupId, body }) => ({ url: `/groups/${groupId}/polls`, method: 'POST', body }),
      invalidatesTags: ['Polls', 'Plan', 'Activity'],
    }),
    vote: b.mutation<Ok, { groupId: string; pollId: string; optionId: string }>({
      query: ({ groupId, pollId, optionId }) => ({ url: `/groups/${groupId}/polls/${pollId}/vote`, method: 'POST', body: { optionId } }),
      invalidatesTags: ['Polls', 'Plan'],
    }),
    retractVote: b.mutation<Ok, { groupId: string; pollId: string }>({
      query: ({ groupId, pollId }) => ({ url: `/groups/${groupId}/polls/${pollId}/vote`, method: 'DELETE' }),
      invalidatesTags: ['Polls', 'Plan'],
    }),
    closePoll: b.mutation<Ok, { groupId: string; pollId: string }>({
      query: ({ groupId, pollId }) => ({ url: `/groups/${groupId}/polls/${pollId}/close`, method: 'POST' }),
      invalidatesTags: ['Polls', 'Plan', 'Activity', 'Notifications'],
    }),

    // ---------- Activity & notifications ----------
    activity: b.query<{ items: Activity[]; hasMore: boolean }, { groupId: string; before?: string; planId?: string }>({
      query: ({ groupId, ...p }) => `/groups/${groupId}/activity${qs(p)}`,
      providesTags: ['Activity'],
    }),
    notifications: b.query<{ items: Notification[]; unreadCount: number }, { unread?: boolean } | void>({
      query: (p) => `/notifications${qs({ unread: p && p.unread ? 'true' : undefined })}`,
      providesTags: ['Notifications'],
    }),
    unreadCount: b.query<{ unreadCount: number }, void>({ query: () => '/notifications/unread-count', providesTags: ['Notifications'] }),
    markNotification: b.mutation<Ok, { id: string; read: boolean }>({
      query: ({ id, read }) => ({ url: `/notifications/${id}/${read ? 'read' : 'unread'}`, method: 'POST' }),
      invalidatesTags: ['Notifications'],
    }),
    markAllNotificationsRead: b.mutation<Ok, void>({
      query: () => ({ url: '/notifications/read-all', method: 'POST' }),
      invalidatesTags: ['Notifications'],
    }),
  }),
});

export const {
  useMeQuery,
  useLoginMutation,
  useRegisterMutation,
  useLogoutMutation,
  useForgotPasswordMutation,
  useResetPasswordMutation,
  useUpdateProfileMutation,
  useChangePasswordMutation,
  useUpdatePreferencesMutation,
  useSessionsQuery,
  useRevokeSessionMutation,
  useRevokeOtherSessionsMutation,
  useDeleteAccountMutation,
  useDashboardQuery,
  useSearchQuery,
  useReportsQuery,
  useGroupsQuery,
  useGroupQuery,
  useCreateGroupMutation,
  useUpdateGroupMutation,
  useArchiveGroupMutation,
  useRestoreGroupMutation,
  useLeaveGroupMutation,
  useCreateCategoryMutation,
  useAddMemberMutation,
  useUpdateMemberMutation,
  useRemoveMemberMutation,
  useGroupInvitationsQuery,
  useCreateInvitationMutation,
  useRevokeInvitationMutation,
  useInvitationByTokenQuery,
  useRespondToInvitationTokenMutation,
  useMyInvitationsQuery,
  useRespondToInvitationMutation,
  useGroupExpensesQuery,
  useAllExpensesQuery,
  useExpenseQuery,
  useCreateExpenseMutation,
  useUpdateExpenseMutation,
  useDeleteExpenseMutation,
  useRestoreExpenseMutation,
  useAddCommentMutation,
  useDeleteCommentMutation,
  useDeleteAttachmentMutation,
  useBalancesQuery,
  useGroupSettlementsQuery,
  useSettlementsOverviewQuery,
  useFriendsQuery,
  useFriendQuery,
  useSettleWithFriendMutation,
  useRemindFriendMutation,
  useOpenDirectGroupMutation,
  useRecordSettlementMutation,
  useReverseSettlementMutation,
  useBudgetQuery,
  useSaveBudgetMutation,
  useDeleteBudgetMutation,
  useGroupPlansQuery,
  useAllPlansQuery,
  usePlanQuery,
  useCreatePlanMutation,
  useUpdatePlanMutation,
  useDeletePlanMutation,
  useAddItineraryItemMutation,
  useUpdateItineraryItemMutation,
  useDeleteItineraryItemMutation,
  useReorderItineraryMutation,
  useAddChecklistItemMutation,
  useUpdateChecklistItemMutation,
  useDeleteChecklistItemMutation,
  useReorderChecklistMutation,
  usePollsQuery,
  useCreatePollMutation,
  useVoteMutation,
  useRetractVoteMutation,
  useClosePollMutation,
  useActivityQuery,
  useNotificationsQuery,
  useUnreadCountQuery,
  useMarkNotificationMutation,
  useMarkAllNotificationsReadMutation,
} = api;
