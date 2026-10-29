import { Box, Chip, LinearProgress, Stack, Typography } from '@mui/material';
import {
  BedDouble,
  Briefcase,
  Car,
  CircleAlert,
  CircleCheck,
  Film,
  Gift,
  House,
  PartyPopper,
  Plane,
  Shapes,
  ShoppingBag,
  ShoppingBasket,
  Stethoscope,
  Ticket,
  TriangleAlert,
  Utensils,
  Zap,
  Heart,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import type { BudgetState, GroupType, PlanStatus } from '@sharespace/core';
import { GROUP_TYPE_LABELS, PLAN_STATUS_LABELS } from '@sharespace/core';
import { formatMoney } from '@sharespace/core';

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  food: Utensils,
  groceries: ShoppingBasket,
  transport: Car,
  accommodation: BedDouble,
  flights: Plane,
  activities: PartyPopper,
  shopping: ShoppingBag,
  utilities: Zap,
  rent: House,
  tickets: Ticket,
  entertainment: Film,
  medical: Stethoscope,
  gifts: Gift,
  events: PartyPopper,
  misc: Shapes,
};

export function CategoryIcon({ category, size = 40 }: { category: string; size?: number }) {
  const Icon = CATEGORY_ICONS[category] ?? Shapes;
  return (
    <Box
      aria-hidden
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: '12px',
        display: 'grid',
        placeItems: 'center',
        bgcolor: 'surface.sage',
        color: 'primary.main',
      }}
    >
      <Icon size={size * 0.48} />
    </Box>
  );
}

const GROUP_ICONS: Record<GroupType, LucideIcon> = {
  TRIP: Plane,
  HOME: House,
  DINNER: Utensils,
  FAMILY: Heart,
  OFFICE: Briefcase,
  GENERAL: UsersRound,
};

export function GroupTypeIcon({ type, size = 18 }: { type: GroupType; size?: number }) {
  const Icon = GROUP_ICONS[type] ?? UsersRound;
  return <Icon size={size} aria-label={GROUP_TYPE_LABELS[type]} />;
}

const BUDGET_META: Record<BudgetState, { label: string; color: 'success' | 'secondary' | 'error'; Icon: LucideIcon }> = {
  NORMAL: { label: 'On track', color: 'success', Icon: CircleCheck },
  APPROACHING: { label: 'Approaching limit', color: 'secondary', Icon: TriangleAlert },
  EXCEEDED: { label: 'Over budget', color: 'error', Icon: CircleAlert },
};

/** Budget state chip: icon + text, never colour alone. */
export function BudgetStateChip({ state, size = 'small' }: { state: BudgetState; size?: 'small' | 'medium' }) {
  const meta = BUDGET_META[state];
  return (
    <Chip
      size={size}
      icon={<meta.Icon size={14} />}
      label={meta.label}
      variant="outlined"
      color={meta.color}
      sx={{ fontWeight: 600, borderColor: 'currentColor', '& .MuiChip-icon': { color: 'inherit' }, color: state === 'APPROACHING' ? 'money.attention' : undefined }}
    />
  );
}

/** Budget progress bar with a text summary (used / total, percent and state). */
export function BudgetMeter({ spentMinor, totalMinor, usedBps, state, currency, compact }: { spentMinor: number; totalMinor: number; usedBps: number; state: BudgetState; currency: string; compact?: boolean }) {
  const pct = Math.min(100, usedBps / 100);
  const color = state === 'EXCEEDED' ? 'error' : state === 'APPROACHING' ? 'secondary' : 'primary';
  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="baseline" spacing={1} sx={{ mb: 0.75 }}>
        <Typography variant="caption" component="span" className="tabular">
          {formatMoney(spentMinor, currency)} of {formatMoney(totalMinor, currency)}
        </Typography>
        <Typography variant="caption" component="span" className="tabular" sx={{ fontWeight: 700, color: state === 'NORMAL' ? 'text.secondary' : state === 'EXCEEDED' ? 'error.main' : 'money.attention' }}>
          {Math.floor(usedBps / 100)}%{!compact && state !== 'NORMAL' ? ` · ${BUDGET_META[state].label}` : ''}
        </Typography>
      </Stack>
      <LinearProgress variant="determinate" value={pct} color={color} aria-label={`Budget used: ${Math.floor(usedBps / 100)} percent, ${BUDGET_META[state].label}`} />
    </Box>
  );
}

const PLAN_STATUS_COLORS: Record<PlanStatus, string> = {
  IDEA: 'text.secondary',
  PLANNING: 'money.attention',
  CONFIRMED: 'primary.main',
  COMPLETED: 'success.main',
  CANCELLED: 'text.disabled',
};

export function PlanStatusChip({ status }: { status: PlanStatus }) {
  return (
    <Chip
      size="small"
      label={PLAN_STATUS_LABELS[status]}
      variant="outlined"
      sx={{ color: PLAN_STATUS_COLORS[status], borderColor: 'currentColor', fontWeight: 600, height: 24 }}
    />
  );
}
