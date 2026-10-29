import { useMemo, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Alert, Box, Button, Chip, Divider, IconButton, InputAdornment, ListItemIcon, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { Paperclip, Plus, X } from 'lucide-react';
import {
  convertMinor,
  categoryLabel,
  CURRENCIES,
  DEFAULT_CATEGORIES,
  formatMoney,
  getCurrency,
  isoDateSchema,
  MAX_MINOR,
  parseAmountToMinor,
  parseRate,
  type ExpenseInput,
} from '@sharespace/core';
import { toApiError, useCreateCategoryMutation } from '../../api/api';
import type { GroupDetail, Member, PlanSummary } from '../../api/types';
import { ACCEPTED_UPLOAD_TYPES, formatBytes, validateUpload } from '../../lib/upload';
import { CategoryIcon } from '../common/Indicators';
import { PayerEditor } from './PayerEditor';
import { SplitEditor } from './SplitEditor';
import { buildPayers, buildSplit, type ExpenseFormInitial, type FormBasics, type PayerDraft, type SplitDraft } from './splitModel';

export type ExpensePayload = Omit<ExpenseInput, 'clientRequestId'>;

interface ExpenseFormProps {
  formId: string;
  group: GroupDetail;
  plans: PlanSummary[];
  initial: ExpenseFormInitial;
  onSubmit: (payload: ExpensePayload, receipt: File | null) => void;
  disabled?: boolean;
  allowReceipt?: boolean;
}

function makeSchema(groupCurrency: string) {
  return z
    .object({
      title: z.string().trim().min(1, 'Enter a title').max(120, 'Use at most 120 characters'),
      amount: z.string().trim().min(1, 'Enter an amount'),
      currency: z.string().min(3),
      fxRate: z.string().trim(),
      date: isoDateSchema,
      category: z.string().min(1, 'Choose a category'),
      planId: z.string(),
      notes: z.string().max(2000, 'Use at most 2000 characters'),
    })
    .superRefine((v, ctx) => {
      const { decimals } = getCurrency(v.currency);
      const minor = parseAmountToMinor(v.amount, decimals);
      if (v.amount.trim() && minor === null) {
        ctx.addIssue({ code: 'custom', path: ['amount'], message: decimals ? `Enter a valid amount with up to ${decimals} decimal places` : 'Enter a whole amount' });
      } else if (minor === 0) {
        ctx.addIssue({ code: 'custom', path: ['amount'], message: 'Amount must be greater than zero' });
      } else if (minor !== null && minor > MAX_MINOR) {
        ctx.addIssue({ code: 'custom', path: ['amount'], message: 'Amount is too large' });
      }
      if (v.currency !== groupCurrency) {
        if (!v.fxRate) ctx.addIssue({ code: 'custom', path: ['fxRate'], message: `Enter the exchange rate to ${groupCurrency}` });
        else if (!parseRate(v.fxRate)) ctx.addIssue({ code: 'custom', path: ['fxRate'], message: 'Enter a positive rate, e.g. 83.25' });
      }
    });
}

export function ExpenseForm({ formId, group, plans, initial, onSubmit, disabled, allowReceipt = true }: ExpenseFormProps) {
  const groupCurrency = group.group.currency;
  const schema = useMemo(() => makeSchema(groupCurrency), [groupCurrency]);
  const { control, register, handleSubmit, watch, setValue, formState } = useForm<FormBasics>({
    resolver: zodResolver(schema),
    defaultValues: initial.basics,
    mode: 'onTouched',
  });
  const [payers, setPayers] = useState<PayerDraft>(initial.payers);
  const [split, setSplit] = useState<SplitDraft>(initial.split);
  const [submitted, setSubmitted] = useState(false);
  const [receipt, setReceipt] = useState<File | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [newCategory, setNewCategory] = useState<string | null>(null);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [createCategory, { isLoading: creatingCategory }] = useCreateCategoryMutation();
  const statusRef = useRef<HTMLDivElement>(null);

  // Active members plus anyone already on this expense (so editing never drops a former member silently).
  const members: Member[] = useMemo(() => {
    const referenced = new Set([...initial.split.participantIds, ...Object.keys(initial.payers.amounts), initial.payers.payerId, ...initial.split.items.flatMap((i) => i.memberIds)]);
    return group.members.filter((m) => m.status === 'ACTIVE' || referenced.has(m.id));
  }, [group.members, initial]);
  const memberOrder = members.map((m) => m.id);
  const nameOf = (id: string) => members.find((m) => m.id === id)?.displayName ?? 'Former member';

  const currency = watch('currency');
  const amountText = watch('amount');
  const fxRate = watch('fxRate');
  const { decimals, symbol } = getCurrency(currency);
  const totalMinor = parseAmountToMinor(amountText ?? '', decimals);
  const splitPreview = buildSplit(split, totalMinor, currency, memberOrder, nameOf);
  const payerPreview = buildPayers(payers, totalMinor, currency, memberOrder, nameOf);
  const foreign = currency !== groupCurrency;
  const converted = foreign && totalMinor && parseRate(fxRate ?? '') ? convertMinor(totalMinor, decimals, getCurrency(groupCurrency).decimals, fxRate) : null;

  const categories = group.categories;
  const currencyOptions = group.group.multiCurrency ? CURRENCIES.map((c) => c.code) : [groupCurrency];

  const submit = handleSubmit((values) => {
    setSubmitted(true);
    const total = parseAmountToMinor(values.amount, getCurrency(values.currency).decimals);
    const p = buildPayers(payers, total, values.currency, memberOrder, nameOf);
    const s = buildSplit(split, total, values.currency, memberOrder, nameOf);
    if (!p.ok || !s.ok || total === null) {
      statusRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      return;
    }
    onSubmit(
      {
        title: values.title.trim(),
        description: null,
        notes: values.notes.trim() || null,
        amountMinor: total,
        currency: values.currency,
        fxRate: values.currency !== groupCurrency ? values.fxRate.trim() : null,
        date: values.date,
        category: values.category,
        planId: values.planId || null,
        payers: p.payers,
        split: s.split,
      },
      receipt,
    );
  });

  const addCategory = async () => {
    const label = (newCategory ?? '').trim();
    if (!label) return;
    setCategoryError(null);
    try {
      const res = await createCategory({ groupId: group.group.id, label }).unwrap();
      setValue('category', res.category.id, { shouldValidate: true });
      setNewCategory(null);
    } catch (e) {
      setCategoryError(toApiError(e).message);
    }
  };

  return (
    <Box component="form" id={formId} onSubmit={submit} noValidate>
      <Box component="fieldset" disabled={disabled} sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}>
      <Stack spacing={2.5}>
        <TextField
          label="What was it for?"
          placeholder="e.g. Dinner at the beach shack"
          autoFocus
          required
          {...register('title')}
          error={!!formState.errors.title}
          helperText={formState.errors.title?.message}
          slotProps={{ htmlInput: { maxLength: 120 } }}
        />

        <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr 110px', sm: '1fr 140px' } }}>
          <TextField
            label="Amount"
            required
            {...register('amount')}
            error={!!formState.errors.amount}
            helperText={formState.errors.amount?.message}
            slotProps={{
              htmlInput: { inputMode: 'decimal', className: 'tabular' },
              input: { startAdornment: <InputAdornment position="start">{symbol}</InputAdornment> },
            }}
          />
          <Controller
            control={control}
            name="currency"
            render={({ field }) => (
              <TextField select label="Currency" {...field} disabled={currencyOptions.length === 1} helperText={currencyOptions.length === 1 ? 'Group currency' : undefined}>
                {currencyOptions.map((c) => (
                  <MenuItem key={c} value={c}>
                    {c}
                  </MenuItem>
                ))}
              </TextField>
            )}
          />
        </Box>

        {foreign && (
          <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, alignItems: 'start' }}>
            <TextField
              label={`Manual exchange rate (1 ${currency} = ? ${groupCurrency})`}
              required
              {...register('fxRate')}
              error={!!formState.errors.fxRate}
              helperText={formState.errors.fxRate?.message ?? 'Enter the rate you actually used. ShareSpace does not fetch live rates.'}
              slotProps={{ htmlInput: { inputMode: 'decimal', className: 'tabular' } }}
            />
            <Box sx={{ p: 1.5, borderRadius: 2.5, bgcolor: 'surface.sage' }}>
              <Typography variant="caption" component="p">
                Recorded in {groupCurrency} for balances
              </Typography>
              <Typography variant="subtitle1" className="tabular">
                {converted !== null ? formatMoney(converted, groupCurrency) : '—'}
              </Typography>
            </Box>
          </Box>
        )}

        <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
          <TextField
            label="Date"
            type="date"
            required
            {...register('date')}
            error={!!formState.errors.date}
            helperText={formState.errors.date?.message}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <Controller
            control={control}
            name="category"
            render={({ field }) => (
              <TextField
                select
                label="Category"
                {...field}
                onChange={(e) => (e.target.value === '__new__' ? setNewCategory('') : field.onChange(e))}
                error={!!formState.errors.category}
                helperText={formState.errors.category?.message}
                slotProps={{ select: { renderValue: (v) => categoryLabel(v as string, categories) } }}
              >
                {[...DEFAULT_CATEGORIES, ...categories].map((c) => (
                  <MenuItem key={c.id} value={c.id}>
                    <ListItemIcon sx={{ minWidth: 36 }}>
                      <CategoryIcon category={c.id} size={26} />
                    </ListItemIcon>
                    {c.label}
                  </MenuItem>
                ))}
                <Divider />
                <MenuItem value="__new__">
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    <Plus size={18} />
                  </ListItemIcon>
                  New category…
                </MenuItem>
              </TextField>
            )}
          />
        </Box>
        {newCategory !== null && (
          <Stack direction="row" spacing={1} alignItems="flex-start">
            <TextField
              label="New category name"
              value={newCategory}
              autoFocus
              onChange={(e) => setNewCategory(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void addCategory();
                }
              }}
              error={!!categoryError}
              helperText={categoryError ?? undefined}
              slotProps={{ htmlInput: { maxLength: 40 } }}
            />
            <Button variant="outlined" onClick={() => void addCategory()} disabled={creatingCategory || !newCategory.trim()}>
              Add
            </Button>
            <IconButton aria-label="Cancel new category" onClick={() => setNewCategory(null)}>
              <X size={18} />
            </IconButton>
          </Stack>
        )}

        <Divider />
        <Box>
          <Typography variant="h4" component="h3" sx={{ mb: 1.25 }}>
            Who paid?
          </Typography>
          <PayerEditor members={members} draft={payers} onChange={setPayers} currency={currency} totalMinor={totalMinor} preview={payerPreview} showErrors={submitted} />
        </Box>

        <Divider />
        <Box ref={statusRef}>
          <Typography variant="h4" component="h3" sx={{ mb: 1.25 }}>
            How should it be split?
          </Typography>
          <SplitEditor
            members={members}
            draft={split}
            onChange={setSplit}
            currency={currency}
            totalMinor={totalMinor}
            preview={splitPreview}
            onUseAmount={(text) => setValue('amount', text, { shouldValidate: true })}
          />
        </Box>

        <Divider />
        <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: plans.length ? '1fr 1fr' : '1fr' } }}>
          {plans.length > 0 && (
            <Controller
              control={control}
              name="planId"
              render={({ field }) => (
                <TextField select label="Plan (optional)" {...field}>
                  <MenuItem value="">No plan</MenuItem>
                  {plans.map((p) => (
                    <MenuItem key={p.id} value={p.id}>
                      {p.title}
                    </MenuItem>
                  ))}
                </TextField>
              )}
            />
          )}
          <TextField label="Notes (optional)" multiline minRows={1} maxRows={4} {...register('notes')} error={!!formState.errors.notes} helperText={formState.errors.notes?.message} />
        </Box>

        {allowReceipt && (
          <Box>
            {receipt ? (
              <Chip
                icon={<Paperclip size={14} />}
                label={`${receipt.name} · ${formatBytes(receipt.size)}`}
                onDelete={() => setReceipt(null)}
                deleteIcon={<X size={14} aria-label="Remove receipt" />}
                sx={{ maxWidth: '100%' }}
              />
            ) : (
              <Button component="label" variant="outlined" startIcon={<Paperclip size={16} />}>
                Attach receipt (optional)
                <input
                  type="file"
                  hidden
                  accept={ACCEPTED_UPLOAD_TYPES.join(',')}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    const err = validateUpload(file);
                    setReceiptError(err);
                    if (!err) setReceipt(file);
                  }}
                />
              </Button>
            )}
            {receiptError && (
              <Alert severity="error" sx={{ mt: 1 }}>
                {receiptError}
              </Alert>
            )}
            <Typography variant="caption" component="p" sx={{ mt: 0.5 }}>
              JPEG, PNG, WebP, GIF or PDF up to 10 MB. Uploaded after the expense is saved.
            </Typography>
          </Box>
        )}

      </Stack>
      </Box>
    </Box>
  );
}

