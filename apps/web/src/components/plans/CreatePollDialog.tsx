import { useEffect, useState } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
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
  IconButton,
  MenuItem,
  Radio,
  RadioGroup,
  Stack,
  Switch,
  TextField,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { Plus, X } from 'lucide-react';
import { toApiError, useCreatePollMutation } from '../../api/api';
import type { Member } from '../../api/types';
import { useAppDispatch } from '../../store';
import { showToast } from '../../store/ui';

const MAX_OPTIONS = 10;

const formSchema = z
  .object({
    question: z.string().trim().min(1, 'Question is required').max(200, 'Question must be at most 200 characters'),
    options: z
      .array(z.object({ value: z.string().trim().min(1, 'Option cannot be empty').max(120, 'Option must be at most 120 characters') }))
      .min(2, 'Add at least two options')
      .max(MAX_OPTIONS, `Use at most ${MAX_OPTIONS} options`),
    closesAt: z.string(),
    everyone: z.boolean(),
    eligibleMemberIds: z.array(z.string()),
    allowVoteChange: z.boolean(),
    planId: z.string(),
  })
  .superRefine((v, ctx) => {
    const seen = new Map<string, number>();
    v.options.forEach((o, i) => {
      const key = o.value.trim().toLowerCase();
      if (!key) return;
      if (seen.has(key)) ctx.addIssue({ code: 'custom', path: ['options', i, 'value'], message: 'Options must be unique' });
      else seen.set(key, i);
    });
    if (v.closesAt) {
      const d = new Date(v.closesAt);
      if (Number.isNaN(d.getTime())) ctx.addIssue({ code: 'custom', path: ['closesAt'], message: 'Enter a valid date and time' });
      else if (d <= new Date()) ctx.addIssue({ code: 'custom', path: ['closesAt'], message: 'The closing time must be in the future' });
    }
    if (!v.everyone && v.eligibleMemberIds.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['eligibleMemberIds'], message: 'Choose at least one voter' });
    }
  });

type FormValues = z.infer<typeof formSchema>;

const blank = (planId?: string): FormValues => ({
  question: '',
  options: [{ value: '' }, { value: '' }],
  closesAt: '',
  everyone: true,
  eligibleMemberIds: [],
  allowVoteChange: true,
  planId: planId ?? '',
});

interface CreatePollDialogProps {
  open: boolean;
  onClose: () => void;
  groupId: string;
  /** Active group members; only those with an account can vote. */
  members: Member[];
  plans?: { id: string; title: string }[];
  /** Link the poll to this plan (and lock the choice). */
  presetPlanId?: string;
}

