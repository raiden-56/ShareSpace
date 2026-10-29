import { Link as RouterLink } from 'react-router-dom';
import { Box, ButtonBase, Card, Stack, Typography } from '@mui/material';
import { CalendarDays, ListChecks, MapPin, UsersRound } from 'lucide-react';
import { PLAN_TYPE_LABELS } from '@sharespace/core';
import type { MemberPreview, PlanSummary } from '../../api/types';
import { useFormat } from '../../hooks/useAuth';
import { pluralize } from '../../lib/format';
import { BudgetMeter, PlanStatusChip } from '../common/Indicators';
import { AvatarStack } from '../common/MemberAvatar';
import { Money } from '../common/Money';
import { formatDateRange, isPastPlan, planBudgetStatus } from './planUtils';

interface PlanCardProps {
  plan: PlanSummary;
  currency: string;
  /** Participants with names for the avatar stack; falls back to a count. */
  participants?: MemberPreview[];
  /** Shown on cross-group lists. */
  group?: { name: string; accent: string };
  variant?: 'card' | 'row';
}

function Meta({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Stack direction="row" spacing={0.75} alignItems="center" sx={{ color: 'text.secondary', minWidth: 0 }}>
      <Box component="span" aria-hidden sx={{ display: 'flex', flexShrink: 0 }}>
        {icon}
      </Box>
      <Typography variant="body2" color="text.secondary" noWrap component="span">
        {children}
      </Typography>
    </Stack>
  );
}

function GroupTag({ group }: { group: { name: string; accent: string } }) {
  return (
    <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
      <Box aria-hidden sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: group.accent, flexShrink: 0 }} />
      <Typography variant="caption" noWrap component="span" sx={{ fontWeight: 600 }}>
        {group.name}
      </Typography>
    </Stack>
  );
}

function SpendSummary({ plan, currency }: { plan: PlanSummary; currency: string }) {
  const status = planBudgetStatus(plan);
  if (status) {
    return <BudgetMeter spentMinor={status.spentMinor} totalMinor={status.budgetMinor} usedBps={status.usedBps} state={status.state} currency={currency} compact />;
  }
  return (
    <Typography variant="caption" component="p">
      {plan.actualSpendingMinor > 0 ? (
        <>
          Spent <Money minor={plan.actualSpendingMinor} currency={currency} sx={{ fontSize: 'inherit', color: 'text.primary' }} /> · no estimate set
        </>
      ) : (
        'No expenses linked yet'
      )}
    </Typography>
  );
}

export function PlanCard({ plan, currency, participants, group, variant = 'card' }: PlanCardProps) {
  const fmt = useFormat();
  const to = `/groups/${plan.groupId}/plans/${plan.id}`;
  const past = isPastPlan(plan);
  const people =
    participants && participants.length > 0 ? (
      <AvatarStack members={participants} size={24} />
    ) : (
      <Meta icon={<UsersRound size={15} />}>{pluralize(plan.participantIds.length, 'participant')}</Meta>
    );
  const tasks = plan.checklistTotal > 0 ? `${plan.checklistDone}/${plan.checklistTotal} tasks` : 'No tasks';

  if (variant === 'row') {
    return (
      <ButtonBase
        component={RouterLink}
        to={to}
        aria-label={`${plan.title}, ${formatDateRange(fmt.date, plan.startDate, plan.endDate)}`}
        sx={{ display: 'flex', width: '100%', textAlign: 'left', gap: 2, p: 1.5, borderRadius: 2.5, alignItems: 'center', opacity: past ? 0.8 : 1, '&:hover': { bgcolor: 'action.hover' } }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" noWrap>
              {plan.title}
            </Typography>
            <PlanStatusChip status={plan.status} />
          </Stack>
          <Typography variant="caption" component="p" noWrap>
            {[group?.name, PLAN_TYPE_LABELS[plan.type], formatDateRange(fmt.date, plan.startDate, plan.endDate), plan.location, tasks].filter(Boolean).join(' · ')}
          </Typography>
        </Box>
        <Box sx={{ width: { xs: 110, sm: 200 }, flexShrink: 0, display: { xs: 'none', sm: 'block' } }}>
          <SpendSummary plan={plan} currency={currency} />
        </Box>
      </ButtonBase>
    );
  }

  return (
    <Card sx={{ height: '100%', opacity: past ? 0.85 : 1 }}>
      <ButtonBase
        component={RouterLink}
        to={to}
        sx={{ display: 'block', width: '100%', height: '100%', textAlign: 'left', p: 2.5, '&:hover': { bgcolor: 'action.hover' } }}
        aria-label={`${plan.title}, ${PLAN_TYPE_LABELS[plan.type]}, ${formatDateRange(fmt.date, plan.startDate, plan.endDate)}`}
      >
        <Stack spacing={1.25} sx={{ height: '100%' }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
            <PlanStatusChip status={plan.status} />
            <Typography variant="caption" component="span" noWrap>
              {PLAN_TYPE_LABELS[plan.type]}
            </Typography>
          </Stack>
          {group && <GroupTag group={group} />}
          <Typography variant="h3" component="h3" sx={{ overflowWrap: 'anywhere' }}>
            {plan.title}
          </Typography>
          <Stack spacing={0.5}>
            <Meta icon={<CalendarDays size={15} />}>{formatDateRange(fmt.date, plan.startDate, plan.endDate)}</Meta>
            {plan.location && <Meta icon={<MapPin size={15} />}>{plan.location}</Meta>}
            <Meta icon={<ListChecks size={15} />}>{tasks}</Meta>
          </Stack>
          <Box sx={{ flex: 1 }} />
          <SpendSummary plan={plan} currency={currency} />
          <Box sx={{ display: 'flex', justifyContent: 'flex-start' }}>{people}</Box>
        </Stack>
      </ButtonBase>
    </Card>
  );
}
