import { useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Card, CardContent, Divider, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { ArrowDownLeft, ArrowRight, ArrowUpRight, CalendarDays, HandCoins, MapPin, Plus, Receipt, Users, Activity as ActivityIcon } from 'lucide-react';
import { categoryLabel, pickGranularity } from '@sharespace/core';
import { useDashboardQuery, useReportsQuery } from '../api/api';
import type { DashboardResponse } from '../api/types';
import { useAuth, useFormat } from '../hooks/useAuth';
import { useAppDispatch } from '../store';
import { openExpenseDialog, openSettleDialog, setCreateGroupOpen } from '../store/ui';
import { PageHeader, PageTransition, SectionCard } from '../components/common/Layout';
import { AnimatedMoney, Money } from '../components/common/Money';
import { DashboardSummarySkeleton, ExpenseListSkeleton, GroupCardSkeleton, ReportChartSkeleton } from '../components/common/Skeletons';
import { EmptyState, ErrorState } from '../components/common/States';
import { GroupCard } from '../components/groups/GroupCard';
import { ExpenseRow } from '../components/expenses/ExpenseRow';
import { CategoryBreakdownChart, RankedBarChart, SpendingOverTimeChart } from '../components/charts';
import { addDaysLocal, timeAgo, todayLocal } from '../lib/format';

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function Overview() {
  const { user } = useAuth();
  const dispatch = useAppDispatch();
  const { data, error, isLoading, refetch } = useDashboardQuery();

  return (
    <PageTransition>
      <PageHeader
        title={`${greeting()}, ${user?.name.split(' ')[0] ?? ''}`}
        subtitle="What you owe, what you are owed, and what to do next."
        actions={
          <>
            <Button variant="outlined" startIcon={<Users size={18} />} onClick={() => dispatch(setCreateGroupOpen(true))}>
              Create group
            </Button>
            <Button variant="contained" startIcon={<Plus size={18} />} onClick={() => dispatch(openExpenseDialog())} sx={{ display: { md: 'none' } }}>
              Add expense
            </Button>
          </>
        }
      />
      {error ? (
        <ErrorState error={error} onRetry={refetch} title="Could not load your overview" />
      ) : isLoading || !data ? (
        <Stack spacing={3}>
          <DashboardSummarySkeleton />
          <GroupCardSkeleton />
          <Card>
            <CardContent>
              <ExpenseListSkeleton rows={4} />
            </CardContent>
          </Card>
        </Stack>
      ) : data.activeGroups === 0 ? (
        <Card>
          <EmptyState
            icon={<Users size={26} />}
            title="No groups yet"
            description="Create a group for a trip, your flat or a dinner. Add people and record your first expense in under a minute."
            action={
              <Button variant="contained" startIcon={<Plus size={18} />} onClick={() => dispatch(setCreateGroupOpen(true))}>
                Create your first group
              </Button>
            }
          />
        </Card>
      ) : (
        <DashboardContent data={data} />
      )}
    </PageTransition>
  );
}

function DashboardContent({ data }: { data: DashboardResponse }) {
  const dispatch = useAppDispatch();
  const fmt = useFormat();
  const memberName = useMemo(() => {
    const map = new Map(data.members.map((m) => [m.id, m.isYou ? 'You' : m.displayName]));
    return (id: string) => map.get(id) ?? 'Former member';
  }, [data.members]);
  const myMemberByGroup = useMemo(() => new Map(data.groups.map((g) => [g.id, g.myMemberId])), [data.groups]);
  const primaryCurrency = data.totals.slice().sort((a, b) => b.groupSpendingMinor - a.groupSpendingMinor)[0]?.currency ?? 'INR';

  return (
    <Stack spacing={3}>
      {/* Financial summary: outstanding balances are separate from spending and payments. */}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(4, 1fr)' } }}>
        <SummaryTile
          label="You owe"
          tone="negative"
          values={data.totals.map((t) => ({ currency: t.currency, minor: t.oweMinor }))}
          hint="Outstanding across your groups"
        />
        <SummaryTile
          label="You are owed"
          tone="positive"
          values={data.totals.map((t) => ({ currency: t.currency, minor: t.owedMinor }))}
          hint="Outstanding across your groups"
        />
        <CountTile label="Active groups" value={data.activeGroups} hint={`${data.groups.reduce((a, g) => a + g.expenseCount, 0)} expenses recorded`} to="/groups" />
        <CountTile label="Pending settlements" value={data.pendingSettlements} hint={data.pendingSettlements ? 'Suggested repayments involving you' : 'Nothing to settle'} to="/settlements" />
      </Box>

      <Card>
        <Stack direction={{ xs: 'column', sm: 'row' }} divider={<Divider flexItem orientation="vertical" />} sx={{ '& > *': { flex: 1 } }}>
          {data.totals.map((t) => (
            <Stack key={t.currency} direction="row" spacing={3} sx={{ px: 2.5, py: 1.75 }} flexWrap="wrap" useFlexGap>
              <Box>
                <Typography variant="caption" component="div">
                  You paid in total ({t.currency})
                </Typography>
                <Money minor={t.paidMinor} currency={t.currency} sx={{ fontSize: '1rem' }} />
              </Box>
              <Box>
                <Typography variant="caption" component="div">
                  Total group spending ({t.currency})
                </Typography>
                <Money minor={t.groupSpendingMinor} currency={t.currency} sx={{ fontSize: '1rem' }} />
              </Box>
            </Stack>
          ))}
        </Stack>
      </Card>

      <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', lg: '1.35fr 1fr' }, alignItems: 'start' }}>
        <SectionCard
          title="Settle up"
          subtitle="Suggested repayments that involve you"
          action={
            <Button component={RouterLink} to="/settlements" size="small" endIcon={<ArrowRight size={16} />}>
              View settlements
            </Button>
          }
        >
          {data.reminders.length === 0 ? (
            <EmptyState compact icon={<HandCoins size={22} />} title="You are all settled up" description="When you owe someone or are owed money, it will show here." />
          ) : (
            <Stack spacing={1.25}>
              {data.reminders.slice(0, 5).map((r) => {
                const other = r.direction === 'pay' ? memberName(r.toMemberId) : memberName(r.fromMemberId);
                return (
                  <Stack key={`${r.groupId}-${r.fromMemberId}-${r.toMemberId}`} direction="row" spacing={1.5} alignItems="center" sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 2.5 }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {r.direction === 'pay' ? `You owe ${other}` : `${other} owes you`}
                      </Typography>
                      <Typography variant="caption" noWrap component="p">
                        {r.groupName}
                      </Typography>
                    </Box>
                    <Money minor={r.amountMinor} currency={r.currency} sx={{ color: r.direction === 'pay' ? 'money.negative' : 'money.positive' }} />
                    <Button
                      size="small"
                      variant={r.direction === 'pay' ? 'contained' : 'outlined'}
                      onClick={() => dispatch(openSettleDialog({ groupId: r.groupId, fromMemberId: r.fromMemberId, toMemberId: r.toMemberId, amountMinor: r.amountMinor }))}
                    >
                      Record
                    </Button>
                  </Stack>
                );
              })}
            </Stack>
          )}
        </SectionCard>

        <SectionCard title="Upcoming plans" action={<Button component={RouterLink} to="/plans" size="small" endIcon={<ArrowRight size={16} />}>All plans</Button>}>
          {data.upcomingPlans.length === 0 ? (
            <EmptyState compact icon={<CalendarDays size={22} />} title="No upcoming plans" description="Plan a trip, dinner or celebration inside any group." />
          ) : (
            <Stack spacing={1.5}>
              {data.upcomingPlans.map((p) => (
                <Stack key={p.id} component={RouterLink} to={`/groups/${p.groupId}/plans/${p.id}`} direction="row" spacing={1.5} sx={{ color: 'inherit', textDecoration: 'none', p: 1, mx: -1, borderRadius: 2, '&:hover': { bgcolor: 'action.hover' } }}>
                  <Box sx={{ width: 48, flexShrink: 0, textAlign: 'center', borderRadius: 2, py: 0.5, bgcolor: 'rgba(213,139,66,0.14)', color: 'money.attention' }}>
                    <Typography variant="caption" component="div" sx={{ color: 'inherit', fontWeight: 700, textTransform: 'uppercase', lineHeight: 1.2 }}>
                      {new Date(`${p.startDate}T00:00:00`).toLocaleDateString(undefined, { month: 'short' })}
                    </Typography>
                    <Typography sx={{ fontWeight: 800, fontSize: '1.1rem', lineHeight: 1.1 }}>{Number(p.startDate.slice(8, 10))}</Typography>
                  </Box>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="subtitle1" noWrap>
                      {p.title}
                    </Typography>
                    <Typography variant="caption" noWrap component="p">
                      {p.groupName} · {fmt.date(p.startDate)}
                      {p.endDate && p.endDate !== p.startDate ? ` – ${fmt.date(p.endDate)}` : ''}
                    </Typography>
                    {p.location && (
                      <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: 'text.secondary' }}>
                        <MapPin size={12} aria-hidden />
                        <Typography variant="caption" noWrap>
                          {p.location}
                        </Typography>
                      </Stack>
                    )}
                  </Box>
                </Stack>
              ))}
            </Stack>
          )}
        </SectionCard>
      </Box>

      <Box>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
          <Typography variant="h3" component="h2">
            Your groups
          </Typography>
          <Button component={RouterLink} to="/groups" size="small" endIcon={<ArrowRight size={16} />}>
            All groups
          </Button>
        </Stack>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' } }}>
          {data.groups.slice(0, 6).map((g) => (
            <GroupCard key={g.id} group={g} />
          ))}
        </Box>
      </Box>

      <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', lg: '1.35fr 1fr' }, alignItems: 'start' }}>
        <SpendingCard currency={primaryCurrency} hasOtherCurrencies={data.totals.length > 1} />
        <SectionCard title="Recent activity">
          {data.recentActivity.length === 0 ? (
            <EmptyState compact icon={<ActivityIcon size={22} />} title="No activity yet" />
          ) : (
            <Stack spacing={1.75} component="ol" sx={{ listStyle: 'none', p: 0, m: 0 }}>
              {data.recentActivity.map((a) => (
                <Box component="li" key={a.id}>
                  <Typography variant="body2">{a.summary}</Typography>
                  <Typography variant="caption">
                    {a.groupName} · {timeAgo(a.createdAt)}
                  </Typography>
                </Box>
              ))}
            </Stack>
          )}
        </SectionCard>
      </Box>

      <SectionCard
        title="Recent expenses"
        action={
          <Button component={RouterLink} to="/expenses" size="small" endIcon={<ArrowRight size={16} />}>
            All expenses
          </Button>
        }
      >
        {data.recentExpenses.length === 0 ? (
          <EmptyState
            compact
            icon={<Receipt size={22} />}
            title="No expenses yet"
            description="Record a shared cost and ShareSpace works out who owes what."
            action={
              <Button variant="contained" startIcon={<Plus size={18} />} onClick={() => dispatch(openExpenseDialog())}>
                Add expense
              </Button>
            }
          />
        ) : (
          <Stack divider={<Divider />}>
            {data.recentExpenses.map((e) => (
              <ExpenseRow key={e.id} expense={e} myMemberId={myMemberByGroup.get(e.groupId)} memberName={memberName} categoryName={(id) => categoryLabel(id)} context={e.groupName} />
            ))}
          </Stack>
        )}
      </SectionCard>
    </Stack>
  );
}

