import { useState } from 'react';
import { Box, Button, Chip, Stack, Typography } from '@mui/material';
import { ArrowRight, RotateCcw, Undo2 } from 'lucide-react';
import { SETTLEMENT_METHOD_LABELS, type Transfer } from '@sharespace/core';
import { toApiError, useReverseSettlementMutation } from '../../api/api';
import type { Settlement } from '../../api/types';
import { useFormat } from '../../hooks/useAuth';
import { useAppDispatch } from '../../store';
import { openSettleDialog, showToast } from '../../store/ui';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { MemberAvatar } from '../common/MemberAvatar';
import { Money } from '../common/Money';

/** A suggested transfer with a "Record" action. Suggestions never change balances until recorded. */
export function SuggestionRow({
  transfer,
  groupId,
  currency,
  name,
  myMemberId,
  canRecord,
}: {
  transfer: Transfer;
  groupId: string;
  currency: string;
  name: (id: string) => string;
  myMemberId?: string | null;
  canRecord: boolean;
}) {
  const dispatch = useAppDispatch();
  const youPay = transfer.fromMemberId === myMemberId;
  const youReceive = transfer.toMemberId === myMemberId;
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={1.5}
      alignItems={{ sm: 'center' }}
      sx={{ p: 1.5, border: 1, borderColor: youPay || youReceive ? 'primary.light' : 'divider', borderRadius: 2.5, bgcolor: youPay || youReceive ? 'surface.subtle' : 'transparent' }}
    >
      <Stack direction="row" spacing={1} alignItems="center" sx={{ flex: 1, minWidth: 0 }}>
        <MemberAvatar name={name(transfer.fromMemberId)} size={32} />
        <ArrowRight size={16} aria-hidden />
        <MemberAvatar name={name(transfer.toMemberId)} size={32} />
        <Typography variant="body2" sx={{ fontWeight: 600, ml: 0.5, minWidth: 0 }}>
          {youPay ? 'You' : name(transfer.fromMemberId)} {youPay ? 'pay' : 'pays'} {youReceive ? 'you' : name(transfer.toMemberId)}
        </Typography>
      </Stack>
      <Stack direction="row" spacing={1.5} alignItems="center" justifyContent="space-between">
        <Money minor={transfer.amountMinor} currency={currency} sx={{ fontSize: '1rem' }} />
        {canRecord && (
          <Button
            size="small"
            variant={youPay ? 'contained' : 'outlined'}
            onClick={() => dispatch(openSettleDialog({ groupId, fromMemberId: transfer.fromMemberId, toMemberId: transfer.toMemberId, amountMinor: transfer.amountMinor }))}
          >
            Record payment
          </Button>
        )}
      </Stack>
    </Stack>
  );
}

/** "You" as the object of a sentence reads "you". */
const objectName = (n: string) => (n === 'You' ? 'you' : n);

/** Settlement history. Recorded settlements are never deleted; they can be reversed with a reason. */
export function SettlementHistory({
  settlements,
  name,
  userName,
  canReverse,
  groupNameOf,
}: {
  settlements: Settlement[];
  name: (memberId: string) => string;
  userName?: (userId: string) => string;
  canReverse: (s: Settlement) => boolean;
  groupNameOf?: (groupId: string) => string;
}) {
  const fmt = useFormat();
  const dispatch = useAppDispatch();
  const [reverse, { isLoading }] = useReverseSettlementMutation();
  const [target, setTarget] = useState<Settlement | null>(null);

  return (
    <>
      <Stack component="ul" spacing={1.25} sx={{ listStyle: 'none', p: 0, m: 0 }}>
        {settlements.map((s) => {
          const reversed = s.status === 'REVERSED';
          return (
            <Box component="li" key={s.id} sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 2.5, opacity: reversed ? 0.85 : 1 }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} alignItems={{ sm: 'center' }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600, textDecoration: reversed ? 'line-through' : 'none' }}>
                    {name(s.fromMemberId)} paid {objectName(name(s.toMemberId))}
                  </Typography>
                  <Typography variant="caption" component="p">
                    {[groupNameOf?.(s.groupId), fmt.date(s.date), `${SETTLEMENT_METHOD_LABELS[s.method]}${s.methodNote ? ` (${s.methodNote})` : ''}`, userName ? `recorded by ${userName(s.recordedById)}` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </Typography>
                  {s.notes && (
                    <Typography variant="caption" component="p" sx={{ fontStyle: 'italic' }}>
                      “{s.notes}”
                    </Typography>
                  )}
                  {reversed && (
                    <Typography variant="caption" component="p" sx={{ color: 'money.negative', mt: 0.25 }}>
                      Reversed{s.reversedAt ? ` on ${fmt.date(s.reversedAt)}` : ''}: {s.reversalReason}
                    </Typography>
                  )}
                </Box>
                <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                  <Money minor={s.amountMinor} currency={s.currency} sx={{ textDecoration: reversed ? 'line-through' : 'none' }} />
                  <Chip
                    size="small"
                    variant="outlined"
                    icon={reversed ? <Undo2 size={13} /> : undefined}
                    label={reversed ? 'Reversed' : 'Recorded'}
                    sx={{ height: 24, color: reversed ? 'text.secondary' : 'primary.main', borderColor: 'currentColor', '& .MuiChip-icon': { color: 'inherit' } }}
                  />
                  {!reversed && canReverse(s) && (
                    <Button size="small" color="inherit" startIcon={<RotateCcw size={14} />} onClick={() => setTarget(s)}>
                      Reverse
                    </Button>
                  )}
                </Stack>
              </Stack>
            </Box>
          );
        })}
      </Stack>
      <ConfirmDialog
        open={!!target}
        title="Reverse this repayment?"
        description={
          target && (
            <>
              The record of {name(target.fromMemberId)} paying {name(target.toMemberId)} stays in the history, marked as reversed, and its effect is removed from
              balances. Use this to correct a payment recorded by mistake.
            </>
          )
        }
        confirmLabel="Reverse repayment"
        destructive
        busy={isLoading}
        reasonLabel="Reason (required)"
        onClose={() => setTarget(null)}
        onConfirm={async (reason) => {
          if (!target) return;
          try {
            await reverse({ groupId: target.groupId, settlementId: target.id, reason }).unwrap();
            dispatch(showToast({ message: 'Repayment reversed' }));
            setTarget(null);
          } catch (e) {
            dispatch(showToast({ message: toApiError(e).message, severity: 'error' }));
          }
        }}
      />
    </>
  );
}
