import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Divider, Stack, Typography } from '@mui/material';
import { Activity as ActivityIcon, ArrowRight, CalendarDays, Plus, Receipt, Target, UserPlus } from 'lucide-react';
import { useActivityQuery, useBalancesQuery, useGroupExpensesQuery } from '../../api/api';
import { useFormat } from '../../hooks/useAuth';
import { useGroupContext } from '../../hooks/useGroupContext';
import { useAppDispatch } from '../../store';
import { openExpenseDialog } from '../../store/ui';
import { timeAgo } from '../../lib/format';
import { PageTransition, SectionCard, StatTile } from '../../components/common/Layout';
import { AnimatedMoney, BalanceInline } from '../../components/common/Money';
import { MemberAvatar } from '../../components/common/MemberAvatar';
import { BudgetMeter, BudgetStateChip } from '../../components/common/Indicators';
import { ActivityFeedSkeleton, BalancePanelSkeleton, DashboardSummarySkeleton, ExpenseListSkeleton } from '../../components/common/Skeletons';
import { EmptyState, ErrorState } from '../../components/common/States';
import { ExpenseRow } from '../../components/expenses/ExpenseRow';

export default function GroupOverview() {
  const { groupId, helpers } = useGroupContext();
  const dispatch = useAppDispatch();
  const fmt = useFormat();
  const expenses = useGroupExpensesQuery({ groupId, pageSize: 6 });
  const balances = useBalancesQuery(groupId);
  const activity = useActivityQuery({ groupId });

  if (!helpers) return <DashboardSummarySkeleton />;
  const g = helpers.data.group;
  const canEdit = helpers.can('editRecords');
  const myBalance = balances.data?.balances.find((b) => b.memberId === helpers.me);
  const placeholders = helpers.activeMembers.filter((m) => !m.hasAccount).length;

  return (
    <PageTransition>
      <Stack spacing={2.5}>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr 1fr', lg: 'repeat(4, 1fr)' } }}>
          <StatTile label="Group spending" value={<AnimatedMoney minor={g.totalSpendingMinor} currency={g.currency} variant="h2" />} hint={`${g.expenseCount} ${g.expenseCount === 1 ? 'expense' : 'expenses'}`} />
          <StatTile label="You paid" value={<AnimatedMoney minor={myBalance?.paidMinor ?? g.myPaidMinor} currency={g.currency} variant="h2" />} hint="Your contributions as payer" />
          <StatTile label="Your share" value={<AnimatedMoney minor={myBalance?.shareMinor ?? 0} currency={g.currency} variant="h2" />} hint="Your part of all expenses" />
          <StatTile label="Members" value={<Typography variant="h2" component="span" className="tabular">{g.memberCount}</Typography>} hint={placeholders ? `${placeholders} without an account yet` : 'Everyone has joined'} />
        </Box>

        <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', lg: '1.45fr 1fr' }, alignItems: 'start' }}>
          <SectionCard
            title="Recent expenses"
            action={
              <Button component={RouterLink} to={`/groups/${groupId}/expenses`} size="small" endIcon={<ArrowRight size={16} />}>
                All expenses
              </Button>
            }
          >
            {expenses.error ? (
              <ErrorState error={expenses.error} onRetry={expenses.refetch} />
            ) : !expenses.data ? (
              <ExpenseListSkeleton rows={4} />
            ) : expenses.data.items.length === 0 ? (
              <EmptyState
                compact
                icon={<Receipt size={22} />}
                title="No expenses yet"
                description="Record the first shared cost. An equal split among everyone is the default."
                action={
                  canEdit && (
                    <Button variant="contained" startIcon={<Plus size={18} />} onClick={() => dispatch(openExpenseDialog({ groupId }))}>
                      Add expense
                    </Button>
                  )
                }
              />
            ) : (
              <Stack divider={<Divider />}>
                {expenses.data.items.map((e) => (
                  <ExpenseRow key={e.id} expense={e} myMemberId={helpers.me} memberName={(id) => (id === helpers.me ? 'You' : helpers.memberName(id))} categoryName={helpers.categoryName} />
                ))}
              </Stack>
            )}
          </SectionCard>

          <Stack spacing={2.5}>
            <SectionCard
              title="Balances"
              action={
                <Button component={RouterLink} to={`/groups/${groupId}/balances`} size="small" endIcon={<ArrowRight size={16} />}>
                  Settle up
                </Button>
              }
            >
              {balances.error ? (
                <ErrorState error={balances.error} onRetry={balances.refetch} />
              ) : !balances.data ? (
                <BalancePanelSkeleton rows={3} />
              ) : (
                <Stack spacing={1.25}>
                  {balances.data.balances
                    .filter((b) => helpers.memberById.get(b.memberId)?.status === 'ACTIVE' || b.netMinor !== 0)
                    .sort((a, b) => b.netMinor - a.netMinor)
                    .slice(0, 6)
                    .map((b) => {
                      const m = helpers.memberById.get(b.memberId);
                      return (
                        <Stack key={b.memberId} direction="row" spacing={1.25} alignItems="center">
                          <MemberAvatar name={m?.displayName ?? '?'} color={m?.avatarColor} size={30} placeholder={!m?.hasAccount} />
                          <Typography variant="body2" sx={{ flex: 1, fontWeight: 600, minWidth: 0 }} noWrap>
                            {m?.isYou ? 'You' : m?.displayName}
                          </Typography>
                          <BalanceInline netMinor={b.netMinor} currency={g.currency} you={m?.isYou} />
                        </Stack>
                      );
                    })}
                  {balances.data.suggestions.length > 0 && (
                    <Typography variant="caption" component="p">
                      {balances.data.suggestions.length} suggested {balances.data.suggestions.length === 1 ? 'repayment' : 'repayments'} to settle everyone
                    </Typography>
                  )}
                </Stack>
              )}
            </SectionCard>

            <SectionCard
              title="Budget"
              action={
                <Button component={RouterLink} to={`/groups/${groupId}/budget`} size="small" endIcon={<ArrowRight size={16} />}>
                  {g.budget ? 'Details' : 'Set up'}
                </Button>
              }
            >
              {g.budget ? (
                <Stack spacing={1.5}>
                  <BudgetStateChip state={g.budget.state} />
                  <BudgetMeter {...g.budget} currency={g.currency} />
                </Stack>
              ) : (
                <Stack direction="row" spacing={1.5} alignItems="center" sx={{ color: 'text.secondary' }}>
                  <Target size={18} aria-hidden />
                  <Typography variant="body2" color="text.secondary">
                    No budget set. A budget warns the group as spending approaches the limit.
                  </Typography>
                </Stack>
              )}
            </SectionCard>

            {g.upcomingPlan && (
              <SectionCard title="Next up">
                <Stack component={RouterLink} to={`/groups/${groupId}/plans/${g.upcomingPlan.id}`} direction="row" spacing={1.5} alignItems="center" sx={{ color: 'inherit', textDecoration: 'none' }}>
                  <Box sx={{ color: 'money.attention' }}>
                    <CalendarDays size={22} aria-hidden />
                  </Box>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="subtitle1" noWrap>
                      {g.upcomingPlan.title}
                    </Typography>
                    <Typography variant="caption">
                      {fmt.date(g.upcomingPlan.startDate)}
                      {g.upcomingPlan.location ? ` · ${g.upcomingPlan.location}` : ''}
                    </Typography>
                  </Box>
                </Stack>
              </SectionCard>
            )}

            {placeholders > 0 && helpers.can('manageMembers') && !helpers.data.group.isDirect && (
              <SectionCard>
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <Box sx={{ color: 'primary.main' }}>
                    <UserPlus size={20} aria-hidden />
                  </Box>
                  <Typography variant="body2" sx={{ flex: 1 }}>
                    {placeholders} {placeholders === 1 ? 'person has' : 'people have'} not joined with an account yet.
                  </Typography>
                  <Button component={RouterLink} to={`/groups/${groupId}/members`} size="small">
                    Invite
                  </Button>
                </Stack>
              </SectionCard>
            )}
          </Stack>
        </Box>

        <SectionCard
          title="Recent activity"
          action={
            <Button component={RouterLink} to={`/groups/${groupId}/activity`} size="small" endIcon={<ArrowRight size={16} />}>
              All activity
            </Button>
          }
        >
          {activity.error ? (
            <ErrorState error={activity.error} onRetry={activity.refetch} />
          ) : !activity.data ? (
            <ActivityFeedSkeleton rows={4} />
          ) : activity.data.items.length === 0 ? (
            <EmptyState compact icon={<ActivityIcon size={22} />} title="No activity yet" />
          ) : (
            <Stack spacing={1.5} component="ol" sx={{ listStyle: 'none', p: 0, m: 0 }}>
              {activity.data.items.slice(0, 6).map((a) => (
                <Box component="li" key={a.id}>
                  <Typography variant="body2">{a.summary}</Typography>
                  <Typography variant="caption">{timeAgo(a.createdAt)}</Typography>
                </Box>
              ))}
            </Stack>
          )}
        </SectionCard>
      </Stack>
    </PageTransition>
  );
}
