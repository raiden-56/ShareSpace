import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
import { ArrowRight, Banknote, Ellipsis, Landmark, Smartphone } from 'lucide-react';
import { formatMoney, getCurrency, parseAmountToMinor, SETTLEMENT_METHOD_LABELS, type SettlementMethod } from '@sharespace/core';
import { toApiError, useSettleWithFriendMutation } from '../../api/api';
import type { Friend } from '../../api/types';
import { minorToInput, todayLocal } from '../../lib/format';
import { newRequestId } from '../../lib/ids';
import { useAppDispatch } from '../../store';
import { showToast } from '../../store/ui';
import { planSettlement } from './friendLogic';

const METHOD_ICONS: Record<SettlementMethod, typeof Banknote> = { CASH: Banknote, BANK_TRANSFER: Landmark, UPI: Smartphone, OTHER: Ellipsis };

interface FriendSettleDialogProps {
  open: boolean;
  onClose: () => void;
  friend: Friend;
}

/**
 * Settle up with one friend in one currency across every shared group. The preview lists exactly
 * which per-group repayments will be recorded, using the same rules as the server.
 */
export function FriendSettleDialog({ open, onClose, friend }: FriendSettleDialogProps) {
  const dispatch = useAppDispatch();
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [settle, { isLoading }] = useSettleWithFriendMutation();

  // Once everything is settled there are no balances left; a shared group's currency keeps formatting valid.
  const defaultCurrency = friend.balances[0]?.currency ?? friend.groups[0]?.currency ?? 'INR';
  const [currency, setCurrency] = useState(defaultCurrency);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<SettlementMethod>('UPI');
  const [methodNote, setMethodNote] = useState('');
  const [date, setDate] = useState(todayLocal());
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  // One idempotency key per dialog session, so a retried submit never records twice.
  const requestId = useRef(newRequestId());

  const net = friend.balances.find((b) => b.currency === currency)?.netMinor ?? 0;
  const outstanding = Math.abs(net);

  // Prefill the full balance whenever the dialog opens or the currency changes.
  useEffect(() => {
    if (!open) return;
    setAmount(outstanding > 0 ? minorToInput(outstanding, currency) : '');
  }, [open, currency, outstanding]);

  const reset = () => {
    setCurrency(defaultCurrency);
    setAmount('');
    setMethod('UPI');
    setMethodNote('');
    setDate(todayLocal());
    setNotes('');
    setError(null);
    setTouched(false);
    requestId.current = newRequestId();
  };

  const decimals = getCurrency(currency).decimals;
  const amountMinor = parseAmountToMinor(amount, decimals);
  const amountError =
    amount.trim() === ''
      ? 'Enter the amount paid'
      : amountMinor === null || amountMinor <= 0
        ? 'Enter a valid positive amount'
        : amountMinor > outstanding
          ? `That is more than the ${formatMoney(outstanding, currency)} outstanding. To record an overpayment, use a group's balances page.`
          : null;
  const legs = useMemo(() => (amountMinor && !amountError ? planSettlement(friend.groups, currency, amountMinor) : []), [friend.groups, currency, amountMinor, amountError]);
  const theyPayOverall = net > 0;
  const direction = theyPayOverall ? `${friend.name} pays you` : `You pay ${friend.name}`;
  const isFull = amountMinor === outstanding;

  const submit = async () => {
    setTouched(true);
    if (amountError || amountMinor === null || !date || outstanding === 0) return;
    setError(null);
    try {
      await settle({
        key: friend.key,
        body: { clientRequestId: requestId.current, currency, amountMinor, method, methodNote: methodNote.trim() || null, date, notes: notes.trim() || null },
      }).unwrap();
      dispatch(
        showToast({
          message: isFull ? `Settled up with ${friend.name}` : `Recorded: ${theyPayOverall ? `${friend.name} paid you` : `you paid ${friend.name}`} ${formatMoney(amountMinor, currency)}`,
        }),
      );
      onClose();
    } catch (e) {
      setError(toApiError(e).message);
    }
  };

  return (
    <Dialog open={open} onClose={isLoading ? undefined : onClose} fullScreen={fullScreen} maxWidth="sm" fullWidth aria-labelledby="friend-settle-title" TransitionProps={{ onExited: reset }}>
      <DialogTitle id="friend-settle-title">Settle up with {friend.name}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.25} component="form" id="friend-settle-form" noValidate onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <Alert severity="info" icon={false} sx={{ bgcolor: 'surface.sage', color: 'text.primary' }}>
            ShareSpace records the repayment; it does not move money. Record a payment that already happened by cash, bank transfer or UPI.
          </Alert>
          {error && <Alert severity="error">{error}</Alert>}

          {friend.balances.length > 1 && (
            <TextField select label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)} helperText="Balances in different currencies are settled separately.">
              {friend.balances.map((b) => (
                <MenuItem key={b.currency} value={b.currency}>
                  {b.currency} · {b.netMinor > 0 ? 'owes you' : 'you owe'} {formatMoney(Math.abs(b.netMinor), b.currency)}
                </MenuItem>
              ))}
            </TextField>
          )}

          <Box>
            <Typography variant="overline" component="p">
              Direction
            </Typography>
            <Typography variant="subtitle1" component="p" sx={{ fontWeight: 700 }}>
              {direction}
            </Typography>
            <Typography variant="caption" component="p">
              Total outstanding across your shared groups: {formatMoney(outstanding, currency)}
            </Typography>
          </Box>

          <TextField
            label="Amount paid"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            error={touched && !!amountError}
            helperText={(touched && amountError) || 'Prefilled with the full balance. You can record a partial amount.'}
            slotProps={{
              htmlInput: { inputMode: 'decimal' },
              input: { startAdornment: <InputAdornment position="start">{currency ? getCurrency(currency).symbol : ''}</InputAdornment> },
            }}
          />
          {!touched && amountMinor !== null && amountMinor > outstanding && (
            <Alert severity="warning">That is more than the {formatMoney(outstanding, currency)} outstanding. To record an overpayment, use a group's balances page.</Alert>
          )}

          <Box>
            <Typography variant="subtitle2" component="p" sx={{ mb: 1 }} id="friend-method-label">
              How was it paid?
            </Typography>
            <ToggleButtonGroup exclusive value={method} onChange={(_e, v: SettlementMethod | null) => v && setMethod(v)} aria-labelledby="friend-method-label" sx={{ flexWrap: 'wrap' }}>
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

          {legs.length > 0 && (
            <Box sx={{ p: 1.75, borderRadius: 2.5, border: 1, borderColor: 'divider', bgcolor: 'surface.subtle' }} aria-label="Repayments that will be recorded" role="region">
              <Typography variant="subtitle2" component="p" sx={{ mb: 1 }}>
                {isFull ? 'This settles every shared group:' : 'This pays down the largest balances first:'}
              </Typography>
              <Stack component="ul" spacing={0.75} sx={{ m: 0, pl: 0, listStyle: 'none' }}>
                {legs.map((leg) => (
                  <Stack component="li" key={leg.group.groupId} direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                    <ArrowRight size={14} aria-hidden style={{ flexShrink: 0 }} />
                    <Typography variant="body2" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                      {leg.theyPay ? `${friend.name} pays you` : `You pay ${friend.name}`} {formatMoney(leg.amountMinor, currency)} in {leg.group.isDirect ? 'expenses outside groups' : leg.group.groupName}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
              {isFull && legs.some((l) => l.theyPay !== theyPayOverall) && (
                <Typography variant="caption" component="p" sx={{ mt: 1 }}>
                  Balances running the other way are offset, so only the net {formatMoney(outstanding, currency)} changes hands.
                </Typography>
              )}
            </Box>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} color="inherit" disabled={isLoading}>
          Cancel
        </Button>
        <Button type="submit" form="friend-settle-form" variant="contained" disabled={isLoading || outstanding === 0}>
          {isLoading ? 'Recording…' : 'Record repayment'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
