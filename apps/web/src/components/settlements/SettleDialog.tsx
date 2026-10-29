import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { ArrowLeftRight, ArrowRight, Banknote, Landmark, Smartphone, Ellipsis } from 'lucide-react';
import {
  formatMoney,
  getCurrency,
  parseAmountToMinor,
  SETTLEMENT_METHOD_LABELS,
  type SettlementMethod,
} from '@sharespace/core';
import { toApiError, useBalancesQuery, useGroupQuery, useGroupsQuery, useRecordSettlementMutation } from '../../api/api';
import { useAppDispatch, useAppSelector } from '../../store';
import { closeSettleDialog, showToast } from '../../store/ui';
import { newRequestId } from '../../lib/ids';
import { minorToInput, todayLocal } from '../../lib/format';
import { MemberAvatar } from '../common/MemberAvatar';

const METHOD_ICONS: Record<SettlementMethod, typeof Banknote> = { CASH: Banknote, BANK_TRANSFER: Landmark, UPI: Smartphone, OTHER: Ellipsis };

export function SettleDialog() {
  const state = useAppSelector((s) => s.ui.settleDialog);
  const dispatch = useAppDispatch();
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [pickedGroup, setPickedGroup] = useState('');
  const groupId = state.groupId ?? pickedGroup;
  const { data: groups } = useGroupsQuery(undefined, { skip: !state.open || !!state.groupId });
  const { data: group } = useGroupQuery(groupId, { skip: !state.open || !groupId });
  const { data: balances } = useBalancesQuery(groupId, { skip: !state.open || !groupId });
  const [record, { isLoading }] = useRecordSettlementMutation();

  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<SettlementMethod>('UPI');
  const [methodNote, setMethodNote] = useState('');
  const [date, setDate] = useState(todayLocal());
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const requestId = useRef(newRequestId());
  const prefilled = useRef(false);

  const currency = group?.group.currency ?? 'INR';
  const decimals = getCurrency(currency).decimals;
  const members = useMemo(() => group?.members.filter((m) => m.status === 'ACTIVE') ?? [], [group]);
  const net = useMemo(() => new Map(balances?.balances.map((b) => [b.memberId, b.netMinor]) ?? []), [balances]);

  // Prefill from the suggestion (or the signed-in member's first suggested transfer).
  useEffect(() => {
    if (!state.open || !group || prefilled.current) return;
    if (state.fromMemberId && state.toMemberId) {
      prefilled.current = true;
      setFromId(state.fromMemberId);
      setToId(state.toMemberId);
      if (state.amountMinor) setAmount(minorToInput(state.amountMinor, currency));
      return;
    }
    if (!balances) return;
    prefilled.current = true;
    const mine = balances.suggestions.find((t) => t.fromMemberId === group.myMemberId) ?? balances.suggestions.find((t) => t.toMemberId === group.myMemberId);
    if (mine) {
      setFromId(mine.fromMemberId);
      setToId(mine.toMemberId);
      setAmount(minorToInput(mine.amountMinor, currency));
    } else {
      setFromId(group.myMemberId);
    }
  }, [state.open, state.fromMemberId, state.toMemberId, state.amountMinor, group, balances, currency]);

  const reset = () => {
    setPickedGroup('');
    setFromId('');
    setToId('');
    setAmount('');
    setMethod('UPI');
    setMethodNote('');
    setDate(todayLocal());
    setNotes('');
    setError(null);
    setTouched(false);
    requestId.current = newRequestId();
    prefilled.current = false;
  };

  const amountMinor = parseAmountToMinor(amount, decimals);
  const amountError = amount.trim() === '' ? 'Enter the amount paid' : amountMinor === null || amountMinor <= 0 ? 'Enter a valid positive amount' : null;
  const sameMember = fromId && toId && fromId === toId;
  const name = (id: string) => members.find((m) => m.id === id)?.displayName ?? '';
  const suggested = balances?.suggestions.find((t) => t.fromMemberId === fromId && t.toMemberId === toId)?.amountMinor;
  const fromOwes = Math.max(0, -(net.get(fromId) ?? 0));
  const valid = !!groupId && !!fromId && !!toId && !sameMember && !amountError && !!date;

  const submit = async () => {
    setTouched(true);
    if (!valid || amountMinor === null) return;
    setError(null);
    try {
      await record({
        groupId,
        body: {
          clientRequestId: requestId.current,
          fromMemberId: fromId,
          toMemberId: toId,
          amountMinor,
          method,
          methodNote: methodNote.trim() || null,
          date,
          notes: notes.trim() || null,
        },
      }).unwrap();
      dispatch(showToast({ message: `Recorded: ${name(fromId)} paid ${name(toId)} ${formatMoney(amountMinor, currency)}` }));
      dispatch(closeSettleDialog());
    } catch (e) {
      setError(toApiError(e).message);
    }
  };

  const afterFrom = amountMinor ? (net.get(fromId) ?? 0) + amountMinor : null;
  const afterTo = amountMinor ? (net.get(toId) ?? 0) - amountMinor : null;

  return (
    <Dialog
      open={state.open}
      onClose={isLoading ? undefined : () => dispatch(closeSettleDialog())}
      fullScreen={fullScreen}
      maxWidth="sm"
      fullWidth
      aria-labelledby="settle-title"
      TransitionProps={{ onExited: reset }}
    >
      <DialogTitle id="settle-title">Record a repayment</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.25} component="form" id="settle-form" noValidate onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <Alert severity="info" icon={false} sx={{ bgcolor: 'surface.sage', color: 'text.primary' }}>
            This records a payment that already happened outside ShareSpace (cash, bank transfer or UPI). ShareSpace does not move money.
          </Alert>
          {error && <Alert severity="error">{error}</Alert>}

          {!state.groupId && (
            <TextField select label="Group" value={pickedGroup} onChange={(e) => { setPickedGroup(e.target.value); setFromId(''); setToId(''); setAmount(''); prefilled.current = false; }} required>
              {(groups?.groups ?? []).filter((g) => g.role !== 'VIEWER').map((g) => (
                <MenuItem key={g.id} value={g.id}>
                  {g.name}
                </MenuItem>
              ))}
            </TextField>
          )}

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
            <TextField select label="Who paid" value={fromId} onChange={(e) => setFromId(e.target.value)} disabled={!group} required>
              {members.map((m) => (
                <MenuItem key={m.id} value={m.id}>
                  {m.displayName}
                  {m.isYou ? ' (you)' : ''}
                </MenuItem>
              ))}
            </TextField>
            <IconButton
              aria-label="Swap payer and recipient"
              onClick={() => {
                setFromId(toId);
                setToId(fromId);
              }}
              sx={{ alignSelf: 'center' }}
            >
              <ArrowLeftRight size={18} />
            </IconButton>
            <TextField select label="Who received it" value={toId} onChange={(e) => setToId(e.target.value)} disabled={!group} required error={!!sameMember} helperText={sameMember ? 'Choose two different people' : undefined}>
              {members.map((m) => (
                <MenuItem key={m.id} value={m.id}>
                  {m.displayName}
                  {m.isYou ? ' (you)' : ''}
                </MenuItem>
              ))}
            </TextField>
          </Stack>

          <TextField
            label="Amount paid"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            error={touched && !!amountError}
            helperText={
              (touched && amountError) ||
              (suggested ? `Suggested: ${formatMoney(suggested, currency)}. You can record a partial amount.` : fromId && fromOwes === 0 ? `${name(fromId)} does not currently owe anything in this group.` : ' ')
            }
            slotProps={{
              htmlInput: { inputMode: 'decimal' },
              input: { startAdornment: <InputAdornment position="start">{getCurrency(currency).symbol}</InputAdornment> },
            }}
          />
          {amountMinor !== null && fromId && fromOwes > 0 && amountMinor > fromOwes && (
            <Alert severity="warning">
              This is more than {name(fromId)} owes ({formatMoney(fromOwes, currency)}). Recording it will leave them owed money instead.
            </Alert>
          )}

          <Box>
            <Typography variant="subtitle2" component="p" sx={{ mb: 1 }} id="method-label">
              How was it paid?
            </Typography>
            <ToggleButtonGroup exclusive value={method} onChange={(_e, v: SettlementMethod | null) => v && setMethod(v)} aria-labelledby="method-label" sx={{ flexWrap: 'wrap' }}>
              {(Object.keys(SETTLEMENT_METHOD_LABELS) as SettlementMethod[]).map((m) => {
                const Icon = METHOD_ICONS[m];
                return (
                  <ToggleButton key={m} value={m} sx={{ textTransform: 'none', gap: 0.75, px: 1.75 }}>
                    <Icon size={16} aria-hidden />
                    {SETTLEMENT_METHOD_LABELS[m]}
                  </ToggleButton>
                );
              })}
            </ToggleButtonGroup>
          </Box>
          {method === 'OTHER' && <TextField label="Describe the method" value={methodNote} onChange={(e) => setMethodNote(e.target.value)} slotProps={{ htmlInput: { maxLength: 80 } }} />}

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField label="Date paid" type="date" value={date} onChange={(e) => setDate(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} required />
            <TextField label="Note (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} slotProps={{ htmlInput: { maxLength: 500 } }} />
          </Stack>

          {fromId && toId && !sameMember && amountMinor && afterFrom !== null && afterTo !== null && (
            <Box sx={{ p: 1.75, borderRadius: 2.5, border: 1, borderColor: 'divider', bgcolor: 'surface.subtle' }}>
              <Stack direction="row" spacing={1.25} alignItems="center" sx={{ mb: 1.25 }}>
                <MemberAvatar name={name(fromId)} size={28} />
                <ArrowRight size={16} aria-hidden />
                <MemberAvatar name={name(toId)} size={28} />
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {name(fromId)} pays {name(toId)} {formatMoney(amountMinor, currency)}
                </Typography>
              </Stack>
              <Typography variant="caption" component="p">
                After recording: {name(fromId)} {afterFrom < 0 ? `owes ${formatMoney(-afterFrom, currency)}` : afterFrom > 0 ? `is owed ${formatMoney(afterFrom, currency)}` : 'is settled up'} · {name(toId)}{' '}
                {afterTo < 0 ? `owes ${formatMoney(-afterTo, currency)}` : afterTo > 0 ? `is owed ${formatMoney(afterTo, currency)}` : 'is settled up'}
              </Typography>
            </Box>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={() => dispatch(closeSettleDialog())} color="inherit" disabled={isLoading}>
          Cancel
        </Button>
        <Button type="submit" form="settle-form" variant="contained" disabled={isLoading || !group}>
          {isLoading ? 'Recording…' : 'Record repayment'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
