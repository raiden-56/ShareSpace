import { Box, FormControlLabel, InputAdornment, MenuItem, Stack, Switch, TextField, Typography } from '@mui/material';
import { getCurrency, parseAmountToMinor, formatMoney } from '@sharespace/core';
import type { Member } from '../../api/types';
import { minorToInput } from '../../lib/format';
import { MemberAvatar } from '../common/MemberAvatar';
import type { PayerDraft, PayerPreview } from './splitModel';
import { SplitStatus } from './SplitStatus';

interface PayerEditorProps {
  members: Member[];
  draft: PayerDraft;
  onChange: (next: PayerDraft) => void;
  currency: string;
  totalMinor: number | null;
  preview: PayerPreview;
  showErrors: boolean;
}

export function PayerEditor({ members, draft, onChange, currency, totalMinor, preview, showErrors }: PayerEditorProps) {
  const { symbol, decimals } = getCurrency(currency);
  const label = (m: Member) => (m.isYou ? `${m.displayName} (you)` : m.displayName);

  const toggleMultiple = (multiple: boolean) => {
    if (multiple && totalMinor && draft.payerId && Object.values(draft.amounts).every((v) => !v.trim())) {
      onChange({ ...draft, multiple, amounts: { [draft.payerId]: minorToInput(totalMinor, currency) } });
    } else {
      onChange({ ...draft, multiple });
    }
  };

  const assigned = members.reduce((sum, m) => sum + (parseAmountToMinor(draft.amounts[m.id] ?? '', decimals) ?? 0), 0);

  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}>
        {!draft.multiple && (
          <TextField select label="Paid by" value={draft.payerId} onChange={(e) => onChange({ ...draft, payerId: e.target.value })} sx={{ flex: 1 }}>
            {members.map((m) => (
              <MenuItem key={m.id} value={m.id}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <MemberAvatar name={m.displayName} color={m.avatarColor} size={22} placeholder={!m.hasAccount} />
                  <span>{label(m)}</span>
                </Stack>
              </MenuItem>
            ))}
          </TextField>
        )}
        <FormControlLabel
          control={<Switch checked={draft.multiple} onChange={(e) => toggleMultiple(e.target.checked)} />}
          label="Multiple payers"
          sx={{ ml: { sm: draft.multiple ? 0 : 1 }, minHeight: 40 }}
        />
      </Stack>

      {draft.multiple && (
        <Stack spacing={1} sx={{ mt: 1 }}>
          {members.map((m) => (
            <Stack key={m.id} direction="row" spacing={1.5} alignItems="center">
              <MemberAvatar name={m.displayName} color={m.avatarColor} size={30} placeholder={!m.hasAccount} />
              <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                {label(m)}
              </Typography>
              <TextField
                value={draft.amounts[m.id] ?? ''}
                onChange={(e) => onChange({ ...draft, amounts: { ...draft.amounts, [m.id]: e.target.value } })}
                placeholder="0"
                sx={{ width: 140 }}
                slotProps={{
                  htmlInput: { inputMode: 'decimal', 'aria-label': `Amount paid by ${m.displayName}`, className: 'tabular' },
                  input: { startAdornment: <InputAdornment position="start">{symbol}</InputAdornment> },
                }}
              />
            </Stack>
          ))}
          {totalMinor !== null && totalMinor > 0 && (
            <Typography variant="caption" className="tabular">
              {formatMoney(assigned, currency)} of {formatMoney(totalMinor, currency)} assigned
            </Typography>
          )}
        </Stack>
      )}
      {draft.multiple && preview.ok && <SplitStatus tone="success" message="Payer contributions add up to the total." />}
      {!preview.ok && (draft.multiple || showErrors) && preview.tone === 'error' && <SplitStatus tone="error" message={preview.message} />}
    </Box>
  );
}
