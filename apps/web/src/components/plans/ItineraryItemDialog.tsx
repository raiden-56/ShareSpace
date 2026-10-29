import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, InputAdornment, Stack, TextField, useMediaQuery, useTheme } from '@mui/material';
import { getCurrency, parseAmountToMinor, type ItineraryItemInput } from '@sharespace/core';
import { toApiError, useAddItineraryItemMutation, useUpdateItineraryItemMutation } from '../../api/api';
import type { ItineraryItem } from '../../api/types';
import { minorToInput } from '../../lib/format';
import { useAppDispatch } from '../../store';
import { showToast } from '../../store/ui';

const formSchema = z
  .object({
    title: z.string().trim().min(1, 'Title is required').max(120, 'Title must be at most 120 characters'),
    description: z.string().max(1000, 'Description must be at most 1000 characters'),
    date: z.string(),
    startTime: z.string(),
    endTime: z.string(),
    location: z.string().max(200, 'Location must be at most 200 characters'),
    cost: z.string().max(20),
    notes: z.string().max(1000, 'Notes must be at most 1000 characters'),
  })
  .superRefine((v, ctx) => {
    const time = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (v.startTime && !time.test(v.startTime)) ctx.addIssue({ code: 'custom', path: ['startTime'], message: 'Use the format HH:MM' });
    if (v.endTime && !time.test(v.endTime)) ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'Use the format HH:MM' });
    if (v.startTime && v.endTime && v.endTime < v.startTime) ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'End time must be after the start time' });
    if (v.date && !/^\d{4}-\d{2}-\d{2}$/.test(v.date)) ctx.addIssue({ code: 'custom', path: ['date'], message: 'Enter a valid date' });
  });

type FormValues = z.infer<typeof formSchema>;

interface Props {
  open: boolean;
  onClose: () => void;
  groupId: string;
  planId: string;
  currency: string;
  /** Edit this item; omit to add a new one. */
  item?: ItineraryItem | null;
  /** Prefill the date of a new item (e.g. the plan's start date). */
  defaultDate?: string;
}

const toForm = (item: ItineraryItem | null | undefined, currency: string, defaultDate?: string): FormValues => ({
  title: item?.title ?? '',
  description: item?.description ?? '',
  date: item ? (item.date ?? '') : (defaultDate ?? ''),
  startTime: item?.startTime ?? '',
  endTime: item?.endTime ?? '',
  location: item?.location ?? '',
  cost: item?.estimatedCostMinor ? minorToInput(item.estimatedCostMinor, currency) : '',
  notes: item?.notes ?? '',
});

export function ItineraryItemDialog({ open, onClose, groupId, planId, currency, item, defaultDate }: Props) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const dispatch = useAppDispatch();
  const [add, addState] = useAddItineraryItemMutation();
  const [update, updateState] = useUpdateItineraryItemMutation();
  const [serverError, setServerError] = useState<string | null>(null);
  const busy = addState.isLoading || updateState.isLoading;
  const { control, handleSubmit, reset, setError, formState } = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: toForm(item, currency, defaultDate) });

  useEffect(() => {
    if (open) {
      setServerError(null);
      reset(toForm(item, currency, defaultDate));
    }
  }, [open, item, currency, defaultDate, reset]);

  const onSubmit = handleSubmit(async (v) => {
    setServerError(null);
    let estimatedCostMinor: number | null = null;
    if (v.cost.trim()) {
      const parsed = parseAmountToMinor(v.cost, getCurrency(currency).decimals);
      if (parsed === null || parsed <= 0) {
        setError('cost', { message: 'Enter a positive amount' });
        return;
      }
      estimatedCostMinor = parsed;
    }
    const body: ItineraryItemInput = {
      title: v.title.trim(),
      description: v.description.trim() || null,
      date: v.date || null,
      startTime: v.startTime || null,
      endTime: v.endTime || null,
      location: v.location.trim() || null,
      estimatedCostMinor,
      notes: v.notes.trim() || null,
    };
    try {
      if (item) await update({ groupId, planId, itemId: item.id, body }).unwrap();
      else await add({ groupId, planId, body }).unwrap();
      dispatch(showToast({ message: item ? 'Itinerary item updated' : 'Added to itinerary' }));
      onClose();
    } catch (err) {
      setServerError(toApiError(err).message);
    }
  });

  const e = formState.errors;
  const shrink = { inputLabel: { shrink: true } } as const;
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullScreen={fullScreen} fullWidth maxWidth="sm" aria-labelledby="itinerary-form-title">
      <Box component="form" noValidate onSubmit={onSubmit} sx={{ display: 'contents' }}>
        <DialogTitle id="itinerary-form-title">{item ? 'Edit itinerary item' : 'Add to itinerary'}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2.25}>
            {serverError && <Alert severity="error">{serverError}</Alert>}
            <Controller name="title" control={control} render={({ field }) => <TextField label="Title" {...field} required autoFocus error={!!e.title} helperText={e.title?.message} placeholder="e.g. Check in at the homestay" />} />
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1.4fr 1fr 1fr' } }}>
              <Controller name="date" control={control} render={({ field }) => <TextField type="date" label="Date" {...field} error={!!e.date} helperText={e.date?.message} slotProps={shrink} />} />
              <Controller name="startTime" control={control} render={({ field }) => <TextField type="time" label="Start" {...field} error={!!e.startTime} helperText={e.startTime?.message} slotProps={shrink} />} />
              <Controller name="endTime" control={control} render={({ field }) => <TextField type="time" label="End" {...field} error={!!e.endTime} helperText={e.endTime?.message} slotProps={shrink} />} />
            </Box>
            <Controller name="location" control={control} render={({ field }) => <TextField label="Location (optional)" {...field} error={!!e.location} helperText={e.location?.message} />} />
            <Controller
              name="cost"
              control={control}
              render={({ field }) => (
                <TextField
                  label="Estimated cost (optional)"
                  {...field}
                  error={!!e.cost}
                  helperText={e.cost?.message ?? 'For planning only. Record actual spending as expenses.'}
                  slotProps={{ htmlInput: { inputMode: 'decimal', autoComplete: 'off' }, input: { startAdornment: <InputAdornment position="start">{currency}</InputAdornment> } }}
                />
              )}
            />
            <Controller name="description" control={control} render={({ field }) => <TextField label="Description (optional)" {...field} multiline minRows={2} error={!!e.description} helperText={e.description?.message} />} />
            <Controller name="notes" control={control} render={({ field }) => <TextField label="Notes (optional)" {...field} multiline minRows={2} error={!!e.notes} helperText={e.notes?.message} />} />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={onClose} color="inherit" disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={busy}>
            {busy ? 'Saving…' : item ? 'Save changes' : 'Add item'}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
