import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert, Button, Card, CardContent, Pagination, Stack, Typography } from '@mui/material';
import { Download, Plus, Receipt, SearchX } from 'lucide-react';
import { getCurrency } from '@sharespace/core';
import { useGroupExpensesQuery, useGroupPlansQuery } from '../../api/api';
import { useGroupContext } from '../../hooks/useGroupContext';
import { downloadFile } from '../../lib/download';
import { pluralize } from '../../lib/format';
import { useAppDispatch } from '../../store';
import { openExpenseDialog, showToast } from '../../store/ui';
import { ExpenseFilters } from '../../components/expenses/ExpenseFilters';
import { ExpenseList } from '../../components/expenses/ExpenseList';
import { ExpenseRow } from '../../components/expenses/ExpenseRow';
import { activeFilterCount, exportQueryString, PAGE_SIZE, toExpenseQuery } from '../../components/expenses/filterParams';
import { ExpenseListSkeleton } from '../../components/common/Skeletons';
import { EmptyState, ErrorState } from '../../components/common/States';
import { PageTransition } from '../../components/common/Layout';

export default function GroupExpenses() {
  const { groupId, helpers } = useGroupContext();
  const [params, setParams] = useSearchParams();
  const dispatch = useAppDispatch();
  const [exporting, setExporting] = useState(false);
  const currency = helpers?.data.group.currency ?? 'INR';
  const { decimals, symbol } = getCurrency(currency);
  const query = toExpenseQuery(params, decimals);
  const { data, error, isLoading, isFetching, refetch } = useGroupExpensesQuery({ groupId, ...query }, { skip: !groupId });
  const { data: plans } = useGroupPlansQuery(groupId, { skip: !groupId });
  const filtered = activeFilterCount(params) > 0 || !!params.get('q');
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  const exportCsv = async () => {
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
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ mb: 2 }}>
        <Typography variant="h2" component="h2">
          Expenses
          {data && (
            <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
              {pluralize(data.total, params.get('deleted') === 'true' ? 'deleted expense' : 'expense')}
            </Typography>
          )}
        </Typography>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" startIcon={<Download size={16} />} onClick={() => void exportCsv()} disabled={exporting || !data || data.total === 0}>
            Export CSV
          </Button>
        </Stack>
      </Stack>

      {helpers && (
        <ExpenseFilters
          params={params}
          onChange={(next) => setParams(next, { replace: true })}
          categories={helpers.categories}
          members={helpers.data.members}
          plans={plans?.plans}
          decimals={decimals}
          currencySymbol={symbol}
        />
      )}

      {params.get('deleted') === 'true' && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Showing deleted expenses. They do not affect balances, budgets or reports. Open one to restore it.
        </Alert>
      )}

      <Card>
        <CardContent sx={{ px: { xs: 1.5, sm: 2.5 }, opacity: isFetching && !isLoading ? 0.7 : 1, transition: 'opacity 120ms' }}>
          {error ? (
            <ErrorState error={error} onRetry={refetch} title="Could not load expenses" />
          ) : isLoading || !data || !helpers ? (
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
                description="Record the first shared cost and ShareSpace will work out who owes whom."
                action={
                  helpers.can('editRecords') && (
                    <Button variant="contained" startIcon={<Plus size={18} />} onClick={() => dispatch(openExpenseDialog({ groupId }))}>
                      Add expense
                    </Button>
                  )
                }
              />
            )
          ) : (
            <ExpenseList
              items={data.items}
              byDay={query.sort === 'date'}
              renderRow={(e) => <ExpenseRow expense={e} myMemberId={helpers.me} memberName={helpers.memberName} categoryName={helpers.categoryName} />}
            />
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
