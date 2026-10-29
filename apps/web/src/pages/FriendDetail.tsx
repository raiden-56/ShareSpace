import { useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { Box, Button, Card, Chip, Link, ListItemText, Menu, MenuItem, Stack, Typography } from '@mui/material';
import { ArrowLeft, BellRing, ChevronRight, HandCoins, Plus, Receipt, Users } from 'lucide-react';
import { formatMoney, SETTLEMENT_METHOD_LABELS } from '@sharespace/core';
import { toApiError, useFriendQuery, useOpenDirectGroupMutation, useRemindFriendMutation } from '../api/api';
import type { Friend, FriendGroup, Settlement } from '../api/types';
import { useFormat } from '../hooks/useAuth';
import { useAppDispatch } from '../store';
import { openExpenseDialog, showToast } from '../store/ui';
import { CategoryIcon } from '../components/common/Indicators';
import { PageHeader, PageTransition, SectionCard } from '../components/common/Layout';
import { MemberAvatar } from '../components/common/MemberAvatar';
import { SettlementListSkeleton } from '../components/common/Skeletons';
import { EmptyState, ErrorState } from '../components/common/States';
import { FriendBalance, friendNetWords } from '../components/friends/FriendBalance';
import { FriendSettleDialog } from '../components/friends/FriendSettleDialog';
import { myNetOnExpense } from '../components/friends/friendLogic';

const groupLabel = (g: FriendGroup) => (g.isDirect ? 'Outside groups' : g.groupName);

function GroupBalanceRow({ group, name }: { group: FriendGroup; name: string }) {
  const tone = group.netMinor > 0 ? 'positive' : group.netMinor < 0 ? 'negative' : 'neutral';
  return (
    <Stack
      component={RouterLink}
      to={`/groups/${group.groupId}/balances`}
      direction="row"
      spacing={1.5}
      alignItems="center"
      sx={{ py: 1.25, color: 'inherit', textDecoration: 'none', borderTop: 1, borderColor: 'divider', '&:first-of-type': { borderTop: 0 }, '&:hover .group-name': { textDecoration: 'underline' } }}
    >
      <Box aria-hidden sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: group.accent, flexShrink: 0 }} />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography className="group-name" variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
          {groupLabel(group)}
        </Typography>
        {(group.archived || group.theirStatus !== 'ACTIVE') && (
          <Typography variant="caption" component="p">
            {group.archived ? 'Archived' : `${name} left this group`}
          </Typography>
        )}
      </Box>
      <Typography variant="body2" sx={{ color: `money.${tone}`, fontWeight: 600, textAlign: 'right' }}>
        {group.netMinor === 0 ? 'settled up' : `${group.netMinor > 0 ? `${name} owes you` : `you owe ${name}`} ${formatMoney(Math.abs(group.netMinor), group.currency)}`}
      </Typography>
      <ChevronRight size={16} aria-hidden style={{ flexShrink: 0, opacity: 0.6 }} />
    </Stack>
  );
}

function RepaymentRow({ settlement, friend, date }: { settlement: Settlement; friend: Friend; date: (v: string) => string }) {
  const group = friend.groups.find((g) => g.groupId === settlement.groupId);
  const iPaid = group ? settlement.fromMemberId === group.myMemberId : false;
  const reversed = settlement.status === 'REVERSED';
  return (
    <Stack direction="row" spacing={1.5} alignItems="center" sx={{ py: 1.25, borderTop: 1, borderColor: 'divider', '&:first-of-type': { borderTop: 0 } }}>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="body2" sx={{ fontWeight: 600, textDecoration: reversed ? 'line-through' : 'none' }}>
          {iPaid ? `You paid ${friend.name}` : `${friend.name} paid you`} {formatMoney(settlement.amountMinor, settlement.currency)}
        </Typography>
        <Typography variant="caption" component="p">
          {date(settlement.date)} · {SETTLEMENT_METHOD_LABELS[settlement.method]}
          {group ? ` · ${groupLabel(group)}` : ''}
        </Typography>
      </Box>
      {reversed && <Chip size="small" variant="outlined" label="Reversed" />}
    </Stack>
  );
}

