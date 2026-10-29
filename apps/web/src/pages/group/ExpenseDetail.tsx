import { useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { Alert, Box, Button, Card, CardContent, Chip, Divider, Link, Skeleton, Stack, Typography } from '@mui/material';
import { ArrowLeft, CalendarDays, Copy, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import type { SplitMethod } from '@sharespace/core';
import { toApiError, useDeleteExpenseMutation, useExpenseQuery, useRestoreExpenseMutation } from '../../api/api';
import type { ExpenseDetail as Expense } from '../../api/types';
import { useFormat } from '../../hooks/useAuth';
import { useGroupContext, type GroupHelpers } from '../../hooks/useGroupContext';
import { useAppDispatch } from '../../store';
import { openExpenseDialog, showToast } from '../../store/ui';
import { CategoryIcon } from '../../components/common/Indicators';
import { BalanceInline, Money } from '../../components/common/Money';
import { MemberAvatar } from '../../components/common/MemberAvatar';
import { ConfirmDialog } from '../../components/common/ConfirmDialog';
import { ErrorState } from '../../components/common/States';
import { PageTransition, SectionCard } from '../../components/common/Layout';
import { CommentsSection, HistorySection, ReceiptsSection } from '../../components/expenses/ExpenseDetailSections';

const METHOD_LABELS: Record<SplitMethod, string> = {
  EQUAL: 'Split equally',
  EXACT: 'Exact amounts',
  PERCENTAGE: 'By percentage',
  SHARES: 'By shares',
  ITEMIZED: 'Itemized',
};

function methodInput(e: Expense, inputValue: number | null, fmtMoney: (m: number, c: string) => string): string | null {
  if (inputValue === null) return null;
  if (e.splitMethod === 'EXACT') return fmtMoney(inputValue, e.originalCurrency);
  if (e.splitMethod === 'PERCENTAGE') return `${(inputValue / 100).toFixed(2).replace(/\.?0+$/, '')}%`;
  if (e.splitMethod === 'SHARES') {
    const n = (inputValue / 100).toFixed(2).replace(/\.?0+$/, '');
    return `${n} ${n === '1' ? 'share' : 'shares'}`;
  }
  return null;
}

function Breakdown({ expense, helpers }: { expense: Expense; helpers: GroupHelpers }) {
  const fmt = useFormat();
  const ids = [...new Set([...expense.payers.map((p) => p.memberId), ...expense.shares.map((s) => s.memberId)])];
  const order = helpers.data.members.map((m) => m.id);
  ids.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return (
    <SectionCard title="Who paid and who owes" subtitle={METHOD_LABELS[expense.splitMethod]}>
      <Stack divider={<Divider flexItem />} spacing={1.25}>
        {ids.map((id) => {
          const m = helpers.memberById.get(id);
          const paid = expense.payers.find((p) => p.memberId === id)?.amountMinor ?? 0;
          const shareRow = expense.shares.find((s) => s.memberId === id);
          const share = shareRow?.amountMinor ?? 0;
          const input = shareRow ? methodInput(expense, shareRow.inputValue, fmt.money) : null;
          const name = m?.displayName ?? 'Former member';
          return (
            <Stack key={id} direction="row" spacing={1.5} alignItems="center">
              <MemberAvatar name={name} color={m?.avatarColor} size={34} placeholder={m ? !m.hasAccount : true} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="subtitle1" noWrap>
                  {m?.isYou ? `${name} (you)` : name}
                </Typography>
                <Typography variant="caption" component="p" className="tabular">
                  Paid {fmt.money(paid, expense.currency)} · Share {fmt.money(share, expense.currency)}
                  {input ? ` (${input})` : ''}
                </Typography>
              </Box>
              <Box sx={{ textAlign: 'right' }}>
                <Typography variant="caption" component="p" sx={{ display: { xs: 'none', sm: 'block' } }}>
                  Balance effect
                </Typography>
                <BalanceInline netMinor={paid - share} currency={expense.currency} you={m?.isYou} />
              </Box>
            </Stack>
          );
        })}
      </Stack>
    </SectionCard>
  );
}

function Items({ expense }: { expense: Expense }) {
  const fmt = useFormat();
  const { helpers } = useGroupContext();
  const cur = expense.originalCurrency;
  const adj = expense.adjustments;
  return (
    <SectionCard title="Items">
      <Stack spacing={1.25}>
        {expense.items.map((it) => (
          <Stack key={it.id} direction="row" spacing={1.5} alignItems="baseline">
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {it.quantity > 1 ? `${it.quantity} × ` : ''}
                {it.description}
              </Typography>
              <Typography variant="caption">{it.memberIds.map((id) => helpers?.memberName(id)).join(', ')}</Typography>
            </Box>
            <Typography variant="body2" className="tabular">
              {fmt.money(it.quantity * it.unitPriceMinor, cur)}
            </Typography>
          </Stack>
        ))}
        {(adj.taxMinor > 0 || adj.serviceMinor > 0 || adj.discountMinor > 0) && <Divider />}
        {adj.taxMinor > 0 && <AdjRow label="Tax" value={fmt.money(adj.taxMinor, cur)} />}
        {adj.serviceMinor > 0 && <AdjRow label="Service / tip" value={fmt.money(adj.serviceMinor, cur)} />}
        {adj.discountMinor > 0 && <AdjRow label="Discount" value={`− ${fmt.money(adj.discountMinor, cur)}`} />}
      </Stack>
    </SectionCard>
  );
}

function AdjRow({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction="row" justifyContent="space-between">
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" className="tabular">
        {value}
      </Typography>
    </Stack>
  );
}

export default function ExpenseDetail() {
  const { expenseId = '' } = useParams();
  const { groupId, helpers } = useGroupContext();
  const fmt = useFormat();
  const dispatch = useAppDispatch();
  const { data, error, isLoading, refetch } = useExpenseQuery({ groupId, expenseId }, { skip: !groupId || !expenseId });
  const [deleteExpense, { isLoading: deleting }] = useDeleteExpenseMutation();
  const [restoreExpense, { isLoading: restoring }] = useRestoreExpenseMutation();
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (error) return <ErrorState error={error} onRetry={refetch} title="Could not load this expense" />;
  if (isLoading || !data || !helpers) {
    return (
      <Stack spacing={2} aria-busy aria-label="Loading expense">
        <Skeleton variant="rounded" height={140} />
        <Skeleton variant="rounded" height={220} />
      </Stack>
    );
  }

  const e = data.expense;
  const canEdit = helpers.can('editRecords');
  const foreign = e.originalCurrency !== e.currency;

  return (
    <PageTransition>
      <Button component={RouterLink} to={`/groups/${groupId}/expenses`} startIcon={<ArrowLeft size={16} />} size="small" sx={{ mb: 1.5 }}>
        All expenses
      </Button>

      {e.deletedAt && (
        <Alert
          severity="warning"
          sx={{ mb: 2 }}
          action={
            canEdit && (
              <Button
                color="inherit"
                size="small"
                startIcon={<RotateCcw size={16} />}
                disabled={restoring}
                onClick={() =>
                  restoreExpense({ groupId, expenseId })
                    .unwrap()
                    .then(() => dispatch(showToast({ message: 'Expense restored' })))
                    .catch((err) => dispatch(showToast({ message: toApiError(err).message, severity: 'error' })))
                }
              >
                Restore
              </Button>
            )
          }
        >
          This expense was deleted on {fmt.date(e.deletedAt)}. It does not count towards balances, budgets or reports.
        </Alert>
      )}

      <Card sx={{ mb: 2.5 }}>
        <CardContent sx={{ p: { xs: 2, md: 3 } }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'flex-start' }}>
            <CategoryIcon category={e.category} size={52} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="h1" component="h2" sx={{ overflowWrap: 'anywhere', textDecoration: e.deletedAt ? 'line-through' : 'none' }}>
                {e.title}
              </Typography>
              <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap', rowGap: 1 }}>
                <Chip size="small" icon={<CalendarDays size={14} />} label={fmt.date(e.date)} variant="outlined" />
                <Chip size="small" label={helpers.categoryName(e.category)} variant="outlined" />
                {e.plan && <Chip size="small" label={`Plan: ${e.plan.title}`} component={RouterLink} to={`/groups/${groupId}/plans/${e.plan.id}`} clickable variant="outlined" />}
              </Stack>
              <Typography variant="caption" component="p" sx={{ mt: 1 }}>
                Added by {helpers.userName(e.createdById)} on {fmt.dateTime(e.createdAt)}
                {e.updatedById && e.version > 1 ? ` · last changed by ${helpers.userName(e.updatedById)}` : ''}
              </Typography>
            </Box>
            <Box sx={{ textAlign: { sm: 'right' } }}>
              <Money minor={e.amountMinor} currency={e.currency} variant="h1" component="p" />
              {foreign && (
                <>
                  <Typography variant="body2" className="tabular">
                    Paid {fmt.money(e.originalAmountMinor, e.originalCurrency)}
                  </Typography>
                  <Typography variant="caption" component="p">
                    Converted at a manually entered rate: 1 {e.originalCurrency} = {e.fxRate} {e.currency}
                    {e.fxDate ? ` (${fmt.date(e.fxDate)})` : ''}
                  </Typography>
                </>
              )}
            </Box>
          </Stack>

          {(e.notes || e.description) && (
            <Typography variant="body2" sx={{ mt: 2, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', p: 1.5, borderRadius: 2.5, bgcolor: 'surface.subtle' }}>
              {[e.description, e.notes].filter(Boolean).join('\n\n')}
            </Typography>
          )}

          {canEdit && (
            <Stack direction="row" spacing={1} sx={{ mt: 2.5, flexWrap: 'wrap', rowGap: 1 }}>
              {!e.deletedAt && (
                <Button variant="contained" startIcon={<Pencil size={16} />} onClick={() => dispatch(openExpenseDialog({ groupId, expenseId: e.id }))}>
                  Edit
                </Button>
              )}
              <Button variant="outlined" startIcon={<Copy size={16} />} onClick={() => dispatch(openExpenseDialog({ groupId, duplicateOfId: e.id }))}>
                Duplicate
              </Button>
              {!e.deletedAt && (
                <Button variant="outlined" color="error" startIcon={<Trash2 size={16} />} onClick={() => setConfirmDelete(true)}>
                  Delete
                </Button>
              )}
            </Stack>
          )}
        </CardContent>
      </Card>

      <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', md: '3fr 2fr' }, alignItems: 'start' }}>
        <Stack spacing={2.5} sx={{ minWidth: 0 }}>
          <Breakdown expense={e} helpers={helpers} />
          {e.splitMethod === 'ITEMIZED' && e.items.length > 0 && <Items expense={e} />}
          <CommentsSection expense={e} helpers={helpers} />
        </Stack>
        <Stack spacing={2.5} sx={{ minWidth: 0 }}>
          <ReceiptsSection expense={e} canEdit={canEdit} />
          <HistorySection expense={e} helpers={helpers} />
          {foreign && (
            <Typography variant="caption" component="p">
              Balances use the {e.currency} amount. The original {e.originalCurrency} amount is kept for reference. <Link component={RouterLink} to={`/groups/${groupId}/balances`}>View balances</Link>
            </Typography>
          )}
        </Stack>
      </Box>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this expense?"
        description="It will be removed from balances, budgets and reports. The record and its history are kept, so you can restore it later from Expenses › Filters › Show deleted."
        confirmLabel="Delete expense"
        destructive
        busy={deleting}
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          try {
            await deleteExpense({ groupId, expenseId }).unwrap();
            dispatch(showToast({ message: 'Expense deleted' }));
          } catch (err) {
            dispatch(showToast({ message: toApiError(err).message, severity: 'error' }));
          }
          setConfirmDelete(false);
        }}
      />
    </PageTransition>
  );
}
