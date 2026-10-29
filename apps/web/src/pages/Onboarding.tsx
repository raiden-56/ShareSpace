import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Card,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { ArrowLeft, ArrowRight, Link2, Mail, Users } from 'lucide-react';
import { CURRENCIES, getCurrency, GROUP_TYPE_LABELS, parseAmountToMinor, type GroupType } from '@sharespace/core';
import {
  toApiError,
  useCreateGroupMutation,
  useMyInvitationsQuery,
  useRespondToInvitationMutation,
  useUpdatePreferencesMutation,
} from '../api/api';
import type { CreatedInvite } from '../api/types';
import { useAuth, usePreferences } from '../hooks/useAuth';
import { useAppDispatch } from '../store';
import { showToast } from '../store/ui';
import { Logo } from '../components/layout/Logo';
import { PageTransition } from '../components/common/Layout';
import { cleanDrafts, draftsValid, GroupTypePicker, InviteLinks, MemberDraftEditor, type MemberDraft } from '../components/groups/GroupFields';

type Step = 'welcome' | 'choose' | 'join' | 'type' | 'members' | 'currency' | 'budget' | 'done';
const CREATE_STEPS: Step[] = ['type', 'members', 'currency', 'budget'];

export default function Onboarding() {
  const { user } = useAuth();
  const prefs = usePreferences();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const [updatePrefs] = useUpdatePreferencesMutation();
  const [createGroup, { isLoading: creating }] = useCreateGroupMutation();
  const { data: invitations } = useMyInvitationsQuery();
  const [respond, { isLoading: responding }] = useRespondToInvitationMutation();

  const [step, setStep] = useState<Step>('welcome');
  const [type, setType] = useState<GroupType>('TRIP');
  const [name, setName] = useState('');
  const [members, setMembers] = useState<MemberDraft[]>([{ displayName: '', email: '' }]);
  const [currency, setCurrency] = useState(prefs.currency);
  const [budget, setBudget] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ groupId: string; invites: CreatedInvite[] } | null>(null);

  const complete = async (to: string) => {
    await updatePrefs({ onboardingCompleted: true, currency }).unwrap().catch(() => undefined);
    navigate(to, { replace: true });
  };

  const budgetMinor = budget.trim() ? parseAmountToMinor(budget, getCurrency(currency).decimals) : null;
  const budgetInvalid = budget.trim() !== '' && (budgetMinor === null || budgetMinor <= 0);
  const memberRows = members.filter((m) => m.displayName.trim() || m.email.trim());

  const finish = async () => {
    setError(null);
    try {
      const res = await createGroup({
        name: name.trim() || `${GROUP_TYPE_LABELS[type]} group`,
        type,
        currency,
        members: cleanDrafts(memberRows),
        budgetMinor: budgetMinor ?? null,
      }).unwrap();
      dispatch(showToast({ message: `${res.group.name} is ready` }));
      if (res.invitations.length) {
        setCreated({ groupId: res.group.id, invites: res.invitations });
        setStep('done');
      } else {
        await complete(`/groups/${res.group.id}`);
      }
    } catch (e) {
      setError(toApiError(e).message);
    }
  };

  const joinWithLink = () => {
    const match = /\/invite\/([A-Za-z0-9_-]{20,})/.exec(inviteLink.trim());
    if (!match) {
      setError('Paste the full invitation link you received, for example https://…/invite/abc123');
      return;
    }
    void complete(`/invite/${match[1]}`);
  };

  const progressIndex = CREATE_STEPS.indexOf(step);

  return (
    <Box sx={{ minHeight: '100dvh', bgcolor: 'background.default', display: 'flex', flexDirection: 'column' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: { xs: 2, sm: 4 }, py: 2 }}>
        <Logo />
        {step !== 'done' && (
          <Button color="inherit" onClick={() => void complete('/')}>
            Skip for now
          </Button>
        )}
      </Stack>
      {progressIndex >= 0 && (
        <LinearProgress variant="determinate" value={((progressIndex + 1) / CREATE_STEPS.length) * 100} aria-label={`Step ${progressIndex + 1} of ${CREATE_STEPS.length}`} sx={{ mx: { xs: 2, sm: 4 }, height: 4 }} />
      )}
      <Box component="main" sx={{ flex: 1, display: 'flex', alignItems: { xs: 'flex-start', sm: 'center' }, justifyContent: 'center', p: { xs: 2, sm: 4 } }}>
        <Card sx={{ width: '100%', maxWidth: 600, p: { xs: 2.5, sm: 4 } }}>
          <PageTransition key={step}>
            {error && (
              <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
                {error}
              </Alert>
            )}

            {step === 'welcome' && (
              <Stack spacing={2.5}>
                <Typography variant="overline">Welcome</Typography>
                <Typography variant="h1">Hi {user?.name.split(' ')[0]}, welcome to ShareSpace</Typography>
                <Typography color="text.secondary">
                  Record shared costs, split them fairly and see who owes whom. Let's set up your first group. It takes about a minute, and you can skip any step.
                </Typography>
                <Button variant="contained" size="large" endIcon={<ArrowRight size={18} />} onClick={() => setStep('choose')} sx={{ alignSelf: 'flex-start' }}>
                  Get started
                </Button>
              </Stack>
            )}

            {step === 'choose' && (
              <Stack spacing={2.5}>
                <Typography variant="h2">Create a group or join one</Typography>
                <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
                  <ChoiceCard icon={<Users size={22} />} title="Create a group" text="Start a trip, a shared home or anything else." onClick={() => setStep('type')} />
                  <ChoiceCard
                    icon={<Mail size={22} />}
                    title="Join a group"
                    text={invitations?.invitations.length ? `You have ${invitations.invitations.length} pending invitation${invitations.invitations.length > 1 ? 's' : ''}.` : 'Use an invitation link from a friend.'}
                    onClick={() => setStep('join')}
                  />
                </Box>
                <BackButton onClick={() => setStep('welcome')} />
              </Stack>
            )}

            {step === 'join' && (
              <Stack spacing={2.5}>
                <Typography variant="h2">Join a group</Typography>
                {invitations && invitations.invitations.length > 0 && (
                  <Stack spacing={1.25}>
                    {invitations.invitations.map((inv) => (
                      <Stack key={inv.id} direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }} sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 2.5 }}>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography variant="subtitle1">{inv.groupName}</Typography>
                          <Typography variant="caption">Invited by {inv.invitedByName}</Typography>
                        </Box>
                        <Button
                          variant="contained"
                          disabled={responding}
                          onClick={async () => {
                            try {
                              const r = await respond({ invitationId: inv.id, action: 'accept' }).unwrap();
                              dispatch(showToast({ message: `You joined ${inv.groupName}` }));
                              await complete(`/groups/${r.groupId}`);
                            } catch (e) {
                              setError(toApiError(e).message);
                            }
                          }}
                        >
                          Accept and open
                        </Button>
                      </Stack>
                    ))}
                  </Stack>
                )}
                <Stack spacing={1.25}>
                  <TextField label="Invitation link" placeholder="https://…/invite/…" value={inviteLink} onChange={(e) => setInviteLink(e.target.value)} />
                  <Button variant="outlined" startIcon={<Link2 size={18} />} onClick={joinWithLink} sx={{ alignSelf: 'flex-start' }}>
                    Open invitation
                  </Button>
                </Stack>
                <BackButton onClick={() => setStep('choose')} />
              </Stack>
            )}

            {step === 'type' && (
              <Stack spacing={2.5}>
                <Typography variant="h2">What kind of group is it?</Typography>
                <GroupTypePicker value={type} onChange={setType} />
                <TextField label="Group name" placeholder={`${GROUP_TYPE_LABELS[type]} group`} value={name} onChange={(e) => setName(e.target.value)} slotProps={{ htmlInput: { maxLength: 80 } }} helperText="You can rename it any time" />
                <StepNav onBack={() => setStep('choose')} onNext={() => setStep('members')} />
              </Stack>
            )}

            {step === 'members' && (
              <Stack spacing={2.5}>
                <Typography variant="h2">Who is in the group?</Typography>
                <Typography color="text.secondary" variant="body2">
                  Add people now or later. You are added automatically.
                </Typography>
                <MemberDraftEditor value={members} onChange={setMembers} ownEmail={user?.email} />
                <StepNav
                  onBack={() => setStep('type')}
                  onNext={() => setStep('currency')}
                  nextDisabled={!draftsValid(memberRows, user?.email)}
                  onSkip={() => {
                    setMembers([]);
                    setStep('currency');
                  }}
                />
              </Stack>
            )}

            {step === 'currency' && (
              <Stack spacing={2.5}>
                <Typography variant="h2">Which currency does the group use?</Typography>
                <TextField select label="Group currency" value={currency} onChange={(e) => setCurrency(e.target.value)} helperText="All balances in this group are kept in this currency.">
                  {CURRENCIES.map((c) => (
                    <MenuItem key={c.code} value={c.code}>
                      {c.code} · {c.name}
                    </MenuItem>
                  ))}
                </TextField>
                <StepNav onBack={() => setStep('members')} onNext={() => setStep('budget')} />
              </Stack>
            )}

            {step === 'budget' && (
              <Stack spacing={2.5}>
                <Typography variant="h2">Set a budget? (optional)</Typography>
                <Typography color="text.secondary" variant="body2">
                  ShareSpace will warn the group when spending approaches the limit. You can add dates and category budgets later.
                </Typography>
                <TextField
                  label={`Total budget (${currency})`}
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  error={budgetInvalid}
                  helperText={budgetInvalid ? 'Enter a positive amount' : 'Leave empty to skip'}
                  slotProps={{ htmlInput: { inputMode: 'decimal' } }}
                />
                <StepNav onBack={() => setStep('currency')} onNext={() => void finish()} nextLabel={creating ? 'Creating…' : 'Create group'} nextDisabled={budgetInvalid || creating} />
              </Stack>
            )}

            {step === 'done' && created && (
              <Stack spacing={2.5}>
                <Typography variant="h2">Your group is ready</Typography>
                <InviteLinks invites={created.invites} />
                <Button variant="contained" size="large" onClick={() => void complete(`/groups/${created.groupId}`)} sx={{ alignSelf: 'flex-start' }}>
                  Open group overview
                </Button>
              </Stack>
            )}
          </PageTransition>
        </Card>
      </Box>
    </Box>
  );
}