export default function FriendDetail() {
  const { friendKey = '' } = useParams();
  const dispatch = useAppDispatch();
  const fmt = useFormat();
  const { data, error, isLoading, refetch } = useFriendQuery(friendKey, { skip: !friendKey });
  const [remind, { isLoading: reminding }] = useRemindFriendMutation();
  const [openDirect, { isLoading: openingDirect }] = useOpenDirectGroupMutation();
  const [settleOpen, setSettleOpen] = useState(false);
  const [groupMenu, setGroupMenu] = useState<HTMLElement | null>(null);

  const back = (
    <Button component={RouterLink} to="/friends" size="small" startIcon={<ArrowLeft size={16} />} sx={{ px: 0, minHeight: 28 }}>
      Friends
    </Button>
  );

  if (error) {
    return (
      <PageTransition>
        <PageHeader title="Friend" eyebrow={back} />
        <ErrorState error={error} onRetry={refetch} title="Could not load this friend" />
      </PageTransition>
    );
  }
  if (isLoading || !data) {
    return (
      <PageTransition>
        <PageHeader title="Friend" eyebrow={back} />
        <SettlementListSkeleton rows={4} />
      </PageTransition>
    );
  }

  const { friend, expenses, settlements } = data;
  const owesYou = friend.balances.some((b) => b.netMinor > 0);
  const canRemind = owesYou && !!friend.userId;
  const writableGroups = friend.groups.filter((g) => !g.archived && g.role !== 'VIEWER' && g.theirStatus === 'ACTIVE');
  const groupById = new Map(friend.groups.map((g) => [g.groupId, g]));

  const sendReminder = async () => {
    try {
      await remind(friend.key).unwrap();
      dispatch(showToast({ message: `Reminder sent to ${friend.name}` }));
    } catch (e) {
      dispatch(showToast({ message: toApiError(e).message, severity: 'error' }));
    }
  };

  const addExpense = async (anchor: HTMLElement) => {
    if (!friend.userId) {
      // People added by name only exist inside their group, so the expense goes in a shared group.
      if (writableGroups.length === 1) dispatch(openExpenseDialog({ groupId: writableGroups[0]!.groupId }));
      else setGroupMenu(anchor);
      return;
    }
    try {
      const { groupId } = await openDirect({ key: friend.key }).unwrap();
      dispatch(openExpenseDialog({ groupId }));
    } catch (e) {
      dispatch(showToast({ message: toApiError(e).message, severity: 'error' }));
    }
  };

  return (
    <PageTransition>
      <PageHeader
        eyebrow={back}
        title={
          <Stack direction="row" spacing={1.5} alignItems="center" component="span" sx={{ minWidth: 0 }}>
            <MemberAvatar name={friend.name} color={friend.avatarColor} placeholder={friend.isPlaceholder} size={44} />
            <Box component="span" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
              {friend.name}
            </Box>
          </Stack>
        }
        subtitle={friend.isPlaceholder ? `Added by name${friend.email ? ` · ${friend.email}` : ''} · no ShareSpace account yet` : (friend.email ?? undefined)}
        actions={
          <>
            <Button variant="contained" startIcon={<HandCoins size={18} />} onClick={() => setSettleOpen(true)} disabled={friend.balances.length === 0}>
              Settle up
            </Button>
            {canRemind && (
              <Button variant="outlined" startIcon={<BellRing size={18} />} onClick={() => void sendReminder()} disabled={reminding}>
                Remind
              </Button>
            )}
            <Button
              variant="outlined"
              startIcon={<Plus size={18} />}
              onClick={(e) => void addExpense(e.currentTarget)}
              disabled={openingDirect || (!friend.userId && writableGroups.length === 0)}
              aria-haspopup={!friend.userId && writableGroups.length > 1 ? 'menu' : undefined}
            >
              Add expense
            </Button>
          </>
        }
      />

      <Menu anchorEl={groupMenu} open={!!groupMenu} onClose={() => setGroupMenu(null)}>
        <MenuItem disabled sx={{ opacity: '1 !important' }}>
          <Typography variant="caption">Add the expense in which group?</Typography>
        </MenuItem>
        {writableGroups.map((g) => (
          <MenuItem
            key={g.groupId}
            onClick={() => {
              setGroupMenu(null);
              dispatch(openExpenseDialog({ groupId: g.groupId }));
            }}
          >
            <ListItemText primary={g.groupName} />
          </MenuItem>
        ))}
      </Menu>

      <Stack spacing={2.5}>
        <Card>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ sm: 'center' }} sx={{ p: 2.5 }}>
            <Box>
              <Typography variant="overline" component="p">
                Overall balance
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {friend.balances.length === 0
                  ? `You and ${friend.name} are settled up in every shared group.`
                  : `Netted across ${friend.groups.length === 1 ? 'your shared group' : `all ${friend.groups.length} shared groups`}: ${friend.balances
                      .map((b) => (b.netMinor > 0 ? `${friend.name} ${friendNetWords(b.netMinor, b.currency)}` : friendNetWords(b.netMinor, b.currency)))
                      .join(' and ')}.`}
              </Typography>
            </Box>
            <FriendBalance friend={friend} size="large" align="left" />
          </Stack>
        </Card>

        <SectionCard title="Balance by group" subtitle="Each group follows its own simplify-debts setting.">
          {friend.groups.length === 0 ? (
            <EmptyState compact icon={<Users size={22} />} title="No shared groups" />
          ) : (
            <Box>
              {friend.groups.map((g) => (
                <GroupBalanceRow key={g.groupId} group={g} name={friend.name} />
              ))}
            </Box>
          )}
        </SectionCard>

        <SectionCard title="Shared expenses" subtitle="Expenses involving both of you, newest first. The amount on the right is your own position on each expense.">
          {expenses.length === 0 ? (
            <EmptyState compact icon={<Receipt size={22} />} title="No shared expenses yet" />
          ) : (
            <Box>
              {expenses.map((e) => {
                const group = groupById.get(e.groupId);
                const mine = group ? myNetOnExpense(e, group.myMemberId) : 0;
                const tone = mine > 0 ? 'positive' : mine < 0 ? 'negative' : 'neutral';
                return (
                  <Stack
                    key={e.id}
                    component={RouterLink}
                    to={`/groups/${e.groupId}/expenses/${e.id}`}
                    direction="row"
                    spacing={1.5}
                    alignItems="center"
                    sx={{ py: 1.25, color: 'inherit', textDecoration: 'none', borderTop: 1, borderColor: 'divider', '&:first-of-type': { borderTop: 0 }, '&:hover .expense-title': { textDecoration: 'underline' } }}
                  >
                    <CategoryIcon category={e.category} size={36} />
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography className="expense-title" variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                        {e.title}
                      </Typography>
                      <Typography variant="caption" component="p">
                        {fmt.date(e.date)} · {group ? groupLabel(group) : ''} · {formatMoney(e.amountMinor, e.currency)}
                      </Typography>
                    </Box>
                    <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
                      <Typography variant="caption" component="p" sx={{ color: `money.${tone}`, fontWeight: 600 }}>
                        {mine > 0 ? 'you lent' : mine < 0 ? 'you borrowed' : 'no balance'}
                      </Typography>
                      {mine !== 0 && (
                        <Typography variant="body2" sx={{ color: `money.${tone}`, fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                          {formatMoney(Math.abs(mine), e.currency)}
                        </Typography>
                      )}
                    </Box>
                  </Stack>
                );
              })}
            </Box>
          )}
        </SectionCard>

        <SectionCard title="Repayments between you">
          {settlements.length === 0 ? (
            <EmptyState compact icon={<HandCoins size={22} />} title="No repayments recorded yet" />
          ) : (
            <Box>
              {settlements.map((s) => (
                <RepaymentRow key={s.id} settlement={s} friend={friend} date={fmt.date} />
              ))}
            </Box>
          )}
        </SectionCard>

        {friend.isPlaceholder && (
          <Typography variant="caption" component="p">
            {friend.name} was added by name. Invite them from the group's{' '}
            {friend.groups[0] && (
              <Link component={RouterLink} to={`/groups/${friend.groups[0].groupId}/members`}>
                members page
              </Link>
            )}{' '}
            so they can see and settle their balance themselves.
          </Typography>
        )}
      </Stack>

      <FriendSettleDialog key={friend.key} open={settleOpen} onClose={() => setSettleOpen(false)} friend={friend} />
    </PageTransition>
  );
}
