import { useEffect, useMemo } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
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
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { Plus, Trash2 } from 'lucide-react';
import { getCurrency, parseAmountToMinor, type BudgetInput } from '@sharespace/core';
import { toApiError, useSaveBudgetMutation } from '../../api/api';
import type { BudgetResponse } from '../../api/types';
import { minorToInput } from '../../lib/format';
import { useAppDispatch } from '../../store';
import { showToast } from '../../store/ui';

export interface BudgetFormValues {
  total: string;
  startDate: string;
  endDate: string;
  threshold: string;
  categories: { category: string; amount: string }[];
}

/** Form-level validation. Amounts stay strings until converted to exact minor units. */
export function budgetFormSchema(currency: string) {
  const { decimals } = getCurrency(currency);
  const amount = (label: string) =>
    z
      .string()
      .trim()
      .min(1, `${label} is required`)
      .refine((v) => {
        const m = parseAmountToMinor(v, decimals);
        return m !== null && m > 0;
      }, `Enter a ${label.toLowerCase()} greater than zero${decimals > 0 ? ` with at most ${decimals} decimal places` : ''}`);
  return z
    .object({
      total: amount('Total budget'),
      startDate: z.string(),
      endDate: z.string(),
      threshold: z
        .string()
        .trim()
        .refine((v) => /^\d+$/.test(v) && Number(v) >= 10 && Number(v) <= 100, 'Warning threshold must be a whole number between 10 and 100'),
      categories: z.array(z.object({ category: z.string().min(1, 'Choose a category'), amount: amount('Amount') })),
    })
    .refine((v) => !v.startDate || !v.endDate || v.startDate <= v.endDate, { message: 'End date must be on or after the start date', path: ['endDate'] })
    .refine((v) => new Set(v.categories.map((c) => c.category)).size === v.categories.length, {
      message: 'Each category can only have one budget',
      path: ['categories'],
    });
}

export function toBudgetInput(values: BudgetFormValues, currency: string): BudgetInput {
  const { decimals } = getCurrency(currency);
  return {
    totalMinor: parseAmountToMinor(values.total, decimals)!,
    startDate: values.startDate || null,
    endDate: values.endDate || null,
    warningThresholdPct: Number(values.threshold),
    categories: values.categories.map((c) => ({ category: c.category, amountMinor: parseAmountToMinor(c.amount, decimals)! })),
  };
}

function defaults(existing: BudgetResponse['budget'], currency: string): BudgetFormValues {
  return {
    total: existing ? minorToInput(existing.totalMinor, currency) : '',
    startDate: existing?.startDate ?? '',
    endDate: existing?.endDate ?? '',
    threshold: String(existing?.warningThresholdPct ?? 80),
    categories: existing?.categories.map((c) => ({ category: c.category, amount: minorToInput(c.amountMinor, currency) })) ?? [],
  };
}

interface BudgetFormDialogProps {
  open: boolean;
  onClose: () => void;
  groupId: string;
  currency: string;
  existing: BudgetResponse['budget'];
  categories: { id: string; label: string }[];
  /** Override the save action (used in tests). */
  onSubmitValues?: (input: BudgetInput) => Promise<void> | void;
}