function SummaryTile({ label, tone, values, hint }: { label: string; tone: 'positive' | 'negative'; values: { currency: string; minor: number }[]; hint: string }) {
  const Icon = tone === 'positive' ? ArrowDownLeft : ArrowUpRight;
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent sx={{ p: 2.25, '&:last-child': { pb: 2.25 } }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ color: `money.${tone}`, mb: 0.75 }}>
          <Icon size={16} aria-hidden />
          <Typography variant="overline" component="h2" sx={{ color: 'text.secondary' }}>
            {label}
          </Typography>
        </Stack>
        {values.map((v) => (
          <Box key={v.currency}>
            <AnimatedMoney minor={v.minor} currency={v.currency} variant="h2" sx={{ color: v.minor > 0 ? `money.${tone}` : 'text.primary' }} />
          </Box>
        ))}
        <Typography variant="caption" component="p" sx={{ mt: 0.5 }}>
          {hint}
        </Typography>
      </CardContent>
    </Card>
  );
}

function CountTile({ label, value, hint, to }: { label: string; value: number; hint: string; to: string }) {
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent component={RouterLink} to={to} sx={{ display: 'block', color: 'inherit', textDecoration: 'none', p: 2.25, '&:last-child': { pb: 2.25 }, '&:hover': { bgcolor: 'action.hover' } }}>
        <Typography variant="overline" component="h2" sx={{ mb: 0.75, display: 'block' }}>
          {label}
        </Typography>
        <Typography variant="h2" component="p" className="tabular">
          {value}
        </Typography>
        <Typography variant="caption" component="p" sx={{ mt: 0.5 }}>
          {hint}
        </Typography>
      </CardContent>
    </Card>
  );
}