export function CreatePollDialog({ open, onClose, groupId, members, plans = [], presetPlanId }: CreatePollDialogProps) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const dispatch = useAppDispatch();
  const [createPoll, { isLoading }] = useCreatePollMutation();
  const [serverError, setServerError] = useState<string | null>(null);
  const voters = members.filter((m) => m.hasAccount && m.status === 'ACTIVE');

  const { control, handleSubmit, reset, watch, formState } = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: blank(presetPlanId) });
  const { fields, append, remove } = useFieldArray({ control, name: 'options' });
  const everyone = watch('everyone');

  useEffect(() => {
    if (open) {
      setServerError(null);
      reset(blank(presetPlanId));
    }
  }, [open, presetPlanId, reset]);

  const onSubmit = handleSubmit(async (v) => {
    setServerError(null);
    try {
      await createPoll({
        groupId,
        body: {
          question: v.question.trim(),
          options: v.options.map((o) => o.value.trim()),
          closesAt: v.closesAt ? new Date(v.closesAt).toISOString() : null,
          eligibleMemberIds: v.everyone ? [] : v.eligibleMemberIds,
          allowVoteChange: v.allowVoteChange,
          planId: v.planId || null,
        },
      }).unwrap();
      dispatch(showToast({ message: 'Poll created' }));
      onClose();
    } catch (err) {
      setServerError(toApiError(err).message);
    }
  });

  const errors = formState.errors;
  const optionsError = errors.options?.message ?? errors.options?.root?.message;

  return (
    <Dialog open={open} onClose={isLoading ? undefined : onClose} fullScreen={fullScreen} fullWidth maxWidth="sm" aria-labelledby="poll-form-title">
      <Box component="form" noValidate onSubmit={onSubmit} sx={{ display: 'contents' }}>
        <DialogTitle id="poll-form-title">New poll</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2.25}>
            {serverError && <Alert severity="error">{serverError}</Alert>}
            <Controller
              name="question"
              control={control}
              render={({ field }) => (
                <TextField label="Question" {...field} required autoFocus error={!!errors.question} helperText={errors.question?.message} placeholder="e.g. Which weekend works best?" />
              )}
            />
            <FormControl component="fieldset" error={!!optionsError}>
              <FormLabel component="legend" sx={{ fontWeight: 600, fontSize: '0.875rem', mb: 1 }}>
                Options
              </FormLabel>
              <Stack spacing={1.25}>
                {fields.map((f, i) => (
                  <Stack key={f.id} direction="row" spacing={1} alignItems="flex-start">
                    <Controller
                      name={`options.${i}.value`}
                      control={control}
                      render={({ field }) => (
                        <TextField
                          label={`Option ${i + 1}`}
                          {...field}
                          error={!!errors.options?.[i]?.value}
                          helperText={errors.options?.[i]?.value?.message}
                        />
                      )}
                    />
                    <IconButton aria-label={`Remove option ${i + 1}`} onClick={() => remove(i)} disabled={fields.length <= 2} sx={{ width: 40, height: 40 }}>
                      <X size={18} />
                    </IconButton>
                  </Stack>
                ))}
              </Stack>
              {optionsError && <FormHelperText>{optionsError}</FormHelperText>}
              <Box>
                <Button startIcon={<Plus size={16} />} onClick={() => append({ value: '' })} disabled={fields.length >= MAX_OPTIONS} sx={{ mt: 1 }}>
                  Add option
                </Button>
              </Box>
            </FormControl>
            <Controller
              name="closesAt"
              control={control}
              render={({ field }) => (
                <TextField
                  type="datetime-local"
                  label="Closes at (optional)"
                  {...field}
                  error={!!errors.closesAt}
                  helperText={errors.closesAt?.message ?? 'Leave empty to close the poll manually.'}
                  slotProps={{ inputLabel: { shrink: true } }}
                />
              )}
            />
            <FormControl component="fieldset" error={!!errors.eligibleMemberIds}>
              <FormLabel component="legend" sx={{ fontWeight: 600, fontSize: '0.875rem' }}>
                Who can vote
              </FormLabel>
              <Controller
                name="everyone"
                control={control}
                render={({ field }) => (
                  <RadioGroup value={field.value ? 'all' : 'some'} onChange={(e) => field.onChange(e.target.value === 'all')}>
                    <FormControlLabel value="all" control={<Radio />} label="Everyone with an account" />
                    <FormControlLabel value="some" control={<Radio />} label="Selected members" />
                  </RadioGroup>
                )}
              />
              {!everyone && (
                <Controller
                  name="eligibleMemberIds"
                  control={control}
                  render={({ field }) => (
                    <FormGroup sx={{ pl: 3.5, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
                      {voters.map((m) => (
                        <FormControlLabel
                          key={m.id}
                          control={
                            <Checkbox
                              checked={field.value.includes(m.id)}
                              onChange={() => field.onChange(field.value.includes(m.id) ? field.value.filter((x) => x !== m.id) : [...field.value, m.id])}
                            />
                          }
                          label={`${m.displayName}${m.isYou ? ' (you)' : ''}`}
                        />
                      ))}
                    </FormGroup>
                  )}
                />
              )}
              <FormHelperText>{errors.eligibleMemberIds?.message ?? 'Members without an account cannot vote until they join.'}</FormHelperText>
            </FormControl>
            <Controller
              name="allowVoteChange"
              control={control}
              render={({ field }) => (
                <FormControlLabel control={<Switch checked={field.value} onChange={(e) => field.onChange(e.target.checked)} />} label="Allow people to change their vote while the poll is open" />
              )}
            />
            {!presetPlanId && plans.length > 0 && (
              <Controller
                name="planId"
                control={control}
                render={({ field }) => (
                  <TextField select label="Related plan (optional)" {...field}>
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
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={onClose} color="inherit" disabled={isLoading}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={isLoading}>
            {isLoading ? 'Creating…' : 'Create poll'}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
