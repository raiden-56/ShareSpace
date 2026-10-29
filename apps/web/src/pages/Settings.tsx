import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  ButtonBase,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  FormControlLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { Check, Download, Laptop, LogOut, Monitor, Moon, Smartphone, Sun } from 'lucide-react';
import { format } from 'date-fns';
import {
  ACCENTS,
  CURRENCIES,
  DATE_FORMATS,
  NOTIFICATION_PREF_KEYS,
  passwordSchema,
  type NotificationPrefKey,
  type Preferences,
} from '@sharespace/core';
import {
  api,
  toApiError,
  useChangePasswordMutation,
  useDeleteAccountMutation,
  useRevokeOtherSessionsMutation,
  useRevokeSessionMutation,
  useSessionsQuery,
  useUpdatePreferencesMutation,
  useUpdateProfileMutation,
} from '../api/api';
import type { Session } from '../api/types';
import { useAuth, usePreferences } from '../hooks/useAuth';
import { downloadFile } from '../lib/download';
import { timeAgo } from '../lib/format';
import { useAppDispatch } from '../store';
import { showToast } from '../store/ui';
import { PageHeader, PageTransition } from '../components/common/Layout';
import { ErrorState } from '../components/common/States';
import { MemberListSkeleton } from '../components/common/Skeletons';
import { MemberAvatar } from '../components/common/MemberAvatar';

const SECTIONS = [
  { id: 'profile', label: 'Profile' },
  { id: 'security', label: 'Password' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'regional', label: 'Regional' },
  { id: 'data', label: 'Data' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'danger', label: 'Delete account' },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];

function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardContent sx={{ p: { xs: 2.25, md: 3 }, '&:last-child': { pb: { xs: 2.25, md: 3 } } }}>
        <Typography variant="h2" component="h2">
          {title}
        </Typography>
        {description && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2.5 }}>
            {description}
          </Typography>
        )}
        {!description && <Box sx={{ mb: 2.5 }} />}
        {children}
      </CardContent>
    </Card>
  );
}

function useErrorToast() {
  const dispatch = useAppDispatch();
  return (e: unknown) => dispatch(showToast({ message: toApiError(e).message, severity: 'error' }));
}

// ---------- Profile ----------

function ProfileSection() {
  const { user } = useAuth();
  const [name, setName] = useState(user?.name ?? '');
  const [color, setColor] = useState(user?.avatarColor ?? ACCENTS[0]);
  const [update, { isLoading }] = useUpdateProfileMutation();
  const dispatch = useAppDispatch();
  const onError = useErrorToast();
  useEffect(() => {
    if (user) {
      setName(user.name);
      setColor(user.avatarColor);
    }
  }, [user]);
  if (!user) return null;
  const nameError = name.trim().length === 0 ? 'Name is required' : name.trim().length > 80 ? 'Name must be at most 80 characters' : '';
  const dirty = name.trim() !== user.name || color !== user.avatarColor;
  return (
    <Section title="Profile" description="How you appear to the people in your groups.">
      <Stack spacing={2.5} component="form" onSubmit={(e) => {
        e.preventDefault();
        if (nameError) return;
        update({ name: name.trim(), avatarColor: color })
          .unwrap()
          .then(() => dispatch(showToast({ message: 'Profile updated' })))
          .catch(onError);
      }}>
        <Stack direction="row" spacing={2} alignItems="center">
          <MemberAvatar name={name || user.name} color={color} size={56} />
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" noWrap>
              {name || user.name}
            </Typography>
            <Typography variant="caption" component="p" noWrap>
              {user.email}
            </Typography>
          </Box>
        </Stack>
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} error={!!nameError} helperText={nameError || ' '} sx={{ maxWidth: 420 }} />
        <TextField label="Email" value={user.email} disabled helperText="Your sign-in email cannot be changed here." sx={{ maxWidth: 420 }} />
        <Box>
          <Typography variant="subtitle2" component="p" id="avatar-color-label" sx={{ mb: 1 }}>
            Avatar colour
          </Typography>
          <Stack direction="row" spacing={1} role="radiogroup" aria-labelledby="avatar-color-label" sx={{ flexWrap: 'wrap', rowGap: 1 }}>
            {ACCENTS.map((c) => (
              <ButtonBase
                key={c}
                role="radio"
                aria-checked={color === c}
                aria-label={`Colour ${c}`}
                onClick={() => setColor(c)}
                sx={{ width: 40, height: 40, borderRadius: '50%', bgcolor: c, color: '#fff', outline: color === c ? '2px solid' : 'none', outlineColor: 'text.primary', outlineOffset: 2 }}
              >
                {color === c && <Check size={18} />}
              </ButtonBase>
            ))}
          </Stack>
        </Box>
        <Box>
          <Button type="submit" variant="contained" disabled={!dirty || !!nameError || isLoading}>
            {isLoading ? 'Saving…' : 'Save profile'}
          </Button>
        </Box>
      </Stack>
    </Section>
  );
}

