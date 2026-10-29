/**
 * Request schemas shared by the API (authoritative validation) and the web app (form validation).
 * All money values are integer minor units.
 */
import { z } from 'zod';
import {
  GROUP_TYPES,
  NOTIFICATION_PREF_KEYS,
  PLAN_STATUSES,
  PLAN_TYPES,
  ROLES,
  SETTLEMENT_METHODS,
} from './domain';
import { CURRENCY_CODES } from './money';
import { SPLIT_METHODS } from './split';

/** Upper bound for a single amount: 10^12 minor units (e.g. ₹10,000,000,000.00). */
export const MAX_MINOR = 1_000_000_000_000;

const trimmed = (min: number, max: number, label: string) =>
  z
    .string()
    .trim()
    .min(min, min === 1 ? `${label} is required` : `${label} must be at least ${min} characters`)
    .max(max, `${label} must be at most ${max} characters`);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be at most ${max} characters`)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const idSchema = z.string().min(1).max(64);

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, 'Enter a valid date');

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use the format HH:MM');

export const positiveMinor = z
  .number({ error: 'Enter an amount' })
  .int('Amount must be a whole number of minor units')
  .positive('Amount must be greater than zero')
  .max(MAX_MINOR, 'Amount is too large');

export const nonNegativeMinor = z.number().int().min(0).max(MAX_MINOR);

export const currencySchema = z.enum(CURRENCY_CODES, { error: 'Choose a supported currency' });
export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email('Enter a valid email address'));
export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters')
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Use at least one letter and one number');

// ---------- Auth & account ----------

export const registerSchema = z.object({
  name: trimmed(1, 80, 'Name'),
  email: emailSchema,
  password: passwordSchema,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });
export const resetPasswordSchema = z.object({ token: z.string().min(20).max(200), password: passwordSchema });
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required').max(128),
  newPassword: passwordSchema,
});

export const profileSchema = z.object({
  name: trimmed(1, 80, 'Name'),
  avatarColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
});

export const THEME_PREFS = ['light', 'dark', 'system'] as const;
export const MOTION_PREFS = ['system', 'reduce', 'full'] as const;
export const DATE_FORMATS = ['dd MMM yyyy', 'dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd'] as const;

export const preferencesSchema = z.object({
  theme: z.enum(THEME_PREFS),
  motion: z.enum(MOTION_PREFS),
  currency: currencySchema,
  dateFormat: z.enum(DATE_FORMATS),
  timeZone: z.string().min(1).max(64),
  notifications: z.object(
    Object.fromEntries(NOTIFICATION_PREF_KEYS.map((k) => [k, z.boolean()])) as Record<
      (typeof NOTIFICATION_PREF_KEYS)[number],
      z.ZodBoolean
    >,
  ),
  onboardingCompleted: z.boolean(),
});
export type Preferences = z.infer<typeof preferencesSchema>;
export const preferencesUpdateSchema = preferencesSchema.partial();

export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'system',
  motion: 'system',
  currency: 'INR',
  dateFormat: 'dd MMM yyyy',
  timeZone: 'Asia/Kolkata',
  notifications: { expenses: true, comments: true, settlements: true, budget: true, plans: true, polls: true, members: true },
  onboardingCompleted: false,
};

// ---------- Groups & members ----------

export const groupMemberDraftSchema = z.object({
  displayName: trimmed(1, 60, 'Name'),
  email: emailSchema.optional().or(z.literal('').transform(() => undefined)),
});

export const groupCreateSchema = z.object({
  name: trimmed(1, 80, 'Group name'),
  description: optionalText(500),
  type: z.enum(GROUP_TYPES),
  currency: currencySchema,
  accent: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  members: z.array(groupMemberDraftSchema).max(50).default([]),
  budgetMinor: positiveMinor.optional().nullable(),
});
export type GroupCreateInput = z.input<typeof groupCreateSchema>;

export const groupUpdateSchema = z.object({
  name: trimmed(1, 80, 'Group name').optional(),
  description: optionalText(500),
  type: z.enum(GROUP_TYPES).optional(),
  currency: currencySchema.optional(),
  accent: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  multiCurrency: z.boolean().optional(),
});

export const memberCreateSchema = groupMemberDraftSchema;
export const memberUpdateSchema = z.object({
  displayName: trimmed(1, 60, 'Name').optional(),
  role: z.enum(ROLES).optional(),
});

export const invitationCreateSchema = z.object({
  email: emailSchema,
  role: z.enum(['ADMIN', 'MEMBER', 'VIEWER']).default('MEMBER'),
  /** Link the invitation to an existing placeholder member so their history is kept. */
  memberId: idSchema.optional().nullable(),
});

export const categoryCreateSchema = z.object({ label: trimmed(1, 40, 'Category name') });

// ---------- Expenses ----------

export const splitSchema = z.object({
  method: z.enum(SPLIT_METHODS),
  participants: z
    .array(z.object({ memberId: idSchema, value: z.number().int().min(0).max(MAX_MINOR).optional() }))
    .max(100),
  items: z
    .array(
      z.object({
        description: trimmed(1, 120, 'Item description'),
        quantity: z.number().int().min(1).max(10_000),
        unitPriceMinor: nonNegativeMinor,
        memberIds: z.array(idSchema).min(1, 'Assign each item to at least one person').max(100),
      }),
    )
    .max(200)
    .optional(),
  adjustments: z
    .object({
      taxMinor: nonNegativeMinor.default(0),
      serviceMinor: nonNegativeMinor.default(0),
      discountMinor: nonNegativeMinor.default(0),
    })
    .optional(),
});
export type SplitPayload = z.infer<typeof splitSchema>;

export const expenseSchema = z.object({
  /** Client-generated idempotency key: retries with the same key never create duplicates. */
  clientRequestId: z.string().uuid(),
  title: trimmed(1, 120, 'Title'),
  description: optionalText(1000),
  notes: optionalText(2000),
  /** Amount in `currency` (the expense's original currency). */
  amountMinor: positiveMinor,
  currency: currencySchema,
  /** Required when `currency` differs from the group currency: 1 unit of `currency` = fxRate group units. */
  fxRate: z
    .string()
    .regex(/^\d{1,9}(\.\d{1,10})?$/, 'Enter a valid exchange rate')
    .optional()
    .nullable(),
  date: isoDateSchema,
  category: z.string().trim().min(1, 'Choose a category').max(40),
  planId: idSchema.optional().nullable(),
  /** Payer contributions in the expense's original currency. */
  payers: z.array(z.object({ memberId: idSchema, amountMinor: positiveMinor })).min(1, 'Select who paid').max(50),
  split: splitSchema,
});
export type ExpenseInput = z.infer<typeof expenseSchema>;

export const expenseUpdateSchema = expenseSchema.extend({
  /** Optimistic concurrency: the version the client edited. Mismatch = conflicting edit. */
  expectedVersion: z.number().int().min(1),
});
export type ExpenseUpdateInput = z.infer<typeof expenseUpdateSchema>;

export const EXPENSE_SORTS = ['date', 'amount', 'category', 'payer', 'created'] as const;

const queryNumber = z
  .union([z.string(), z.number()])
  .transform((v) => (v === '' ? undefined : Number(v)))
  .pipe(z.number().int().min(0).max(MAX_MINOR).optional());

export const expenseQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  minAmount: queryNumber.optional(),
  maxAmount: queryNumber.optional(),
  category: z.string().max(40).optional(),
  payerId: idSchema.optional(),
  participantId: idSchema.optional(),
  planId: idSchema.optional(),
  involvesMe: z.enum(['true', 'false']).optional(),
  deleted: z.enum(['true', 'false']).optional(),
  sort: z.enum(EXPENSE_SORTS).default('date'),
  order: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ExpenseQuery = z.input<typeof expenseQuerySchema>;

export const commentSchema = z.object({ body: trimmed(1, 1000, 'Comment') });

// ---------- Settlements ----------

export const settlementSchema = z.object({
  clientRequestId: z.string().uuid(),
  fromMemberId: idSchema,
  toMemberId: idSchema,
  amountMinor: positiveMinor,
  method: z.enum(SETTLEMENT_METHODS),
  methodNote: optionalText(80),
  date: isoDateSchema,
  notes: optionalText(500),
});
export type SettlementInput = z.infer<typeof settlementSchema>;

export const settlementReverseSchema = z.object({ reason: trimmed(1, 300, 'Reason') });

// ---------- Budgets ----------

export const budgetSchema = z
  .object({
    totalMinor: positiveMinor,
    startDate: isoDateSchema.optional().nullable(),
    endDate: isoDateSchema.optional().nullable(),
    warningThresholdPct: z.number().int().min(10).max(100).default(80),
    categories: z
      .array(z.object({ category: z.string().trim().min(1).max(40), amountMinor: positiveMinor }))
      .max(30)
      .default([]),
  })
  .refine((b) => !b.startDate || !b.endDate || b.startDate <= b.endDate, {
    message: 'End date must be on or after the start date',
    path: ['endDate'],
  })
  .refine((b) => new Set(b.categories.map((c) => c.category)).size === b.categories.length, {
    message: 'Each category can only have one budget',
    path: ['categories'],
  });
export type BudgetInput = z.input<typeof budgetSchema>;

// ---------- Plans ----------

export const planSchema = z
  .object({
    title: trimmed(1, 120, 'Title'),
    description: optionalText(2000),
    type: z.enum(PLAN_TYPES),
    status: z.enum(PLAN_STATUSES).default('PLANNING'),
    startDate: isoDateSchema,
    endDate: isoDateSchema.optional().nullable(),
    location: optionalText(200),
    estimatedBudgetMinor: positiveMinor.optional().nullable(),
    participantIds: z.array(idSchema).max(100).default([]),
    notes: optionalText(4000),
  })
  .refine((p) => !p.endDate || p.startDate <= p.endDate, {
    message: 'End date must be on or after the start date',
    path: ['endDate'],
  });
export type PlanInput = z.input<typeof planSchema>;

export const itineraryItemSchema = z
  .object({
    title: trimmed(1, 120, 'Title'),
    description: optionalText(1000),
    date: isoDateSchema.optional().nullable(),
    startTime: timeSchema.optional().nullable(),
    endTime: timeSchema.optional().nullable(),
    location: optionalText(200),
    estimatedCostMinor: positiveMinor.optional().nullable(),
    notes: optionalText(1000),
  })
  .refine((i) => !i.startTime || !i.endTime || i.startTime <= i.endTime, {
    message: 'End time must be after the start time',
    path: ['endTime'],
  });
export type ItineraryItemInput = z.input<typeof itineraryItemSchema>;

export const reorderSchema = z.object({ ids: z.array(idSchema).min(1).max(500) });

export const checklistItemSchema = z.object({
  title: trimmed(1, 160, 'Task'),
  assigneeMemberId: idSchema.optional().nullable(),
  dueDate: isoDateSchema.optional().nullable(),
});
export const checklistUpdateSchema = checklistItemSchema.partial().extend({ completed: z.boolean().optional() });

// ---------- Polls ----------

export const pollSchema = z.object({
  question: trimmed(1, 200, 'Question'),
  options: z
    .array(trimmed(1, 120, 'Option'))
    .min(2, 'Add at least two options')
    .max(10, 'Use at most ten options')
    .refine((opts) => new Set(opts.map((o) => o.toLowerCase())).size === opts.length, 'Options must be unique'),
  closesAt: z.iso.datetime({ offset: true }).optional().nullable(),
  /** Empty = every member with an account may vote. */
  eligibleMemberIds: z.array(idSchema).max(100).default([]),
  allowVoteChange: z.boolean().default(true),
  planId: idSchema.optional().nullable(),
});
export type PollInput = z.input<typeof pollSchema>;

export const voteSchema = z.object({ optionId: idSchema });
