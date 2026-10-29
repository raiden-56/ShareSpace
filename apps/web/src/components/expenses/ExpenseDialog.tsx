import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  MenuItem,
  Skeleton,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { X } from 'lucide-react';
import { DEFAULT_CATEGORIES } from '@sharespace/core';
import {
  api,
  toApiError,
  useCreateExpenseMutation,
  useExpenseQuery,
  useGroupPlansQuery,
  useGroupQuery,
  useGroupsQuery,
  useUpdateExpenseMutation,
} from '../../api/api';
import type { GroupDetail } from '../../api/types';
import { newRequestId } from '../../lib/ids';
import { todayLocal } from '../../lib/format';
import { uploadReceipt } from '../../lib/upload';
import { useAppDispatch, useAppSelector } from '../../store';
import { closeExpenseDialog, setCreateGroupOpen, showToast, type ExpenseDialogState } from '../../store/ui';
import { ExpenseForm, type ExpensePayload } from './ExpenseForm';
import { emptySplitDraft, initialFromExpense, type ExpenseFormInitial } from './splitModel';

type Session = ExpenseDialogState & { key: string };

/** Global add/edit/duplicate expense dialog (full-screen on phones). */
export function ExpenseDialog() {
  const state = useAppSelector((s) => s.ui.expenseDialog);
  const dispatch = useAppDispatch();
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);

  // Keep the last session mounted during the exit transition; a new open starts a fresh session.
  useEffect(() => {
    if (state.open) setSession({ ...state, key: newRequestId() });
  }, [state]);

  const close = () => {
    if (!busy) dispatch(closeExpenseDialog());
  };

  return (
    <Dialog
      open={state.open}
      onClose={close}
      fullScreen={fullScreen}
      fullWidth
      maxWidth="md"
      aria-labelledby="expense-dialog-title"
      slotProps={{ transition: { onExited: () => setSession(null) } }}
    >
      {session && <ExpenseDialogBody key={session.key} session={session} onClose={close} onBusyChange={setBusy} />}
    </Dialog>
  );
}

