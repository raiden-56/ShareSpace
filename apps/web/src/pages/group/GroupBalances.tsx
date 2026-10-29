import { useState } from 'react';
import {
  Box,
  Button,
  Collapse,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { formatMoney } from '@sharespace/core';
import { ChevronDown, Download, HandCoins, Info, Scale } from 'lucide-react';
import { useBalancesQuery, useGroupSettlementsQuery } from '../../api/api';
import { useGroupContext } from '../../hooks/useGroupContext';
import { useAppDispatch } from '../../store';
import { openSettleDialog, showToast } from '../../store/ui';
import { downloadFile } from '../../lib/download';
import { PageTransition, SectionCard } from '../../components/common/Layout';
import { BalanceInline, Money } from '../../components/common/Money';
import { MemberAvatar } from '../../components/common/MemberAvatar';
import { BalancePanelSkeleton, SettlementListSkeleton } from '../../components/common/Skeletons';
import { EmptyState, ErrorState } from '../../components/common/States';
import { SettlementHistory, SuggestionRow } from '../../components/settlements/SettlementParts';
import { SIMPLIFY_EXPLANATION, SimplifyDebtsControl, SimplifyModeLabel } from '../../components/groups/SimplifyDebts';

export default function GroupBalances() {
  const { groupId, helpers } = useGroupContext();
  const dispatch = useAppDispatch();
  const balances = useBalancesQuery(groupId);
  const settlements = useGroupSettlementsQuery(groupId);
  const [explain, setExplain] = useState(false);

  if (!helpers) return <BalancePanelSkeleton />;
  const currency = helpers.data.group.currency;
  const canRecord = helpers.can('editRecords');
  const name = (id: string) => (id === helpers.me ? 'You' : helpers.memberName(id));
  const simplified = balances.data?.simplifyDebts ?? helpers.data.group.simplifyDebts;

  const rows = (balances.data?.balances ?? [])
    .filter((b) => helpers.memberById.get(b.memberId)?.status === 'ACTIVE' || b.netMinor !== 0 || b.paidMinor !== 0 || b.shareMinor !== 0)
    .sort((a, b) => b.netMinor - a.netMinor);

  return (
    <PageTransition>
      <Stack spacing={2.5}>
        <SectionCard
          title="Suggested repayments"
          subtitle={
            simplified
              ? 'The fewest payments we could find to settle everyone. Nothing changes until a payment is recorded.'
              : 'Who owes whom, after netting what each pair owes each other. Nothing changes until a payment is recorded.'
          }
          action={
            canRecord && (
              <Button variant="outlined" size="small" startIcon={<HandCoins size={16} />} onClick={() => dispatch(openSettleDialog({ groupId }))}>
                Record payment
              </Button>
            )
          }
        >
          <Box sx={{ p: 1.75, mb: 2, borderRadius: 2.5, bgcolor: 'surface.sage' }} data-testid="balance-mode">
            <Typography variant="body2" sx={{ mb: 1 }}>
              All expenses and repayments in this group are combined, so each person has one balance.
            </Typography>
            <Stack spacing={1}>
              <SimplifyModeLabel simplified={simplified} />
              {helpers.can('manageSettings') ? (
                <SimplifyDebtsControl groupId={groupId} value={simplified} editable />
              ) : (
                <Typography variant="caption" component="p">
                  {simplified ? SIMPLIFY_EXPLANATION.on : SIMPLIFY_EXPLANATION.off}
                </Typography>
              )}
            </Stack>
          </Box>
          {balances.error ? (
            <ErrorState error={balances.error} onRetry={balances.refetch} />
          ) : !balances.data ? (
            <SettlementListSkeleton />
          ) : balances.data.suggestions.length === 0 ? (
            <EmptyState compact icon={<Scale size={22} />} title="Everyone is settled up" description="When someone owes money, the suggested repayments appear here." />
          ) : (
            <Stack spacing={1.25}>
              {[...balances.data.suggestions]
                .sort((a, b) => Number(b.fromMemberId === helpers.me || b.toMemberId === helpers.me) - Number(a.fromMemberId === helpers.me || a.toMemberId === helpers.me))
                .map((t) => (
                  <SuggestionRow key={`${t.fromMemberId}-${t.toMemberId}`} transfer={t} groupId={groupId} currency={currency} name={helpers.memberName} myMemberId={helpers.me} canRecord={canRecord} />
                ))}
              <Stack spacing={0.5}>
                <SimplifyModeLabel simplified={simplified} variant="caption" />
                <Typography variant="caption" component="p">
                  {simplified
                    ? 'Suggestions use a greedy method that settles the group in at most one fewer payment than the number of people with a balance. It is not guaranteed to be the absolute minimum for every situation.'
                    : 'Each suggestion is a real debt between two people. If you owe someone and they owe you, only the difference is shown.'}
                </Typography>
              </Stack>
            </Stack>
          )}
        </SectionCard>

        <SectionCard
          title="Member balances"
          subtitle={`Based on ${helpers.data.group.expenseCount} recorded ${helpers.data.group.expenseCount === 1 ? 'expense' : 'expenses'} and all recorded repayments`}
          action={
            <Button size="small" startIcon={<Info size={16} />} endIcon={<ChevronDown size={16} style={{ transform: explain ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} />} onClick={() => setExplain((v) => !v)} aria-expanded={explain}>
              How is this calculated?
            </Button>
          }
        >
          <Collapse in={explain}>
            <Box sx={{ p: 1.75, mb: 2, borderRadius: 2.5, bgcolor: 'surface.sage' }}>
              <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                Net balance = paid − share + repayments sent − repayments received
              </Typography>
              <Typography variant="body2" color="text.secondary">
                <strong>Paid</strong> is what someone contributed as a payer of expenses. <strong>Share</strong> is their allocated part of those expenses. Recorded
                repayments move the balance toward zero; reversed repayments and deleted expenses are ignored. A positive net means the group owes them; a
                negative net means they owe the group. All balances always add up to zero.
              </Typography>
            </Box>
          </Collapse>
          {balances.error ? (
            <ErrorState error={balances.error} onRetry={balances.refetch} />
          ) : !balances.data ? (
            <BalancePanelSkeleton />
          ) : (
            <>
              <Stack direction="row" spacing={3} sx={{ mb: 2 }}>
                <Box>
                  <Typography variant="caption" component="div">
                    Total group spending
                  </Typography>
                  <Money minor={balances.data.totalSpendingMinor} currency={currency} sx={{ fontSize: '1.1rem' }} />
                </Box>
              </Stack>
              <TableContainer sx={{ mx: -2.5, px: 2.5, overflowX: 'auto' }}>
                <Table size="small" aria-label="Member balances">
                  <TableHead>
                    <TableRow>
                      <TableCell>Member</TableCell>
                      <TableCell align="right" sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                        Paid
                      </TableCell>
                      <TableCell align="right" sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                        Share
                      </TableCell>
                      <TableCell align="right" sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                        Repaid
                      </TableCell>
                      <TableCell align="right" sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                        Received
                      </TableCell>
                      <TableCell align="right">Net</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.map((b) => {
                      const m = helpers.memberById.get(b.memberId);
                      return (
                        <TableRow key={b.memberId}>
                          <TableCell>
                            <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 120 }}>
                              <MemberAvatar name={m?.displayName ?? '?'} color={m?.avatarColor} size={30} placeholder={!m?.hasAccount} />
                              <Box sx={{ minWidth: 0 }}>
                                <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                                  {m?.displayName}
                                  {m?.isYou ? ' (you)' : ''}
                                </Typography>
                                {m?.status !== 'ACTIVE' && <Typography variant="caption" component="p">Left the group</Typography>}
                                <Typography variant="caption" component="p" className="tabular" sx={{ display: { sm: 'none' } }}>
                                  Paid {formatMoney(b.paidMinor, currency)} · Share {formatMoney(b.shareMinor, currency)}
                                </Typography>
                              </Box>
                            </Stack>
                          </TableCell>
                          <TableCell align="right" sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                            <Money minor={b.paidMinor} currency={currency} sx={{ fontWeight: 500 }} />
                          </TableCell>
                          <TableCell align="right" sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                            <Money minor={b.shareMinor} currency={currency} sx={{ fontWeight: 500 }} />
                          </TableCell>
                          <TableCell align="right" sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                            <Money minor={b.settlementsPaidMinor} currency={currency} sx={{ fontWeight: 500 }} />
                          </TableCell>
                          <TableCell align="right" sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                            <Money minor={b.settlementsReceivedMinor} currency={currency} sx={{ fontWeight: 500 }} />
                          </TableCell>
                          <TableCell align="right">
                            <Box sx={{ display: { xs: 'none', sm: 'block' } }}>
                              <BalanceInline netMinor={b.netMinor} currency={currency} you={m?.isYou} />
                            </Box>
                            <Box sx={{ display: { sm: 'none' } }}>
                              <BalanceInline netMinor={b.netMinor} currency={currency} you={m?.isYou} stacked />
                            </Box>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            </>
          )}
        </SectionCard>

        <SectionCard
          title="Settlement history"
          action={
            <Button
              size="small"
              startIcon={<Download size={16} />}
              onClick={() =>
                downloadFile(`/api/groups/${groupId}/settlements/export.csv`, 'settlements.csv').catch((e: Error) => dispatch(showToast({ message: e.message, severity: 'error' })))
              }
            >
              Export CSV
            </Button>
          }
        >
          {settlements.error ? (
            <ErrorState error={settlements.error} onRetry={settlements.refetch} />
          ) : !settlements.data ? (
            <SettlementListSkeleton />
          ) : settlements.data.settlements.length === 0 ? (
            <EmptyState compact icon={<HandCoins size={22} />} title="No repayments recorded yet" description="Recorded repayments appear here with their method and date." />
          ) : (
            <SettlementHistory settlements={settlements.data.settlements} name={name} userName={helpers.userName} canReverse={() => canRecord} />
          )}
        </SectionCard>
      </Stack>
    </PageTransition>
  );
}
