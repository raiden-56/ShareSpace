import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { CURRENCIES, getCurrency, parseAmountToMinor, type GroupType } from '@sharespace/core';
import { toApiError, useCreateGroupMutation } from '../../api/api';
import type { CreatedInvite } from '../../api/types';
import { useAuth, usePreferences } from '../../hooks/useAuth';
import { useAppDispatch, useAppSelector } from '../../store';
import { setCreateGroupOpen, showToast } from '../../store/ui';
import { cleanDrafts, draftsValid, GroupTypePicker, InviteLinks, MemberDraftEditor, type MemberDraft } from './GroupFields';

export function CreateGroupDialog() {
  const open = useAppSelector((s) => s.ui.createGroupOpen);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const { user } = useAuth();
  const prefs = usePreferences();
  const [createGroup, { isLoading }] = useCreateGroupMutation();

  const [name, setName] = useState('');
  const [type, setType] = useState<GroupType>('TRIP');
  const [currency, setCurrency] = useState(prefs.currency);
  const [description, setDescription] = useState('');
  const [members, setMembers] = useState<MemberDraft[]>([]);
  const [budget, setBudget] = useState('');
  const [simplifyDebts, setSimplifyDebts] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [created, setCreated] = useState<{ groupId: string; invites: CreatedInvite[] } | null>(null);

  const reset = () => {
    setName('');
    setType('TRIP');
    setCurrency(prefs.currency);
    setDescription('');
    setMembers([]);
    setBudget('');
    setSimplifyDebts(true);
    setError(null);
    setTouched(false);
    setCreated(null);
  };
  const close = () => dispatch(setCreateGroupOpen(false));

  const budgetMinor = budget.trim() ? parseAmountToMinor(budget, getCurrency(currency).decimals) : null;
  const budgetInvalid = budget.trim() !== '' && (budgetMinor === null || budgetMinor <= 0);
  const nameInvalid = name.trim() === '';
  const valid = !nameInvalid && !budgetInvalid && draftsValid(members, user?.email);

  const submit = async () => {
    setTouched(true);
    if (!valid) return;
    setError(null);
    try {
      const res = await createGroup({
        name: name.trim(),
        description: description.trim() || null,
        type,
        currency,
        members: cleanDrafts(members),
        budgetMinor: budgetMinor ?? null,
        simplifyDebts,
      }).unwrap();
      dispatch(showToast({ message: `${res.group.name} created` }));
      if (res.invitations.length > 0) setCreated({ groupId: res.group.id, invites: res.invitations });
      else {
        close();
        navigate(`/groups/${res.group.id}`);
      }
    } catch (e) {
      setError(toApiError(e).message);
    }
  };

  return (
    <Dialog open={open} onClose={isLoading ? undefined : close} fullScreen={fullScreen} maxWidth="sm" fullWidth aria-labelledby="create-group-title" TransitionProps={{ onExited: reset }}>
      <DialogTitle id="create-group-title">{created ? 'Group created' : 'Create a group'}</DialogTitle>
      <DialogContent dividers>
        {created ? (
          <InviteLinks invites={created.invites} />
        ) : (
          <Stack spacing={2.5} component="form" id="create-group-form" onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label="Group name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              required
              error={touched && nameInvalid}
              helperText={touched && nameInvalid ? 'Give your group a name' : 'For example "Goa trip" or "Flat 4B"'}
              slotProps={{ htmlInput: { maxLength: 80 } }}
            />
            <div>
              <Typography variant="subtitle2" component="p" sx={{ mb: 1 }}>
                Group type
              </Typography>
              <GroupTypePicker value={type} onChange={setType} />
            </div>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField select label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)} helperText="Balances are kept in this currency">
                {CURRENCIES.map((c) => (
                  <MenuItem key={c.code} value={c.code}>
                    {c.code} · {c.name}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Budget (optional)"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                inputMode="decimal"
                error={budgetInvalid}
                helperText={budgetInvalid ? 'Enter a positive amount' : 'You can set this later'}
                slotProps={{ htmlInput: { inputMode: 'decimal' } }}
              />
            </Stack>
            <TextField label="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} multiline minRows={2} slotProps={{ htmlInput: { maxLength: 500 } }} />
            <FormControlLabel
              control={<Switch checked={simplifyDebts} onChange={(e) => setSimplifyDebts(e.target.checked)} />}
              label={
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    Simplify debts
                  </Typography>
                  <Typography variant="caption" component="p">
                    Suggest the fewest repayments. You can change this later in group settings.
                  </Typography>
                </Box>
              }
              sx={{ alignItems: 'flex-start', mr: 0, '& .MuiSwitch-root': { mt: -0.5 } }}
            />
            <div>
              <Typography variant="subtitle2" component="p" sx={{ mb: 1 }}>
                People (optional)
              </Typography>
              <MemberDraftEditor value={members} onChange={setMembers} ownEmail={user?.email} />
            </div>
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        {created ? (
          <Button
            variant="contained"
            onClick={() => {
              close();
              navigate(`/groups/${created.groupId}`);
            }}
          >
            Open group
          </Button>
        ) : (
          <>
            <Button onClick={close} color="inherit" disabled={isLoading}>
              Cancel
            </Button>
            <Button type="submit" form="create-group-form" variant="contained" disabled={isLoading}>
              {isLoading ? 'Creating…' : 'Create group'}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