// ---------- Password ----------

const passwordFormSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: passwordSchema,
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, { message: 'Passwords do not match', path: ['confirm'] })
  .refine((v) => v.newPassword !== v.currentPassword, { message: 'Choose a password different from your current one', path: ['newPassword'] });
type PasswordForm = z.infer<typeof passwordFormSchema>;

function PasswordSection() {
  const [change, { isLoading }] = useChangePasswordMutation();
  const dispatch = useAppDispatch();
  const [serverError, setServerError] = useState<string | null>(null);
  const { control, handleSubmit, reset, setError } = useForm<PasswordForm>({
    resolver: zodResolver(passwordFormSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirm: '' },
    mode: 'onTouched',
  });
  const onSubmit = handleSubmit(async (v) => {
    setServerError(null);
    try {
      await change({ currentPassword: v.currentPassword, newPassword: v.newPassword }).unwrap();
      reset();
      dispatch(showToast({ message: 'Password changed. Other sessions were signed out.' }));
    } catch (e) {
      const err = toApiError(e);
      if (err.fields?.currentPassword) setError('currentPassword', { message: err.fields.currentPassword });
      else setServerError(err.message);
    }
  });
  const field = (name: keyof PasswordForm, label: string, autoComplete: string, helper?: string) => (
    <Controller
      control={control}
      name={name}
      render={({ field: f, fieldState }) => (
        <TextField {...f} type="password" label={label} autoComplete={autoComplete} error={!!fieldState.error} helperText={fieldState.error?.message ?? helper ?? ' '} sx={{ maxWidth: 420 }} />
      )}
    />
  );
  return (
    <Section title="Password" description="Changing your password signs you out on every other device.">
      <Stack component="form" spacing={1.5} onSubmit={onSubmit} noValidate>
        {serverError && <Alert severity="error">{serverError}</Alert>}
        {field('currentPassword', 'Current password', 'current-password')}
        {field('newPassword', 'New password', 'new-password', 'At least 10 characters, with a letter and a number.')}
        {field('confirm', 'Confirm new password', 'new-password')}
        <Box>
          <Button type="submit" variant="contained" disabled={isLoading}>
            {isLoading ? 'Updating…' : 'Change password'}
          </Button>
        </Box>
      </Stack>
    </Section>
  );
}

// ---------- Appearance ----------

function OptionCard({ selected, icon, label, value }: { selected: boolean; icon: ReactNode; label: string; value: string }) {
  return (
    <FormControlLabel
      value={value}
      control={<Radio sx={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }} />}
      label={
        <Stack alignItems="center" spacing={0.75} sx={{ py: 1.5 }}>
          {icon}
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {label}
          </Typography>
        </Stack>
      }
      sx={{
        m: 0,
        flex: 1,
        minWidth: 96,
        justifyContent: 'center',
        border: 2,
        borderColor: selected ? 'primary.main' : 'divider',
        borderRadius: 3,
        bgcolor: selected ? 'surface.sage' : 'background.paper',
        '&:has(input:focus-visible)': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
      }}
    />
  );
}

