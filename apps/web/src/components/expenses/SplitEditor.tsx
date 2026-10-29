import { Box, Button, Chip, IconButton, InputAdornment, Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import { Check, Plus, Trash2 } from 'lucide-react';
import { formatMoney, getCurrency, type SplitMethod } from '@sharespace/core';
import type { Member } from '../../api/types';
import { minorToInput } from '../../lib/format';
import { MemberAvatar } from '../common/MemberAvatar';
import { evenPercents, itemizedTotal, newItem, orderedParticipants, type SplitDraft, type SplitPreview } from './splitModel';
import { SplitStatus } from './SplitStatus';

const METHODS: { value: SplitMethod; label: string; hint: string }[] = [
  { value: 'EQUAL', label: 'Equal', hint: 'Everyone selected pays the same' },
  { value: 'EXACT', label: 'Exact', hint: 'Enter each person’s amount' },
  { value: 'PERCENTAGE', label: 'Percent', hint: 'Percentages must add up to 100%' },
  { value: 'SHARES', label: 'Shares', hint: 'Split by weights, e.g. 2 : 1 : 1' },
  { value: 'ITEMIZED', label: 'Items', hint: 'Assign receipt items to people' },
];

interface SplitEditorProps {
  members: Member[];
  draft: SplitDraft;
  onChange: (next: SplitDraft) => void;
  currency: string;
  totalMinor: number | null;
  preview: SplitPreview;
  /** Sets the expense amount (used by "use items total"). */
  onUseAmount: (text: string) => void;
}

export function SplitEditor({ members, draft, onChange, currency, totalMinor, preview, onUseAmount }: SplitEditorProps) {
  const memberOrder = members.map((m) => m.id);
  const ids = orderedParticipants(draft, memberOrder);
  const shareOf = new Map(preview.ok ? preview.shares.map((s) => [s.memberId, s.amountMinor]) : []);
  const name = (m: Member) => (m.isYou ? `${m.displayName} (you)` : m.displayName);
  const { symbol } = getCurrency(currency);
  const methodHint = METHODS.find((m) => m.value === draft.method)?.hint;

  const toggleParticipant = (id: string) => {
    const selected = draft.participantIds.includes(id);
    const participantIds = selected ? draft.participantIds.filter((p) => p !== id) : [...draft.participantIds, id];
    onChange({ ...draft, participantIds, shares: selected || draft.shares[id] ? draft.shares : { ...draft.shares, [id]: '1' } });
  };

  const setMethod = (method: SplitMethod) => {
    let next = { ...draft, method };
    // Helpful starting points that still require the user's review.
    if (method === 'PERCENTAGE' && ids.every((id) => !(draft.percent[id] ?? '').trim())) next = { ...next, percent: evenPercents(ids) };
    onChange(next);
  };

  const valueKey = draft.method === 'EXACT' ? 'exact' : draft.method === 'PERCENTAGE' ? 'percent' : 'shares';

  return (
    <Box>
      <Typography variant="subtitle2" component="p" id="split-method-label" sx={{ mb: 1 }}>
        Split method
      </Typography>
      <ToggleButtonGroup
        exclusive
        value={draft.method}
        onChange={(_e, v: SplitMethod | null) => v && setMethod(v)}
        aria-labelledby="split-method-label"
        size="small"
        sx={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', '& .MuiToggleButton-root': { minHeight: 40, textTransform: 'none', fontWeight: 600, px: 0.5 } }}
      >
        {METHODS.map((m) => (
          <ToggleButton key={m.value} value={m.value} aria-label={`${m.label}: ${m.hint}`}>
            {m.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      {methodHint && (
        <Typography variant="caption" component="p" sx={{ mt: 0.75 }}>
          {methodHint}
        </Typography>
      )}

      {draft.method !== 'ITEMIZED' && (
        <>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 2, mb: 1 }}>
            <Typography variant="subtitle2" component="p" id="participants-label">
              Split between ({ids.length})
            </Typography>
            <Stack direction="row" spacing={0.5}>
              <Button size="small" onClick={() => onChange({ ...draft, participantIds: memberOrder, shares: { ...Object.fromEntries(memberOrder.map((id) => [id, '1'])), ...draft.shares } })}>
                All
              </Button>
              <Button size="small" onClick={() => onChange({ ...draft, participantIds: [] })}>
                None
              </Button>
            </Stack>
          </Stack>
          <Box role="group" aria-labelledby="participants-label" sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {members.map((m) => {
              const on = draft.participantIds.includes(m.id);
              return (
                <Chip
                  key={m.id}
                  label={name(m)}
                  onClick={() => toggleParticipant(m.id)}
                  icon={on ? <Check size={14} /> : undefined}
                  variant={on ? 'filled' : 'outlined'}
                  color={on ? 'primary' : 'default'}
                  aria-pressed={on}
                  sx={{ height: 36, borderRadius: 2.5 }}
                />
              );
            })}
          </Box>

          {ids.length > 0 && (
            <Stack spacing={1} sx={{ mt: 2 }} aria-label="Shares preview">
              {ids.map((id) => {
                const m = members.find((x) => x.id === id)!;
                const share = shareOf.get(id);
                return (
                  <Stack key={id} direction="row" spacing={1.5} alignItems="center" sx={{ minHeight: 40 }}>
                    <MemberAvatar name={m.displayName} color={m.avatarColor} size={30} placeholder={!m.hasAccount} />
                    <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                      {name(m)}
                    </Typography>
                    {draft.method !== 'EQUAL' && (
                      <TextField
                        value={draft[valueKey][id] ?? ''}
                        onChange={(e) => onChange({ ...draft, [valueKey]: { ...draft[valueKey], [id]: e.target.value } })}
                        placeholder="0"
                        sx={{ width: { xs: 108, sm: 130 } }}
                        slotProps={{
                          htmlInput: {
                            inputMode: 'decimal',
                            className: 'tabular',
                            'aria-label': `${draft.method === 'EXACT' ? 'Amount' : draft.method === 'PERCENTAGE' ? 'Percentage' : 'Shares'} for ${m.displayName}`,
                          },
                          input: {
                            startAdornment: draft.method === 'EXACT' ? <InputAdornment position="start">{symbol}</InputAdornment> : undefined,
                            endAdornment: draft.method === 'PERCENTAGE' ? <InputAdornment position="end">%</InputAdornment> : undefined,
                          },
                        }}
                      />
                    )}
                    <Typography
                      variant="body2"
                      className="tabular"
                      data-testid={`share-${id}`}
                      sx={{ width: { xs: 84, sm: 104 }, textAlign: 'right', fontWeight: 650, color: share === undefined ? 'text.disabled' : 'text.primary' }}
                    >
                      {share === undefined ? '—' : formatMoney(share, currency)}
                    </Typography>
                  </Stack>
                );
              })}
            </Stack>
          )}
          {draft.method === 'PERCENTAGE' && ids.length > 0 && (
            <Button size="small" sx={{ mt: 1 }} onClick={() => onChange({ ...draft, percent: evenPercents(ids) })}>
              Split percentages evenly
            </Button>
          )}
        </>
      )}

      {draft.method === 'ITEMIZED' && (
        <ItemizedEditor members={members} draft={draft} onChange={onChange} currency={currency} totalMinor={totalMinor} preview={preview} onUseAmount={onUseAmount} />
      )}

      {preview.ok ? (
        <SplitStatus tone="success" message={`Split adds up to ${formatMoney(totalMinor ?? 0, currency)}.`} />
      ) : (
        <SplitStatus tone={preview.tone} message={preview.message} />
      )}
    </Box>
  );
}

function ItemizedEditor({ members, draft, onChange, currency, totalMinor, preview, onUseAmount }: SplitEditorProps) {
  const { symbol } = getCurrency(currency);
  const allIds = members.map((m) => m.id);
  const updateItem = (key: string, patch: Partial<SplitDraft['items'][number]>) =>
    onChange({ ...draft, items: draft.items.map((it) => (it.key === key ? { ...it, ...patch } : it)) });
  const itemsSum = itemizedTotal(draft, currency);
  const nameOf = (id: string) => members.find((m) => m.id === id)?.displayName ?? 'Former member';
  const money = (m: number) => formatMoney(m, currency);

  return (
    <Box sx={{ mt: 2 }}>
      <Stack spacing={1.5}>
        {draft.items.map((item, index) => (
          <Box key={item.key} sx={{ border: 1, borderColor: 'divider', borderRadius: 2.5, p: 1.5 }}>
            <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr 72px', sm: '1fr 130px 80px' }, alignItems: 'start' }}>
              <TextField
                label={`Item ${index + 1}`}
                value={item.description}
                onChange={(e) => updateItem(item.key, { description: e.target.value })}
                sx={{ gridColumn: { xs: '1 / -1', sm: 'auto' } }}
                slotProps={{ htmlInput: { maxLength: 120 } }}
              />
              <TextField
                label="Unit price"
                value={item.unitPrice}
                onChange={(e) => updateItem(item.key, { unitPrice: e.target.value })}
                slotProps={{
                  htmlInput: { inputMode: 'decimal', className: 'tabular', 'aria-label': `Unit price for item ${index + 1}` },
                  input: { startAdornment: <InputAdornment position="start">{symbol}</InputAdornment> },
                }}
              />
              <TextField label="Qty" value={item.quantity} onChange={(e) => updateItem(item.key, { quantity: e.target.value })} slotProps={{ htmlInput: { inputMode: 'numeric', 'aria-label': `Quantity for item ${index + 1}` } }} />
            </Box>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 1 }}>
              <Box role="group" aria-label={`Who shared item ${index + 1}`} sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, flex: 1 }}>
                {members.map((m) => {
                  const on = item.memberIds.includes(m.id);
                  return (
                    <Chip
                      key={m.id}
                      size="small"
                      label={m.isYou ? 'You' : m.displayName}
                      icon={on ? <Check size={12} /> : undefined}
                      color={on ? 'primary' : 'default'}
                      variant={on ? 'filled' : 'outlined'}
                      aria-pressed={on}
                      onClick={() => updateItem(item.key, { memberIds: on ? item.memberIds.filter((x) => x !== m.id) : [...item.memberIds, m.id] })}
                      sx={{ height: 32 }}
                    />
                  );
                })}
              </Box>
              <Tooltip title="Remove item">
                <span>
                  <IconButton
                    aria-label={`Remove item ${index + 1}`}
                    disabled={draft.items.length === 1}
                    onClick={() => onChange({ ...draft, items: draft.items.filter((it) => it.key !== item.key) })}
                  >
                    <Trash2 size={18} />
                  </IconButton>
                </span>
              </Tooltip>
            </Stack>
          </Box>
        ))}
      </Stack>
      <Button startIcon={<Plus size={16} />} onClick={() => onChange({ ...draft, items: [...draft.items, newItem(allIds)] })} sx={{ mt: 1 }}>
        Add item
      </Button>

      <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: 'repeat(3, 1fr)', mt: 1.5 }}>
        {(
          [
            ['tax', 'Tax'],
            ['service', 'Service / tip'],
            ['discount', 'Discount'],
          ] as const
        ).map(([key, label]) => (
          <TextField
            key={key}
            label={label}
            value={draft[key]}
            onChange={(e) => onChange({ ...draft, [key]: e.target.value })}
            placeholder="0"
            slotProps={{ htmlInput: { inputMode: 'decimal', className: 'tabular' } }}
          />
        ))}
      </Box>
      <Typography variant="caption" component="p" sx={{ mt: 0.75 }}>
        Tax, service and discounts are shared in proportion to what each person had.
      </Typography>

      {itemsSum !== null && totalMinor !== itemsSum && (
        <Button size="small" variant="outlined" sx={{ mt: 1 }} onClick={() => onUseAmount(minorToInput(itemsSum, currency))}>
          Use items total ({money(itemsSum)}) as the amount
        </Button>
      )}

      {preview.ok && preview.itemized && (
        <Stack spacing={0.75} sx={{ mt: 2 }} aria-label="Per-person breakdown">
          {preview.itemized.map((b) => (
            <Stack key={b.memberId} direction="row" spacing={1} alignItems="baseline">
              <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                {nameOf(b.memberId)}
              </Typography>
              <Typography variant="caption" className="tabular" sx={{ display: { xs: 'none', sm: 'block' } }}>
                items {money(b.itemsMinor)}
                {b.taxMinor ? ` + tax ${money(b.taxMinor)}` : ''}
                {b.serviceMinor ? ` + service ${money(b.serviceMinor)}` : ''}
                {b.discountMinor ? ` − discount ${money(b.discountMinor)}` : ''}
              </Typography>
              <Typography variant="body2" className="tabular" data-testid={`share-${b.memberId}`} sx={{ fontWeight: 650, minWidth: 90, textAlign: 'right' }}>
                {money(b.totalMinor)}
              </Typography>
            </Stack>
          ))}
        </Stack>
      )}
    </Box>
  );
}