function ChoiceCard({ icon, title, text, onClick }: { icon: React.ReactNode; title: string; text: string; onClick: () => void }) {
  return (
    <ButtonBase onClick={onClick} sx={{ p: 2, border: 1.5, borderColor: 'divider', borderRadius: 3, textAlign: 'left', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1, '&:hover': { borderColor: 'primary.main', bgcolor: 'surface.sage' } }}>
      <Box sx={{ color: 'primary.main' }}>{icon}</Box>
      <Typography variant="subtitle1">{title}</Typography>
      <Typography variant="body2" color="text.secondary">
        {text}
      </Typography>
    </ButtonBase>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <Button color="inherit" startIcon={<ArrowLeft size={18} />} onClick={onClick} sx={{ alignSelf: 'flex-start' }}>
      Back
    </Button>
  );
}

function StepNav({ onBack, onNext, onSkip, nextLabel = 'Continue', nextDisabled }: { onBack: () => void; onNext: () => void; onSkip?: () => void; nextLabel?: string; nextDisabled?: boolean }) {
  return (
    <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="center" sx={{ pt: 1 }}>
      <BackButton onClick={onBack} />
      <Stack direction="row" spacing={1}>
        {onSkip && (
          <Button color="inherit" onClick={onSkip}>
            Skip
          </Button>
        )}
        <Button variant="contained" onClick={onNext} disabled={nextDisabled} endIcon={<ArrowRight size={18} />}>
          {nextLabel}
        </Button>
      </Stack>
    </Stack>
  );
}
