import { useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Stack, Typography } from '@mui/material';
import { Info, Pencil, PiggyBank, Trash2 } from 'lucide-react';
import { toApiError, useBudgetQuery, useDeleteBudgetMutation } from '../../api/api';
import { useFormat } from '../../hooks/useAuth';
import { useGroupContext } from '../../hooks/useGroupContext';
import { useAppDispatch } from '../../store';
import { showToast } from '../../store/ui';
import { PageTransition, SectionCard, StatTile } from '../../components/common/Layout';
import { EmptyState, ErrorState } from '../../components/common/States';
import { BudgetMeter, BudgetStateChip, CategoryIcon } from '../../components/common/Indicators';
import { AnimatedMoney, Money } from '../../components/common/Money';
import { DashboardSummarySkeleton, ReportChartSkeleton } from '../../components/common/Skeletons';
import { ConfirmDialog } from '../../components/common/ConfirmDialog';
import { ExpenseRow } from '../../components/expenses/ExpenseRow';
import { BudgetFormDialog } from '../../components/budget/BudgetFormDialog';
import { BudgetTrendChart, CategoryBreakdownChart } from '../../components/charts';

export default function GroupBudget() {
  const { groupId, helpers } = useGroupContext();
  const { data, isLoading, error, refetch } = useBudgetQuery(groupId, { skip: !groupId });
  const [formOpen, setFormOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removeBudget, { isLoading: removing }] = useDeleteBudgetMutation();
  const dispatch = useAppDispatch();
  const fmt = useFormat();

  if (error) return <ErrorState error={error} onRetry={refetch} title="Could not load the budget" />;
  if (isLoading || !data || !helpers) {
    return (
      <Stack spacing={2.5}>
        <DashboardSummarySkeleton />
        <Card>
          <CardContent>
            <ReportChartSkeleton />
          </CardContent>
        </Card>
      </Stack>
    );
  }

  const currency = helpers.data.group.currency;
  const canManage = helpers.can('manageSettings');
  const form = (
    <BudgetFormDialog
      open={formOpen}
      onClose={() => setFormOpen(false)}
      groupId={groupId}
      currency={currency}
      existing={data.budget}
      categories={helpers.categories}
    />
  );

  if (!data.budget || !data.status) {
    return (
      <PageTransition>
        <Card>
          <EmptyState
            icon={<PiggyBank size={26} />}
            title="No budget yet"
            description={
              canManage
                ? 'Set a total budget, an optional date range and category limits. ShareSpace compares them with recorded expenses and warns everyone when spending gets close.'
                : 'An owner or admin can set a budget for this group.'
            }
            action={
              canManage && (
                <Button variant="contained" startIcon={<PiggyBank size={18} />} onClick={() => setFormOpen(true)}>
                  Set a budget
                </Button>
              )
            }
          />
        </Card>
        {form}
      </PageTransition>
    );
  }

  const { budget, status } = data;
  const over = status.remainingMinor < 0;
  const period =
    budget.startDate || budget.endDate
      ? `${budget.startDate ? fmt.date(budget.startDate) : 'Any time'} – ${budget.endDate ? fmt.date(budget.endDate) : 'ongoing'}`
      : 'All recorded expenses';
  const byCategory = (data.byCategory ?? []).map((b) => ({ key: b.key, label: helpers.categoryName(b.key), amountMinor: b.amountMinor }));

  return (
    <PageTransition>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }} justifyContent="space-between" sx={{ mb: 2.5 }}>
        <Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="h2" component="h2">
              Budget
            </Typography>
            <BudgetStateChip state={status.state} />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {period} · Warning at {budget.warningThresholdPct}%
          </Typography>
        </Box>
        {canManage && (
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" startIcon={<Pencil size={16} />} onClick={() => setFormOpen(true)}>
              Edit budget
            </Button>
            <Button color="error" startIcon={<Trash2 size={16} />} onClick={() => setConfirmRemove(true)}>
              Remove
            </Button>
          </Stack>
        )}
      </Stack>

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(4, 1fr)' }, mb: 2.5 }}>
        <StatTile label="Total budget" value={<Money minor={budget.totalMinor} currency={currency} variant="h2" />} />
        <StatTile label="Recorded spending" value={<AnimatedMoney minor={status.spentMinor} currency={currency} variant="h2" />} hint="Group expenses in the budget period" />
        <StatTile
          label={over ? 'Over budget by' : 'Remaining'}
          value={<AnimatedMoney minor={Math.abs(status.remainingMinor)} currency={currency} variant="h2" sx={{ color: over ? 'error.main' : 'text.primary' }} />}
          hint={over ? 'Spending has exceeded the budget' : undefined}
        />
        <StatTile label="Used" value={<span className="tabular">{Math.floor(status.usedBps / 100)}%</span>} hint={<BudgetStateChip state={status.state} />} />
      </Box>

      <Card sx={{ mb: 2.5 }}>
        <CardContent sx={{ p: 2.5 }}>
          <BudgetMeter spentMinor={status.spentMinor} totalMinor={status.budgetMinor} usedBps={status.usedBps} state={status.state} currency={currency} />
        </CardContent>
      </Card>

      <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', lg: '3fr 2fr' }, mb: 2.5 }}>
        <SectionCard title="Spending trend" subtitle={`Cumulative recorded spending against the ${fmt.money(budget.totalMinor, currency)} budget`}>
          <BudgetTrendChart points={data.trend ?? []} budgetMinor={budget.totalMinor} currency={currency} granularity={data.granularity ?? 'day'} />
        </SectionCard>
        <SectionCard title="Category budgets" subtitle={budget.categories.length ? undefined : 'No category limits set'}>
          {(data.categories ?? []).length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {canManage ? 'Add category limits from "Edit budget" to track them here.' : 'This budget has no category limits.'}
            </Typography>
          ) : (
            <Stack spacing={2.25}>
              {(data.categories ?? []).map((c) => (
                <Stack key={c.category} direction="row" spacing={1.5} alignItems="center">
                  <CategoryIcon category={c.category} size={34} />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" justifyContent="space-between" spacing={1}>
                      <Typography variant="subtitle1" noWrap>
                        {helpers.categoryName(c.category)}
                      </Typography>
                      {c.state !== 'NORMAL' && <BudgetStateChip state={c.state} />}
                    </Stack>
                    <BudgetMeter spentMinor={c.spentMinor} totalMinor={c.budgetMinor} usedBps={c.usedBps} state={c.state} currency={currency} compact />
                  </Box>
                </Stack>
              ))}
            </Stack>
          )}
        </SectionCard>
      </Box>

      <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' } }}>
        <SectionCard title="Spending by category">
          <CategoryBreakdownChart rows={byCategory} currency={currency} emptyText="No expenses recorded in the budget period yet." />
        </SectionCard>
        <SectionCard title="Recent expenses" subtitle="In the budget period">
          {(data.recent ?? []).length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No expenses recorded in the budget period yet.
            </Typography>
          ) : (
            <Stack>
              {(data.recent ?? []).map((e) => (
                <ExpenseRow key={e.id} expense={e} myMemberId={helpers.me} memberName={helpers.memberName} categoryName={helpers.categoryName} />
              ))}
            </Stack>
          )}
        </SectionCard>
      </Box>

      <Alert severity="info" icon={<Info size={18} />} sx={{ mt: 2.5 }}>
        Repayments between members are not counted as spending. Only recorded group expenses use the budget.
      </Alert>

      {form}
      <ConfirmDialog
        open={confirmRemove}
        title="Remove budget?"
        description="The budget and its category limits will be removed. Expenses are not affected, and you can set a new budget at any time."
        confirmLabel="Remove budget"
        destructive
        busy={removing}
        onClose={() => setConfirmRemove(false)}
        onConfirm={() =>
          removeBudget(groupId)
            .unwrap()
            .then(() => {
              setConfirmRemove(false);
              dispatch(showToast({ message: 'Budget removed' }));
            })
            .catch((e) => dispatch(showToast({ message: toApiError(e).message, severity: 'error' })))
        }
      />
    </PageTransition>
  );
}


