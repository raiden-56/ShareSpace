import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Card, CardContent, Pagination, Stack, Tooltip } from '@mui/material';
import { Download, Plus, Receipt, SearchX } from 'lucide-react';
import { DEFAULT_CATEGORIES, getCurrency } from '@sharespace/core';
import { useAllExpensesQuery, useGroupPlansQuery, useGroupQuery, useGroupsQuery } from '../api/api';
import type { ExpenseSummary } from '../api/types';
import { buildGroupHelpers } from '../hooks/useGroupContext';
import { downloadFile } from '../lib/download';
import { pluralize } from '../lib/format';
import { useAppDispatch } from '../store';
import { openExpenseDialog, showToast } from '../store/ui';
import { ExpenseFilters } from '../components/expenses/ExpenseFilters';
import { ExpenseList } from '../components/expenses/ExpenseList';
import { ExpenseRow } from '../components/expenses/ExpenseRow';
import { activeFilterCount, exportQueryString, PAGE_SIZE, toExpenseQuery } from '../components/expenses/filterParams';
import { ExpenseListSkeleton } from '../components/common/Skeletons';
import { EmptyState, ErrorState } from '../components/common/States';
import { PageHeader, PageTransition } from '../components/common/Layout';

/** Resolves payer names and the viewer's share from the expense's own group (cached per group). */
function GlobalExpenseRow({ expense }: { expense: ExpenseSummary }) {
  const { data } = useGroupQuery(expense.groupId);
  const helpers = useMemo(() => (data ? buildGroupHelpers(data) : null), [data]);
  return (
    <ExpenseRow
      expense={expense}
      myMemberId={helpers?.me ?? null}
      memberName={helpers?.memberName ?? (() => '…')}
      categoryName={helpers?.categoryName ?? ((id) => DEFAULT_CATEGORIES.find((c) => c.id === id)?.label ?? id)}
      context={data?.group.name}
    />
  );
}

export default function Expenses() {
  const [params, setParams] = useSearchParams();
  const dispatch = useAppDispatch();
  const [exporting, setExporting] = useState(false);
  const groupId = params.get('group') ?? '';
  const { data: groupsData } = useGroupsQuery();
  const { data: groupDetail } = useGroupQuery(groupId, { skip: !groupId });
  const { data: plans } = useGroupPlansQuery(groupId, { skip: !groupId });
  const helpers = useMemo(() => (groupDetail ? buildGroupHelpers(groupDetail) : null), [groupDetail]);
  const groups = groupsData?.groups ?? [];
  const currency = groupDetail?.group.currency ?? groups[0]?.currency ?? 'INR';
  const { decimals, symbol } = getCurrency(currency);
  const query = toExpenseQuery(params, decimals);
  const { data, error, isLoading, isFetching, refetch } = useAllExpensesQuery({ ...query, groupId: groupId || undefined });
  const filtered = activeFilterCount(params) > 0 || !!params.get('q');
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const canAdd = groups.some((g) => g.role && g.role !== 'VIEWER');

  const exportCsv = async () => {
    if (!groupId) return;
    setExporting(true);
    try {
      await downloadFile(`/api/groups/${groupId}/expenses/export.csv${exportQueryString(query)}`, 'expenses.csv');
    } catch (e) {
      dispatch(showToast({ message: e instanceof Error ? e.message : 'Export failed', severity: 'error' }));
    } finally {
      setExporting(false);
    }
  };

  return (
    <PageTransition>
      <PageHeader
        title="Expenses"
        subtitle={data ? `${pluralize(data.total, 'expense')} across ${groupId ? (groupDetail?.group.name ?? 'this group') : 'all your groups'}` : 'Every shared cost across your groups'}
        actions={
          <>
            <Tooltip title={groupId ? '' : 'Choose a group in Filters to export its expenses'}>
              <span>
                <Button variant="outlined" startIcon={<Download size={16} />} disabled={!groupId || exporting || !data || data.total === 0} onClick={() => void exportCsv()}>
                  Export CSV
                </Button>
              </span>
            </Tooltip>
            {canAdd && (
              <Button variant="contained" startIcon={<Plus size={18} />} onClick={() => dispatch(openExpenseDialog(groupId ? { groupId } : undefined))}>
                Add expense
              </Button>
            )}
          </>
        }
      />

      <ExpenseFilters
        params={params}
        onChange={(next) => setParams(next, { replace: true })}
        categories={helpers?.categories ?? [...DEFAULT_CATEGORIES]}
        members={helpers?.data.members}
        plans={plans?.plans}
        groups={groups.map((g) => ({ id: g.id, name: g.name }))}
        decimals={decimals}
        currencySymbol={symbol}
      />

      <Card>
        <CardContent sx={{ px: { xs: 1.5, sm: 2.5 }, opacity: isFetching && !isLoading ? 0.7 : 1, transition: 'opacity 120ms' }}>
          {error ? (
            <ErrorState error={error} onRetry={refetch} title="Could not load expenses" />
          ) : isLoading || !data ? (
            <ExpenseListSkeleton rows={6} />
          ) : data.items.length === 0 ? (
            filtered ? (
              <EmptyState
                compact
                icon={<SearchX size={24} />}
                title="No expenses match"
                description="Try a different search or remove some filters."
                action={<Button onClick={() => setParams(new URLSearchParams(), { replace: true })}>Clear filters</Button>}
              />
            ) : (
              <EmptyState
                icon={<Receipt size={26} />}
                title="No expenses yet"
                description={groups.length ? 'Expenses you add to any of your groups will appear here.' : 'Create a group first, then record your first shared expense.'}
                action={
                  canAdd && (
                    <Button variant="contained" startIcon={<Plus size={18} />} onClick={() => dispatch(openExpenseDialog())}>
                      Add expense
                    </Button>
                  )
                }
              />
            )
          ) : (
            <ExpenseList items={data.items} byDay={query.sort === 'date'} renderRow={(e) => <GlobalExpenseRow expense={e} />} />
          )}
        </CardContent>
      </Card>

      {data && pages > 1 && (
        <Stack alignItems="center" sx={{ mt: 2 }}>
          <Pagination
            count={pages}
            page={query.page}
            onChange={(_e, page) => {
              const next = new URLSearchParams(params);
              if (page === 1) next.delete('page');
              else next.set('page', String(page));
              setParams(next);
              window.scrollTo({ top: 0 });
            }}
            shape="rounded"
            color="primary"
            siblingCount={0}
          />
        </Stack>
      )}
    </PageTransition>
  );
}