function AppearanceSection() {
  const prefs = usePreferences();
  const [update] = useUpdatePreferencesMutation();
  const onError = useErrorToast();
  const set = (patch: Partial<Preferences>) => update(patch).unwrap().catch(onError);
  return (
    <Section title="Appearance" description="Changes apply immediately on this and your other signed-in devices.">
      <Typography variant="subtitle2" component="p" id="theme-label" sx={{ mb: 1 }}>
        Theme
      </Typography>
      <RadioGroup row aria-labelledby="theme-label" value={prefs.theme} onChange={(e) => set({ theme: e.target.value as Preferences['theme'] })} sx={{ gap: 1.5, mb: 3, flexWrap: 'wrap' }}>
        <OptionCard value="light" label="Light" icon={<Sun size={20} />} selected={prefs.theme === 'light'} />
        <OptionCard value="dark" label="Dark" icon={<Moon size={20} />} selected={prefs.theme === 'dark'} />
        <OptionCard value="system" label="System" icon={<Monitor size={20} />} selected={prefs.theme === 'system'} />
      </RadioGroup>
      <Typography variant="subtitle2" component="p" id="motion-label" sx={{ mb: 0.5 }}>
        Motion
      </Typography>
      <RadioGroup aria-labelledby="motion-label" value={prefs.motion} onChange={(e) => set({ motion: e.target.value as Preferences['motion'] })}>
        <FormControlLabel value="system" control={<Radio />} label="Follow my device setting" />
        <FormControlLabel value="reduce" control={<Radio />} label="Reduce motion (turn off non-essential animation)" />
        <FormControlLabel value="full" control={<Radio />} label="Full motion" />
      </RadioGroup>
    </Section>
  );
}

// ---------- Notifications ----------

const PREF_LABELS: Record<NotificationPrefKey, { label: string; hint: string }> = {
  expenses: { label: 'Expenses', hint: 'When someone adds, edits or deletes an expense' },
  comments: { label: 'Comments', hint: 'New comments on expenses' },
  settlements: { label: 'Repayments', hint: 'Repayments involving you are recorded or reversed' },
  budget: { label: 'Budget alerts', hint: 'A group approaches or exceeds its budget' },
  plans: { label: 'Event reminders', hint: 'Plans starting within three days' },
  polls: { label: 'Polls', hint: 'New polls, closing deadlines and results' },
  members: { label: 'Members', hint: 'Someone joins one of your groups' },
};

function NotificationsSection() {
  const prefs = usePreferences();
  const [update] = useUpdatePreferencesMutation();
  const onError = useErrorToast();
  return (
    <Section title="Notifications" description="Choose which in-app notifications you receive. Group invitations are always delivered.">
      <Alert severity="info" sx={{ mb: 2 }}>
        ShareSpace currently sends in-app notifications only. Email and push delivery are not available in this version.
      </Alert>
      <Stack divider={<Divider flexItem />}>
        {NOTIFICATION_PREF_KEYS.map((key) => (
          <FormControlLabel
            key={key}
            labelPlacement="start"
            control={
              <Switch
                checked={prefs.notifications[key]}
                onChange={(e) => update({ notifications: { ...prefs.notifications, [key]: e.target.checked } }).unwrap().catch(onError)}
              />
            }
            label={
              <Box>
                <Typography variant="subtitle1">{PREF_LABELS[key].label}</Typography>
                <Typography variant="caption" component="p">
                  {PREF_LABELS[key].hint}
                </Typography>
              </Box>
            }
            sx={{ m: 0, py: 1.25, justifyContent: 'space-between', '& .MuiFormControlLabel-label': { flex: 1, pr: 2 } }}
          />
        ))}
      </Stack>
    </Section>
  );
}

// ---------- Regional ----------

const FALLBACK_ZONES = ['Asia/Kolkata', 'UTC', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney'];

function timeZones(): string[] {
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    const zones = intl.supportedValuesOf?.('timeZone');
    if (zones && zones.length) return zones.includes('UTC') ? zones : ['UTC', ...zones];
  } catch {
    /* fall back */
  }
  return FALLBACK_ZONES;
}

function RegionalSection() {
  const prefs = usePreferences();
  const [update] = useUpdatePreferencesMutation();
  const onError = useErrorToast();
  const zones = useMemo(timeZones, []);
  const set = (patch: Partial<Preferences>) => update(patch).unwrap().catch(onError);
  const example = new Date();
  return (
    <Section title="Regional" description="Defaults for new groups and how dates are shown.">
      <Stack spacing={2.5} sx={{ maxWidth: 420 }}>
        <TextField select label="Preferred currency" value={prefs.currency} onChange={(e) => set({ currency: e.target.value })} helperText="Used as the default when you create a group. Existing groups keep their own currency.">
          {CURRENCIES.map((c) => (
            <MenuItem key={c.code} value={c.code}>
              {c.code} — {c.name}
            </MenuItem>
          ))}
        </TextField>
        <TextField select label="Date format" value={prefs.dateFormat} onChange={(e) => set({ dateFormat: e.target.value as Preferences['dateFormat'] })} helperText={`Example: ${format(example, prefs.dateFormat)}`}>
          {DATE_FORMATS.map((f) => (
            <MenuItem key={f} value={f}>
              {format(example, f)}
            </MenuItem>
          ))}
        </TextField>
        <Autocomplete
          options={zones}
          value={prefs.timeZone}
          disableClearable
          onChange={(_e, v) => v && set({ timeZone: v })}
          renderInput={(params) => <TextField {...params} label="Time zone" helperText="Stored with your preferences. Dates of expenses are calendar dates and are not shifted." />}
        />
        <TextField select label="Language" value="en" disabled helperText="More languages are not available yet.">
          <MenuItem value="en">English</MenuItem>
        </TextField>
      </Stack>
    </Section>
  );
}

