import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { Archive, ArchiveRestore, Check, Download, Plus } from 'lucide-react';
import { ACCENTS, CURRENCIES, type GroupType } from '@sharespace/core';
import {
  toApiError,
  useArchiveGroupMutation,
  useCreateCategoryMutation,
  useRestoreGroupMutation,
  useUpdateGroupMutation,
} from '../../api/api';
import { useGroupContext } from '../../hooks/useGroupContext';
import { useAppDispatch } from '../../store';
import { showToast } from '../../store/ui';
import { downloadFile } from '../../lib/download';
import { PageTransition, SectionCard } from '../../components/common/Layout';
import { ConfirmDialog } from '../../components/common/ConfirmDialog';
import { GroupTypePicker } from '../../components/groups/GroupFields';
import { MemberListSkeleton } from '../../components/common/Skeletons';

export default function GroupSettings() {
  const { groupId, helpers } = useGroupContext();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [update, { isLoading: saving }] = useUpdateGroupMutation();
  const [archive, { isLoading: archiving }] = useArchiveGroupMutation();
  const [restore, { isLoading: restoring }] = useRestoreGroupMutation();
  const [createCategory, { isLoading: addingCategory }] = useCreateCategoryMutation();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<GroupType>('GENERAL');
  const [accent, setAccent] = useState<string>(ACCENTS[0]);
  const [currency, setCurrency] = useState('INR');
  const [multiCurrency, setMultiCurrency] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const g = helpers?.data.group;

  useEffect(() => {
    if (!g) return;
    setName(g.name);
    setDescription(g.description ?? '');
    setType(g.type);
    setAccent(g.accent);
    setCurrency(g.currency);
    setMultiCurrency(g.multiCurrency);
  }, [g]);

  if (!helpers || !g) return <MemberListSkeleton />;
  const editable = helpers.can('manageSettings');
  const hasRecords = g.expenseCount > 0;
  const fail = (e: unknown) => dispatch(showToast({ message: toApiError(e).message, severity: 'error' }));
  const exportFile = (path: string, name: string) => downloadFile(path, name).catch((e: Error) => dispatch(showToast({ message: e.message, severity: 'error' })));

  const save = async () => {
    setError(null);
    if (!name.trim()) {
      setError('Group name is required');
      return;
    }
    try {
      await update({
        groupId,
        name: name.trim(),
        description: description.trim() || null,
        type,
        accent,
        multiCurrency,
        ...(currency !== g.currency ? { currency } : {}),
      }).unwrap();
      dispatch(showToast({ message: 'Group settings saved' }));
    } catch (e) {
      setError(toApiError(e).message);
    }
  };

  return (
    <PageTransition>
      <Stack spacing={2.5}>
        <SectionCard title="Group details" subtitle={editable ? undefined : 'Only the owner and admins can change these settings.'}>
          <Stack spacing={2.5} component="form" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} disabled={!editable} slotProps={{ htmlInput: { maxLength: 80 } }} />
            <TextField label="Description" value={description} onChange={(e) => setDescription(e.target.value)} disabled={!editable} multiline minRows={2} slotProps={{ htmlInput: { maxLength: 500 } }} />
            <Box sx={{ pointerEvents: editable ? 'auto' : 'none', opacity: editable ? 1 : 0.7 }}>
              <Typography variant="subtitle2" component="p" sx={{ mb: 1 }}>
                Type
              </Typography>
              <GroupTypePicker value={type} onChange={setType} />
            </Box>
            <Box>
              <Typography variant="subtitle2" component="p" sx={{ mb: 1 }} id="accent-label">
                Accent colour
              </Typography>
              <Stack direction="row" spacing={1} role="radiogroup" aria-labelledby="accent-label" sx={{ flexWrap: 'wrap', gap: 1, '& > *': { m: '0 !important' } }}>
                {ACCENTS.map((c) => (
                  <ButtonBase
                    key={c}
                    role="radio"
                    aria-checked={accent === c}
                    aria-label={`Accent ${c}`}
                    disabled={!editable}
                    onClick={() => setAccent(c)}
                    sx={{ width: 40, height: 40, borderRadius: '12px', bgcolor: c, color: '#fff', outline: accent === c ? '2px solid' : 'none', outlineColor: 'text.primary', outlineOffset: 2 }}
                  >
                    {accent === c && <Check size={18} />}
                  </ButtonBase>
                ))}
              </Stack>
            </Box>
            <TextField
              select
              label="Group currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              disabled={!editable || hasRecords}
              helperText={hasRecords ? 'The currency cannot change after expenses have been recorded.' : 'All balances are kept in this currency.'}
            >
              {CURRENCIES.map((c) => (
                <MenuItem key={c.code} value={c.code}>
                  {c.code} · {c.name}
                </MenuItem>
              ))}
            </TextField>
            <FormControlLabel
              control={<Switch checked={multiCurrency} onChange={(e) => setMultiCurrency(e.target.checked)} disabled={!editable} />}
              label={
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    Allow expenses in other currencies
                  </Typography>
                  <Typography variant="caption" component="p">
                    You enter the exchange rate yourself for each expense. ShareSpace does not fetch live rates. The original amount is kept alongside the converted one.
                  </Typography>
                </Box>
              }
              sx={{ alignItems: 'flex-start', '& .MuiSwitch-root': { mt: -0.5 } }}
            />
            {editable && (
              <Button type="submit" variant="contained" disabled={saving} sx={{ alignSelf: 'flex-start' }}>
                {saving ? 'Saving…' : 'Save changes'}
              </Button>
            )}
          </Stack>
        </SectionCard>

        <SectionCard title="Custom categories" subtitle="Add categories specific to this group. The default categories are always available.">
          <Stack spacing={1.5}>
            {helpers.data.categories.length > 0 ? (
              <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
                {helpers.data.categories.map((c) => (
                  <Box key={c.id} sx={{ px: 1.25, py: 0.5, borderRadius: 2, border: 1, borderColor: 'divider' }}>
                    <Typography variant="body2">{c.label}</Typography>
                  </Box>
                ))}
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary">
                No custom categories yet.
              </Typography>
            )}
            {helpers.can('editRecords') && (
              <Stack direction="row" spacing={1} component="form" onSubmit={(e) => {
                e.preventDefault();
                if (!newCategory.trim()) return;
                createCategory({ groupId, label: newCategory.trim() })
                  .unwrap()
                  .then(() => {
                    setNewCategory('');
                    dispatch(showToast({ message: 'Category added' }));
                  })
                  .catch(fail);
              }}>
                <TextField label="New category" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} slotProps={{ htmlInput: { maxLength: 40 } }} />
                <Button type="submit" variant="outlined" startIcon={<Plus size={16} />} disabled={addingCategory || !newCategory.trim()} sx={{ flexShrink: 0 }}>
                  Add
                </Button>
              </Stack>
            )}
          </Stack>
        </SectionCard>

        <SectionCard title="Export group records" subtitle="Only records of this group are included. Amounts in the JSON backup are integer minor units.">
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ flexWrap: 'wrap', gap: 1, '& > *': { m: '0 !important' } }}>
            <Button variant="outlined" startIcon={<Download size={16} />} onClick={() => exportFile(`/api/groups/${groupId}/expenses/export.csv`, 'expenses.csv')}>
              Expenses (CSV)
            </Button>
            <Button variant="outlined" startIcon={<Download size={16} />} onClick={() => exportFile(`/api/groups/${groupId}/settlements/export.csv`, 'settlements.csv')}>
              Settlements (CSV)
            </Button>
            <Button variant="outlined" startIcon={<Download size={16} />} onClick={() => exportFile(`/api/groups/${groupId}/export/members.csv`, 'members.csv')}>
              Members (CSV)
            </Button>
            <Button variant="outlined" startIcon={<Download size={16} />} onClick={() => exportFile(`/api/groups/${groupId}/export/backup.json`, 'backup.json')}>
              Full backup (JSON)
            </Button>
          </Stack>
        </SectionCard>

        {helpers.data.role === 'OWNER' && (
          <SectionCard title={g.archivedAt ? 'Restore group' : 'Archive group'}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
              <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
                {g.archivedAt
                  ? 'Restoring makes the group editable again for all members.'
                  : 'Archiving makes the group read-only and moves it to the Archived tab. Nothing is deleted, and you can restore it later.'}
              </Typography>
              {g.archivedAt ? (
                <Button
                  variant="contained"
                  startIcon={<ArchiveRestore size={16} />}
                  disabled={restoring}
                  onClick={() => restore(groupId).unwrap().then(() => dispatch(showToast({ message: 'Group restored' }))).catch(fail)}
                >
                  Restore
                </Button>
              ) : (
                <Button variant="outlined" color="warning" startIcon={<Archive size={16} />} onClick={() => setConfirmArchive(true)}>
                  Archive group
                </Button>
              )}
            </Stack>
          </SectionCard>
        )}
      </Stack>

      <ConfirmDialog
        open={confirmArchive}
        title="Archive this group?"
        description="The group becomes read-only for everyone. Balances and history are kept, and you can restore it at any time."
        confirmLabel="Archive"
        busy={archiving}
        onClose={() => setConfirmArchive(false)}
        onConfirm={() =>
          archive(groupId)
            .unwrap()
            .then(() => {
              setConfirmArchive(false);
              dispatch(showToast({ message: 'Group archived' }));
              navigate('/groups?tab=archived');
            })
            .catch(fail)
        }
      />
    </PageTransition>
  );
}
