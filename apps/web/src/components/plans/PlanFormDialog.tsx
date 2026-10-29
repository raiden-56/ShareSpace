import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormGroup,
  FormHelperText,
  FormLabel,
  InputAdornment,
  MenuItem,
  Stack,
  TextField,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import {
  getCurrency,
  parseAmountToMinor,
  PLAN_STATUS_LABELS,
  PLAN_STATUSES,
  PLAN_TYPE_LABELS,
  PLAN_TYPES,
  type PlanInput,
} from '@sharespace/core';
import { toApiError, useCreatePlanMutation, useGroupQuery, useGroupsQuery, useUpdatePlanMutation } from '../../api/api';
import type { PlanSummary } from '../../api/types';
import { minorToInput, todayLocal } from '../../lib/format';
import { useAppDispatch } from '../../store';
import { showToast } from '../../store/ui';

const formSchema = z
  .object({
    groupId: z.string().min(1, 'Choose a group'),
    title: z.string().trim().min(1, 'Title is required').max(120, 'Title must be at most 120 characters'),
    type: z.enum(PLAN_TYPES),
    status: z.enum(PLAN_STATUSES),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a start date'),
    endDate: z.string(),
    location: z.string().max(200, 'Location must be at most 200 characters'),
    budget: z.string().max(20),
    participantIds: z.array(z.string()),
    description: z.string().max(2000, 'Description must be at most 2000 characters'),
    notes: z.string().max(4000, 'Notes must be at most 4000 characters'),
  })
  .superRefine((v, ctx) => {
    if (v.endDate && !/^\d{4}-\d{2}-\d{2}$/.test(v.endDate)) ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'Enter a valid date' });
    if (v.endDate && v.startDate && v.endDate < v.startDate) ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'End date must be on or after the start date' });
  });

type FormValues = z.infer<typeof formSchema>;

interface PlanFormDialogProps {
  open: boolean;
  onClose: () => void;
  /** Fixed group. When omitted, the user picks one of their editable groups. */
  groupId?: string;
  /** Edit this plan. */
  plan?: PlanSummary;
  onSaved?: (planId: string, groupId: string) => void;
}

function defaults(groupId: string | undefined, plan: PlanSummary | undefined, currency: string): FormValues {
  return {
    groupId: plan?.groupId ?? groupId ?? '',
    title: plan?.title ?? '',
    type: plan?.type ?? 'TRIP',
    status: plan?.status ?? 'PLANNING',
    startDate: plan?.startDate ?? todayLocal(),
    endDate: plan?.endDate ?? '',
    location: plan?.location ?? '',
    budget: plan?.estimatedBudgetMinor ? minorToInput(plan.estimatedBudgetMinor, currency) : '',
    participantIds: plan?.participantIds ?? [],
    description: plan?.description ?? '',
    notes: (plan as { notes?: string | null } | undefined)?.notes ?? '',
  };
}