function ExpenseDialogBody({ session, onClose, onBusyChange }: { session: Session; onClose: () => void; onBusyChange: (busy: boolean) => void }) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [clientRequestId] = useState(() => newRequestId());
  const [formKey, setFormKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const groupsQuery = useGroupsQuery(undefined, { skip: !!session.groupId });
  const eligibleGroups = useMemo(() => (groupsQuery.data?.groups ?? []).filter((g) => g.role && g.role !== 'VIEWER' && !g.archivedAt), [groupsQuery.data]);
  const [groupId, setGroupId] = useState(session.groupId ?? '');
  useEffect(() => {
    if (!groupId && eligibleGroups[0]) setGroupId(eligibleGroups[0].id);
  }, [groupId, eligibleGroups]);

  const sourceId = session.expenseId ?? session.duplicateOfId;
  const mode: 'add' | 'edit' | 'duplicate' = session.expenseId ? 'edit' : session.duplicateOfId ? 'duplicate' : 'add';
  const groupQuery = useGroupQuery(groupId, { skip: !groupId });
  const plansQuery = useGroupPlansQuery(groupId, { skip: !groupId });
  const expenseQuery = useExpenseQuery({ groupId, expenseId: sourceId ?? '' }, { skip: !groupId || !sourceId });
  const [createExpense] = useCreateExpenseMutation();
  const [updateExpense] = useUpdateExpenseMutation();

  useEffect(() => onBusyChange(saving), [saving, onBusyChange]);

  const group = groupQuery.data;
  const source = expenseQuery.data?.expense;
  const initial: ExpenseFormInitial | null = useMemo(() => {
    if (!group) return null;
    if (sourceId) {
      if (!source) return null;
      return mode === 'duplicate' ? initialFromExpense(source, { date: todayLocal(), repeat: 'NONE' }) : initialFromExpense(source);
    }
    return defaultInitial(group, session.planId);
    // formKey forces a rebuild after "Load latest version".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, source, sourceId, mode, session.planId, formKey]);

  const canEdit = !!group && group.role !== 'VIEWER' && !group.group.archivedAt;
  const plans = (plansQuery.data?.plans ?? []).filter((p) => p.status !== 'CANCELLED' || p.id === source?.planId);
  const title = mode === 'edit' ? 'Edit expense' : mode === 'duplicate' ? 'Duplicate expense' : 'Add expense';
  const formId = `expense-form-${session.key}`;

  const handleSubmit = async (payload: ExpensePayload, receipt: File | null) => {
    if (saving || !group) return;
    setSaving(true);
    setError(null);
    setConflict(false);
    try {
      let expenseId: string;
      if (mode === 'edit' && source) {
        const res = await updateExpense({ groupId, expenseId: source.id, body: { ...payload, clientRequestId, expectedVersion: source.version } }).unwrap();
        expenseId = res.expense.id;
      } else {
        const res = await createExpense({ groupId, body: { ...payload, clientRequestId } }).unwrap();
        expenseId = res.expense.id;
      }
      if (receipt) {
        setUploadProgress(0);
        try {
          await uploadReceipt(groupId, expenseId, receipt, setUploadProgress).promise;
          dispatch(api.util.invalidateTags([{ type: 'Expense', id: expenseId }, 'Expenses', 'Activity']));
        } catch (e) {
          dispatch(
            showToast({
              severity: 'warning',
              message: `Expense saved, but the receipt upload failed (${e instanceof Error ? e.message : 'unknown error'}). You can upload it again from the expense page.`,
            }),
          );
          setSaving(false);
          dispatch(closeExpenseDialog());
          navigate(`/groups/${groupId}/expenses/${expenseId}`);
          return;
        }
      }
      dispatch(showToast({ message: mode === 'edit' ? 'Expense updated' : receipt ? 'Expense added with receipt' : 'Expense added' }));
      setSaving(false);
      dispatch(closeExpenseDialog());
    } catch (e) {
      const err = toApiError(e);
      if (err.code === 'EDIT_CONFLICT') setConflict(true);
      else setError(err.message);
      setSaving(false);
      setUploadProgress(null);
    }
  };

  const loadLatest = async () => {
    await expenseQuery.refetch();
    setConflict(false);
    setFormKey((k) => k + 1);
  };

  const loading = (!session.groupId && groupsQuery.isLoading) || (!!groupId && (groupQuery.isLoading || (!!sourceId && expenseQuery.isLoading)));
  const loadError = groupQuery.error ?? expenseQuery.error ?? groupsQuery.error;

  return (
    <>
      <DialogTitle id="expense-dialog-title" sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 1.5 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {title}
          {group && (
            <Typography variant="caption" component="p" noWrap>
              {group.group.name}
            </Typography>
          )}
        </Box>
        <IconButton onClick={onClose} aria-label="Close" disabled={saving}>
          <X size={20} />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {!session.groupId && !sourceId && eligibleGroups.length > 0 && (
          <TextField select label="Group" value={groupId} onChange={(e) => setGroupId(e.target.value)} sx={{ mb: 2.5 }} disabled={saving}>
            {eligibleGroups.map((g) => (
              <MenuItem key={g.id} value={g.id}>
                {g.name}
              </MenuItem>
            ))}
          </TextField>
        )}

        {!session.groupId && groupsQuery.isSuccess && eligibleGroups.length === 0 && (
          <Stack spacing={2} alignItems="flex-start" sx={{ py: 2 }}>
            <Typography>You need a group before you can record an expense.</Typography>
            <Button
              variant="contained"
              onClick={() => {
                dispatch(closeExpenseDialog());
                dispatch(setCreateGroupOpen(true));
              }}
            >
              Create a group
            </Button>
          </Stack>
        )}

        {loadError ? (
          <Alert severity="error">{toApiError(loadError).message}</Alert>
        ) : loading ? (
          <Stack spacing={2} aria-busy aria-label="Loading form">
            <Skeleton variant="rounded" height={40} />
            <Skeleton variant="rounded" height={40} />
            <Skeleton variant="rounded" height={120} />
          </Stack>
        ) : group && !canEdit ? (
          <Alert severity="info">{group.group.archivedAt ? 'This group is archived, so expenses cannot be added or changed.' : 'You can view this group but your role does not allow adding or editing expenses.'}</Alert>
        ) : (
          group &&
          initial && (
            <>
              {conflict && (
                <Alert
                  severity="warning"
                  sx={{ mb: 2 }}
                  action={
                    <Button color="inherit" size="small" onClick={() => void loadLatest()}>
                      Load latest version
                    </Button>
                  }
                >
                  Someone else changed this expense while you were editing. Load the latest version, then apply your changes again.
                </Alert>
              )}
              {mode === 'edit' && source?.deletedAt && (
                <Alert severity="info" sx={{ mb: 2 }}>
                  This expense is deleted. Restore it before editing.
                </Alert>
              )}
              {error && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  {error}
                </Alert>
              )}
              <ExpenseForm key={`${groupId}-${formKey}`} formId={formId} group={group} plans={plans} initial={initial} onSubmit={(p, r) => void handleSubmit(p, r)} disabled={saving} />
            </>
          )
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5, gap: 1, flexWrap: 'wrap' }}>
        {uploadProgress !== null && (
          <Box sx={{ flex: '1 1 100%' }}>
            <Typography variant="caption">Uploading receipt… {Math.round(uploadProgress * 100)}%</Typography>
            <LinearProgress variant="determinate" value={uploadProgress * 100} aria-label="Receipt upload progress" />
          </Box>
        )}
        <Button onClick={onClose} color="inherit" disabled={saving}>
          Cancel
        </Button>
        <Button
          type="submit"
          form={formId}
          variant="contained"
          disabled={saving || !group || !initial || !canEdit || conflict || (mode === 'edit' && !!source?.deletedAt)}
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {saving ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Add expense'}
        </Button>
      </DialogActions>
    </>
  );
}

/** Sensible defaults: you paid, everyone active shares equally, today, first category. */
export function defaultInitial(group: GroupDetail, planId?: string): ExpenseFormInitial {
  const active = group.members.filter((m) => m.status === 'ACTIVE').map((m) => m.id);
  const me = group.members.find((m) => m.id === group.myMemberId && m.status === 'ACTIVE');
  return {
    basics: {
      title: '',
      amount: '',
      currency: group.group.currency,
      fxRate: '',
      date: todayLocal(),
      category: DEFAULT_CATEGORIES[0]!.id,
      planId: planId ?? '',
      notes: '',
      repeat: 'NONE',
    },
    payers: { multiple: false, payerId: me?.id ?? active[0] ?? '', amounts: {} },
    split: emptySplitDraft(active),
  };
}
