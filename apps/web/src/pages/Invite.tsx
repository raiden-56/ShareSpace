import { useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { Alert, Box, Button, Card, Skeleton, Stack, Typography } from '@mui/material';
import { Mail } from 'lucide-react';
import { GROUP_TYPE_LABELS, ROLE_LABELS } from '@sharespace/core';
import { toApiError, useInvitationByTokenQuery, useRespondToInvitationTokenMutation, useUpdatePreferencesMutation } from '../api/api';
import { useAuth, useFormat } from '../hooks/useAuth';
import { useAppDispatch } from '../store';
import { showToast } from '../store/ui';
import { ErrorState } from '../components/common/States';

export default function Invite() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const fmt = useFormat();
  const { user, preferences } = useAuth();
  const { data, error, isLoading, refetch } = useInvitationByTokenQuery(token, { skip: !token });
  const [respond, { isLoading: responding }] = useRespondToInvitationTokenMutation();
  const [updatePrefs] = useUpdatePreferencesMutation();
  const [actionError, setActionError] = useState<string | null>(null);

  const act = async (action: 'accept' | 'decline') => {
    setActionError(null);
    try {
      const r = await respond({ token, action }).unwrap();
      // Joining via an invite counts as finishing onboarding.
      if (preferences && !preferences.onboardingCompleted) await updatePrefs({ onboardingCompleted: true }).unwrap().catch(() => undefined);
      if (action === 'accept') {
        dispatch(showToast({ message: `You joined ${data?.invitation.groupName ?? 'the group'}` }));
        navigate(`/groups/${r.groupId}`, { replace: true });
      } else {
        dispatch(showToast({ message: 'Invitation declined', severity: 'info' }));
        navigate('/', { replace: true });
      }
    } catch (e) {
      setActionError(toApiError(e).message);
    }
  };

  const inv = data?.invitation;
  return (
    <Box sx={{ maxWidth: 520, mx: 'auto', mt: { xs: 1, md: 4 } }}>
      {error ? (
        <ErrorState error={error} onRetry={refetch} title="This invitation could not be opened" />
      ) : (
        <Card sx={{ p: { xs: 2.5, sm: 4 } }}>
          {isLoading || !inv ? (
            <Stack spacing={1.5}>
              <Skeleton width="60%" height={32} />
              <Skeleton width="80%" />
              <Skeleton variant="rounded" height={40} />
            </Stack>
          ) : (
            <Stack spacing={2.5}>
              <Box sx={{ width: 52, height: 52, borderRadius: '16px', display: 'grid', placeItems: 'center', bgcolor: 'surface.sage', color: 'primary.main' }} aria-hidden>
                <Mail size={24} />
              </Box>
              <Box>
                <Typography variant="h1" component="h1">
                  Join {inv.groupName}
                </Typography>
                <Typography color="text.secondary" sx={{ mt: 0.75 }}>
                  {inv.invitedByName} invited you ({user?.email}) to this {GROUP_TYPE_LABELS[inv.groupType].toLowerCase()} group as {ROLE_LABELS[inv.role].toLowerCase()}.
                </Typography>
              </Box>
              {actionError && <Alert severity="error">{actionError}</Alert>}
              {inv.status === 'PENDING' ? (
                <>
                  <Typography variant="caption">Expires {fmt.date(inv.expiresAt)}</Typography>
                  <Stack direction={{ xs: 'column-reverse', sm: 'row' }} spacing={1.25}>
                    <Button color="inherit" variant="outlined" disabled={responding} onClick={() => void act('decline')}>
                      Decline
                    </Button>
                    <Button variant="contained" disabled={responding} onClick={() => void act('accept')}>
                      Accept and join
                    </Button>
                  </Stack>
                </>
              ) : (
                <>
                  <Alert severity={inv.status === 'ACCEPTED' ? 'success' : 'warning'}>
                    {inv.status === 'ACCEPTED'
                      ? 'This invitation has already been accepted.'
                      : inv.status === 'EXPIRED'
                        ? 'This invitation has expired. Ask a group admin to send a new one.'
                        : `This invitation was ${inv.status.toLowerCase()}.`}
                  </Alert>
                  {inv.status === 'ACCEPTED' && (
                    <Button component={RouterLink} to={`/groups/${inv.groupId}`} variant="contained">
                      Open group
                    </Button>
                  )}
                </>
              )}
            </Stack>
          )}
        </Card>
      )}
    </Box>
  );
}