const RANGES = [
  { key: '30', label: '30 days', days: 30 },
  { key: '90', label: '90 days', days: 90 },
  { key: '365', label: '12 months', days: 365 },
] as const;

function SpendingCard({ currency, hasOtherCurrencies }: { currency: string; hasOtherCurrencies: boolean }) {
  const [range, setRange] = useState<(typeof RANGES)[number]['key']>('30');
  const [view, setView] = useState<'time' | 'category' | 'group'>('time');
  const days = RANGES.find((r) => r.key === range)!.days;
  const to = todayLocal();
  const from = addDaysLocal(-(days - 1));
  const { data, error, isFetching, refetch } = useReportsQuery({ from, to, currency });

  return (
    <SectionCard
      title="Group spending"
      subtitle={`Recorded expenses in ${currency}${hasOtherCurrencies ? ' (other currencies are reported separately)' : ''}`}
      action={
        <Button component={RouterLink} to="/reports" size="small" endIcon={<ArrowRight size={16} />}>
          Reports
        </Button>
      }
    >
      <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap', rowGap: 1 }}>
        <ToggleButtonGroup size="small" exclusive value={range} onChange={(_e, v) => v && setRange(v)} aria-label="Date range">
          {RANGES.map((r) => (
            <ToggleButton key={r.key} value={r.key} sx={{ px: 1.5, textTransform: 'none' }}>
              {r.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <ToggleButtonGroup size="small" exclusive value={view} onChange={(_e, v) => v && setView(v)} aria-label="Breakdown">
          <ToggleButton value="time" sx={{ px: 1.5, textTransform: 'none' }}>
            Over time
          </ToggleButton>
          <ToggleButton value="category" sx={{ px: 1.5, textTransform: 'none' }}>
            By category
          </ToggleButton>
          <ToggleButton value="group" sx={{ px: 1.5, textTransform: 'none' }}>
            By group
          </ToggleButton>
        </ToggleButtonGroup>
      </Stack>
      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !data || (isFetching && data.from !== from) ? (
        <ReportChartSkeleton height={240} />
      ) : view === 'time' ? (
        <SpendingOverTimeChart buckets={data.overTime} currency={data.currency} granularity={pickGranularity(from, to)} emptyText="No expenses recorded in this period." />
      ) : view === 'category' ? (
        <CategoryBreakdownChart rows={data.byCategory.map((c) => ({ key: c.key, label: c.label, amountMinor: c.amountMinor }))} currency={data.currency} emptyText="No expenses recorded in this period." />
      ) : (
        <RankedBarChart rows={data.byGroup.map((g) => ({ key: g.groupId, label: g.name, amountMinor: g.amountMinor }))} currency={data.currency} dimension="Group" emptyText="No expenses recorded in this period." />
      )}
    </SectionCard>
  );
}