// ---------- Data ----------

function DataSection() {
  const [busy, setBusy] = useState(false);
  const dispatch = useAppDispatch();
  return (
    <Section title="Your data" description="Download a copy of your information at any time.">
      <Stack spacing={2.5}>
        <Box>
          <Typography variant="subtitle1">Personal data export</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25 }}>
            A JSON file with your profile, preferences, group memberships, the expenses you paid or share in, repayments involving you, your comments and recent notifications.
          </Typography>
          <Button
            variant="outlined"
            startIcon={<Download size={18} />}
            disabled={busy}
            onClick={() => {
              setBusy(true);
              downloadFile('/api/me/export', 'sharespace-personal-data.json')
                .then(() => dispatch(showToast({ message: 'Export downloaded' })))
                .catch((e: Error) => dispatch(showToast({ message: e.message, severity: 'error' })))
                .finally(() => setBusy(false));
            }}
          >
            {busy ? 'Preparing…' : 'Export my data'}
          </Button>
        </Box>
        <Divider />
        <Box>
          <Typography variant="subtitle1">Group records</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25 }}>
            Each group can be exported as CSV (expenses, repayments, members) or as a complete JSON backup from its settings page.
          </Typography>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
            <Button component={RouterLink} to="/groups" variant="outlined">
              Review active groups
            </Button>
            <Button component={RouterLink} to="/groups?tab=archived" color="inherit">
              Archived groups
            </Button>
          </Stack>
        </Box>
      </Stack>
    </Section>
  );
}

// ---------- Sessions ----------

export function describeDevice(ua: string | null): { label: string; mobile: boolean } {
  if (!ua) return { label: 'Unknown device', mobile: false };
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown OS';
  return { label: `${browser} on ${os}`, mobile: /Android|iPhone|iPad|Mobile/.test(ua) };
}

function SessionsSection() {
  const { data, isLoading, error, refetch } = useSessionsQuery();
  const [revoke, { isLoading: revoking }] = useRevokeSessionMutation();
  const [revokeOthers, { isLoading: revokingOthers }] = useRevokeOtherSessionsMutation();
  const dispatch = useAppDispatch();
  const onError = useErrorToast();
  const others = (data?.sessions ?? []).filter((s: Session) => !s.current).length;
  return (
    <Section title="Sessions" description="Devices where you are signed in.">
      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : isLoading || !data ? (
        <MemberListSkeleton rows={2} />
      ) : (
        <Stack spacing={1.5}>
          {data.sessions.map((s) => {
            const device = describeDevice(s.userAgent);
            return (
              <Stack key={s.id} direction="row" spacing={1.5} alignItems="center" sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 3 }}>
                <Box sx={{ color: 'text.secondary', display: 'grid' }} aria-hidden>
                  {device.mobile ? <Smartphone size={22} /> : <Laptop size={22} />}
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="subtitle1" noWrap>
                      {device.label}
                    </Typography>
                    {s.current && <Chip size="small" label="This device" color="primary" variant="outlined" />}
                  </Stack>
                  <Typography variant="caption" component="p">
                    Signed in {timeAgo(s.createdAt)} · last active {timeAgo(s.lastSeenAt)}
                  </Typography>
                </Box>
                {!s.current && (
                  <Button
                    size="small"
                    color="inherit"
                    disabled={revoking}
                    onClick={() =>
                      revoke(s.id)
                        .unwrap()
                        .then(() => dispatch(showToast({ message: 'Session signed out' })))
                        .catch(onError)
                    }
                  >
                    Sign out
                  </Button>
                )}
              </Stack>
            );
          })}
          <Box>
            <Button
              variant="outlined"
              startIcon={<LogOut size={18} />}
              disabled={others === 0 || revokingOthers}
              onClick={() =>
                revokeOthers()
                  .unwrap()
                  .then((r) => dispatch(showToast({ message: `Signed out of ${r.revoked} other session${r.revoked === 1 ? '' : 's'}` })))
                  .catch(onError)
              }
            >
              Sign out other sessions
            </Button>
          </Box>
        </Stack>
      )}
    </Section>
  );
}