export function BudgetFormDialog({ open, onClose, groupId, currency, existing, categories, onSubmitValues }: BudgetFormDialogProps) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const dispatch = useAppDispatch();
  const [save, { isLoading, error, reset: resetMutation }] = useSaveBudgetMutation();
  const schema = useMemo(() => budgetFormSchema(currency), [currency]);
  const form = useForm<BudgetFormValues>({ resolver: zodResolver(schema), defaultValues: defaults(existing, currency), mode: 'onTouched' });
  const { control, handleSubmit, reset, formState } = form;
  const rows = useFieldArray({ control, name: 'categories' });
  const symbol = getCurrency(currency).symbol;

  useEffect(() => {
    if (open) {
      reset(defaults(existing, currency));
      resetMutation();
    }
  }, [open, existing, currency, reset, resetMutation]);

  const onSubmit = handleSubmit(async (values) => {
    const input = toBudgetInput(values, currency);
    if (onSubmitValues) {
      await onSubmitValues(input);
      return;
    }
    try {
      await save({ groupId, body: input }).unwrap();
      dispatch(showToast({ message: existing ? 'Budget updated' : 'Budget saved' }));
      onClose();
    } catch {
      /* error rendered from mutation state */
    }
  });

  const apiError = error ? toApiError(error) : null;
  const categoriesError = (formState.errors.categories as { message?: string; root?: { message?: string } } | undefined)?.root?.message ?? (formState.errors.categories as { message?: string } | undefined)?.message;

  return (
    <Dialog open={open} onClose={isLoading ? undefined : onClose} fullScreen={fullScreen} maxWidth="sm" fullWidth aria-labelledby="budget-form-title">
      <form onSubmit={onSubmit} noValidate>
        <DialogTitle id="budget-form-title">{existing ? 'Edit budget' : 'Set a budget'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2.25} sx={{ pt: 1 }}>
            {apiError && <Alert severity="error">{apiError.message}</Alert>}
            <Controller
              control={control}
              name="total"
              render={({ field, fieldState }) => (
                <TextField
                  {...field}
                  label={`Total budget (${currency})`}
                  inputMode="decimal"
                  autoFocus={!fullScreen}
                  error={!!fieldState.error}
                  helperText={fieldState.error?.message ?? 'Compared against recorded group expenses only.'}
                  slotProps={{ input: { startAdornment: <InputAdornment position="start">{symbol}</InputAdornment> }, htmlInput: { inputMode: 'decimal' } }}
                />
              )}
            />
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
              <Controller
                control={control}
                name="startDate"
                render={({ field, fieldState }) => (
                  <TextField {...field} type="date" label="Start date (optional)" error={!!fieldState.error} helperText={fieldState.error?.message} slotProps={{ inputLabel: { shrink: true } }} />
                )}
              />
              <Controller
                control={control}
                name="endDate"
                render={({ field, fieldState }) => (
                  <TextField {...field} type="date" label="End date (optional)" error={!!fieldState.error} helperText={fieldState.error?.message} slotProps={{ inputLabel: { shrink: true } }} />
                )}
              />
            </Box>
            <Controller
              control={control}
              name="threshold"
              render={({ field, fieldState }) => (
                <TextField
                  {...field}
                  label="Warn when spending reaches"
                  error={!!fieldState.error}
                  helperText={fieldState.error?.message ?? 'Members get an in-app notification once when this percentage is reached, and again if the budget is exceeded.'}
                  slotProps={{ input: { endAdornment: <InputAdornment position="end">%</InputAdornment> }, htmlInput: { inputMode: 'numeric' } }}
                />
              )}
            />

            <Box>
              <Typography variant="h4" component="h3">
                Category budgets
              </Typography>
              <Typography variant="caption" component="p" sx={{ mb: 1.5 }}>
                Optional limits for individual categories.
              </Typography>
              <Stack spacing={1.5}>
                {rows.fields.map((row, index) => (
                  <Stack key={row.id} direction="row" spacing={1} alignItems="flex-start">
                    <Controller
                      control={control}
                      name={`categories.${index}.category`}
                      render={({ field, fieldState }) => (
                        <TextField {...field} select label="Category" error={!!fieldState.error} helperText={fieldState.error?.message} sx={{ flex: 1.3 }}>
                          {categories.map((c) => (
                            <MenuItem key={c.id} value={c.id}>
                              {c.label}
                            </MenuItem>
                          ))}
                        </TextField>
                      )}
                    />
                    <Controller
                      control={control}
                      name={`categories.${index}.amount`}
                      render={({ field, fieldState }) => (
                        <TextField
                          {...field}
                          label="Amount"
                          error={!!fieldState.error}
                          helperText={fieldState.error?.message}
                          sx={{ flex: 1 }}
                          slotProps={{ input: { startAdornment: <InputAdornment position="start">{symbol}</InputAdornment> }, htmlInput: { inputMode: 'decimal' } }}
                        />
                      )}
                    />
                    <IconButton onClick={() => rows.remove(index)} aria-label={`Remove category budget ${index + 1}`} sx={{ mt: 0.25 }}>
                      <Trash2 size={18} />
                    </IconButton>
                  </Stack>
                ))}
                {categoriesError && (
                  <Typography variant="caption" color="error" role="alert">
                    {categoriesError}
                  </Typography>
                )}
                <Box>
                  <Button startIcon={<Plus size={16} />} onClick={() => rows.append({ category: '', amount: '' })} disabled={rows.fields.length >= 30}>
                    Add category budget
                  </Button>
                </Box>
              </Stack>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={onClose} color="inherit" disabled={isLoading}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={isLoading}>
            {isLoading ? 'Saving…' : 'Save budget'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