export function PlanFormDialog({ open, onClose, groupId, plan, onSaved }: PlanFormDialogProps) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const dispatch = useAppDispatch();
  const editing = !!plan;
  const [createPlan, createState] = useCreatePlanMutation();
  const [updatePlan, updateState] = useUpdatePlanMutation();
  const [serverError, setServerError] = useState<string | null>(null);
  const busy = createState.isLoading || updateState.isLoading;

  const { data: groupsData } = useGroupsQuery(undefined, { skip: !open || !!groupId || editing });
  const selectableGroups = useMemo(() => (groupsData?.groups ?? []).filter((g) => g.role && g.role !== 'VIEWER' && !g.archivedAt), [groupsData]);

  const { control, handleSubmit, reset, watch, setValue, setError, formState } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: defaults(groupId, plan, 'INR'),
  });
  const selectedGroupId = watch('groupId');
  const { data: groupDetail, isFetching: groupLoading } = useGroupQuery(selectedGroupId, { skip: !open || !selectedGroupId });
  const currency = groupDetail?.group.currency ?? 'INR';

  // Reset whenever the dialog opens so stale edits never leak between plans.
  useEffect(() => {
    if (open) {
      setServerError(null);
      reset(defaults(groupId, plan, groupDetail?.group.currency ?? 'INR'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, plan?.id, groupId]);

  // New plans include every active member by default once the group's members are known.
  const [participantsTouched, setParticipantsTouched] = useState(false);
  useEffect(() => {
    if (!open) setParticipantsTouched(false);
  }, [open]);
  useEffect(() => {
    if (!open || editing || participantsTouched || !groupDetail || groupDetail.group.id !== selectedGroupId) return;
    setValue('participantIds', groupDetail.members.filter((m) => m.status === 'ACTIVE').map((m) => m.id));
  }, [open, editing, participantsTouched, groupDetail, selectedGroupId, setValue]);

  // Re-render the budget with the group's currency decimals once known (edit mode).
  useEffect(() => {
    if (open && editing && plan?.estimatedBudgetMinor && groupDetail) setValue('budget', minorToInput(plan.estimatedBudgetMinor, groupDetail.group.currency));
  }, [open, editing, plan?.estimatedBudgetMinor, groupDetail, setValue]);

  const memberOptions = useMemo(() => {
    if (!groupDetail) return [];
    const selected = new Set(plan?.participantIds ?? []);
    return groupDetail.members.filter((m) => m.status === 'ACTIVE' || selected.has(m.id));
  }, [groupDetail, plan?.participantIds]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    let estimatedBudgetMinor: number | null = null;
    if (values.budget.trim()) {
      const parsed = parseAmountToMinor(values.budget, getCurrency(currency).decimals);
      if (parsed === null || parsed <= 0) {
        setError('budget', { message: `Enter a positive amount with at most ${getCurrency(currency).decimals} decimal places` });
        return;
      }
      estimatedBudgetMinor = parsed;
    }
    const body: PlanInput = {
      title: values.title.trim(),
      description: values.description.trim() || null,
      type: values.type,
      status: values.status,
      startDate: values.startDate,
      endDate: values.endDate || null,
      location: values.location.trim() || null,
      estimatedBudgetMinor,
      participantIds: values.participantIds,
      notes: values.notes.trim() || null,
    };
    try {
      if (editing && plan) {
        await updatePlan({ groupId: plan.groupId, planId: plan.id, body }).unwrap();
        dispatch(showToast({ message: 'Plan updated' }));
        onSaved?.(plan.id, plan.groupId);
      } else {
        const res = await createPlan({ groupId: values.groupId, body }).unwrap();
        dispatch(showToast({ message: 'Plan created' }));
        onSaved?.(res.plan.id, values.groupId);
      }
      onClose();
    } catch (err) {
      setServerError(toApiError(err).message);
    }
  });

  const errors = formState.errors;
  const dateLabel = { inputLabel: { shrink: true } } as const;

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullScreen={fullScreen} fullWidth maxWidth="sm" aria-labelledby="plan-form-title">
      <Box component="form" noValidate onSubmit={onSubmit} sx={{ display: 'contents' }}>
        <DialogTitle id="plan-form-title">{editing ? 'Edit plan' : 'New plan'}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2.25}>
            {serverError && <Alert severity="error">{serverError}</Alert>}
            {!groupId && !editing && (
              <Controller
                name="groupId"
                control={control}
                render={({ field }) => (
                  <TextField
                    select
                    label="Group"
                    {...field}
                    error={!!errors.groupId}
                    helperText={errors.groupId?.message ?? (selectableGroups.length === 0 ? 'You need a group where you can edit records.' : undefined)}
                    required
                  >
                    {selectableGroups.map((g) => (
                      <MenuItem key={g.id} value={g.id}>
                        {g.name}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              />
            )}
            <Controller
              name="title"
              control={control}
              render={({ field }) => (
                <TextField label="Title" {...field} required autoFocus error={!!errors.title} helperText={errors.title?.message} placeholder="e.g. Weekend in Coorg" />
              )}
            />
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
              <Controller
                name="type"
                control={control}
                render={({ field }) => (
                  <TextField select label="Type" {...field}>
                    {PLAN_TYPES.map((t) => (
                      <MenuItem key={t} value={t}>
                        {PLAN_TYPE_LABELS[t]}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              />
              <Controller
                name="status"
                control={control}
                render={({ field }) => (
                  <TextField select label="Status" {...field}>
                    {PLAN_STATUSES.map((s) => (
                      <MenuItem key={s} value={s}>
                        {PLAN_STATUS_LABELS[s]}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              />
              <Controller
                name="startDate"
                control={control}
                render={({ field }) => (
                  <TextField type="date" label="Start date" {...field} required error={!!errors.startDate} helperText={errors.startDate?.message} slotProps={dateLabel} />
                )}
              />
              <Controller
                name="endDate"
                control={control}
                render={({ field }) => (
                  <TextField type="date" label="End date (optional)" {...field} error={!!errors.endDate} helperText={errors.endDate?.message} slotProps={dateLabel} />
                )}
              />
            </Box>
            <Controller
              name="location"
              control={control}
              render={({ field }) => <TextField label="Location (optional)" {...field} error={!!errors.location} helperText={errors.location?.message} />}
            />
            <Controller
              name="budget"
              control={control}
              render={({ field }) => (
                <TextField
                  label="Estimated budget (optional)"
                  {...field}
                  error={!!errors.budget}
                  helperText={errors.budget?.message ?? 'Compared with expenses you link to this plan.'}
                  slotProps={{
                    htmlInput: { inputMode: 'decimal', autoComplete: 'off' },
                    input: { startAdornment: <InputAdornment position="start">{currency}</InputAdornment> },
                  }}
                />
              )}
            />
            <Controller
              name="participantIds"
              control={control}
              render={({ field }) => {
                const selected = new Set(field.value);
                const allIds = memberOptions.map((m) => m.id);
                const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));
                const toggle = (id: string) => {
                  setParticipantsTouched(true);
                  field.onChange(selected.has(id) ? field.value.filter((x) => x !== id) : [...field.value, id]);
                };
                return (
                  <FormControl component="fieldset" variant="standard">
                    <FormLabel component="legend" sx={{ fontWeight: 600, fontSize: '0.875rem', mb: 0.5 }}>
                      Participants
                    </FormLabel>
                    {!selectedGroupId ? (
                      <FormHelperText>Choose a group to pick participants.</FormHelperText>
                    ) : groupLoading && memberOptions.length === 0 ? (
                      <FormHelperText>Loading members…</FormHelperText>
                    ) : (
                      <>
                        <FormControlLabel
                          control={
                            <Checkbox
                              checked={allSelected}
                              indeterminate={!allSelected && field.value.length > 0}
                              onChange={() => {
                                setParticipantsTouched(true);
                                field.onChange(allSelected ? [] : allIds);
                              }}
                            />
                          }
                          label="Everyone"
                        />
                        <FormGroup sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, pl: 1 }}>
                          {memberOptions.map((m) => (
                            <FormControlLabel
                              key={m.id}
                              control={<Checkbox checked={selected.has(m.id)} onChange={() => toggle(m.id)} />}
                              label={`${m.displayName}${m.isYou ? ' (you)' : ''}`}
                              sx={{ minWidth: 0, '& .MuiFormControlLabel-label': { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }}
                            />
                          ))}
                        </FormGroup>
                      </>
                    )}
                  </FormControl>
                );
              }}
            />
            <Controller
              name="description"
              control={control}
              render={({ field }) => (
                <TextField label="Description (optional)" {...field} multiline minRows={2} error={!!errors.description} helperText={errors.description?.message} />
              )}
            />
            <Controller
              name="notes"
              control={control}
              render={({ field }) => <TextField label="Notes (optional)" {...field} multiline minRows={2} error={!!errors.notes} helperText={errors.notes?.message} />}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={onClose} color="inherit" disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={busy}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Create plan'}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