// ---------- Danger zone ----------

function DangerSection() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [remove, { isLoading, error, reset }] = useDeleteAccountMutation();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  return (
    <Section title="Delete account" description="Permanently delete your ShareSpace account.">
      <Stack spacing={1} sx={{ mb: 2 }}>
        <Typography variant="body2" color="text.secondary">
          • Groups where you are the only member with an account are deleted with all of their records and receipts.
        </Typography>
        <Typography variant="body2" color="text.secondary">
          • In shared groups, expenses and repayments stay with the other members, shown under your name, so their balances remain correct.
        </Typography>
        <Typography variant="body2" color="text.secondary">
          • Ownership of groups you own moves to an admin or the longest-standing member.
        </Typography>
      </Stack>
      <Button variant="outlined" color="error" onClick={() => setOpen(true)}>
        Delete my account
      </Button>
      <Dialog
        open={open}
        onClose={isLoading ? undefined : () => setOpen(false)}
        maxWidth="xs"
        fullWidth
        aria-labelledby="delete-account-title"
        TransitionProps={{ onExited: () => { setPassword(''); reset(); } }}
      >
        <DialogTitle id="delete-account-title">Delete your account?</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>This cannot be undone. Enter your password to confirm.</DialogContentText>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {toApiError(error).message}
            </Alert>
          )}
          <TextField autoFocus type="password" label="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button color="inherit" onClick={() => setOpen(false)} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="error"
            disabled={!password || isLoading}
            onClick={() =>
              remove({ password })
                .unwrap()
                .then(() => {
                  dispatch(api.util.resetApiState());
                  navigate('/login', { replace: true });
                })
                .catch(() => undefined)
            }
          >
            {isLoading ? 'Deleting…' : 'Delete account'}
          </Button>
        </DialogActions>
      </Dialog>
    </Section>
  );
}

const SECTION_COMPONENTS: Record<SectionId, () => ReactNode> = {
  profile: ProfileSection,
  security: PasswordSection,
  appearance: AppearanceSection,
  notifications: NotificationsSection,
  regional: RegionalSection,
  data: DataSection,
  sessions: SessionsSection,
  danger: DangerSection,
};

export default function Settings() {
  const [params, setParams] = useSearchParams();
  const theme = useTheme();
  const desktop = useMediaQuery(theme.breakpoints.up('md'));
  const raw = params.get('section');
  const section: SectionId = SECTIONS.some((s) => s.id === raw) ? (raw as SectionId) : 'profile';
  const Current = SECTION_COMPONENTS[section];
  return (
    <PageTransition>
      <PageHeader title="Settings" subtitle="Manage your profile, preferences and data." />
      <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', md: '200px 1fr' }, alignItems: 'start' }}>
        <Tabs
          orientation={desktop ? 'vertical' : 'horizontal'}
          variant="scrollable"
          scrollButtons={false}
          value={section}
          onChange={(_e, v: SectionId) => setParams({ section: v }, { replace: true })}
          aria-label="Settings sections"
          sx={{
            minWidth: 0,
            borderBottom: desktop ? 0 : 1,
            borderColor: 'divider',
            position: desktop ? 'sticky' : 'static',
            top: 88,
            '& .MuiTab-root': { alignItems: desktop ? 'flex-start' : 'center', minHeight: 44, px: desktop ? 1.5 : 1.25 },
            '& .MuiTabs-indicator': desktop ? { left: 0, width: 3 } : {},
          }}
        >
          {SECTIONS.map((s) => (
            <Tab key={s.id} value={s.id} label={s.label} sx={s.id === 'danger' ? { color: 'error.main' } : undefined} />
          ))}
        </Tabs>
        <Box sx={{ minWidth: 0 }}>
          <Current />
        </Box>
      </Box>
    </PageTransition>
  );
}
