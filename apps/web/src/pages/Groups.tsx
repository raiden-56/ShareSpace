import { useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Box, Button, Card, Stack, Tab, Tabs, Typography } from '@mui/material';
import { Archive, Mail, Plus, Users } from 'lucide-react';
import { toApiError, useGroupsQuery, useMyInvitationsQuery, useRespondToInvitationMutation } from '../api/api';
import { useAppDispatch } from '../store';
import { setCreateGroupOpen, showToast } from '../store/ui';
import { PageHeader, PageTransition } from '../components/common/Layout';
import { GroupCardSkeleton } from '../components/common/Skeletons';
import { EmptyState, ErrorState } from '../components/common/States';
import { GroupCard } from '../components/groups/GroupCard';

export default function Groups() {
  const [params, setParams] = useSearchParams();
  const archived = params.get('tab') === 'archived';
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { data, error, isLoading, refetch } = useGroupsQuery({ archived });
  const { data: invites } = useMyInvitationsQuery();
  const [respond, { isLoading: responding }] = useRespondToInvitationMutation();

  return (
    <PageTransition>
      <PageHeader
        title="My Groups"
        subtitle="Every group you belong to, with your balance in each."
        actions={
          <Button variant="contained" startIcon={<Plus size={18} />} onClick={() => dispatch(setCreateGroupOpen(true))}>
            Create group
          </Button>
        }
      />

      {invites && invites.invitations.length > 0 && (
        <Stack spacing={1.25} sx={{ mb: 3 }}>
          {invites.invitations.map((inv) => (
            <Alert
              key={inv.id}
              icon={<Mail size={20} />}
              severity="info"
              action={
                <Stack direction="row" spacing={1}>
                  <Button
                    size="small"
                    color="inherit"
                    disabled={responding}
                    onClick={() =>
                      respond({ invitationId: inv.id, action: 'decline' })
                        .unwrap()
                        .then(() => dispatch(showToast({ message: 'Invitation declined', severity: 'info' })))
                        .catch((e) => dispatch(showToast({ message: toApiError(e).message, severity: 'error' })))
                    }
                  >
                    Decline
                  </Button>
                  <Button
                    size="small"
                    variant="contained"
                    disabled={responding}
                    onClick={() =>
                      respond({ invitationId: inv.id, action: 'accept' })
                        .unwrap()
                        .then((r) => {
                          dispatch(showToast({ message: `You joined ${inv.groupName}` }));
                          navigate(`/groups/${r.groupId}`);
                        })
                        .catch((e) => dispatch(showToast({ message: toApiError(e).message, severity: 'error' })))
                    }
                  >
                    Accept
                  </Button>
                </Stack>
              }
            >
              <strong>{inv.invitedByName}</strong> invited you to join <strong>{inv.groupName}</strong>
            </Alert>
          ))}
        </Stack>
      )}

      <Tabs value={archived ? 'archived' : 'active'} onChange={(_e, v: string) => setParams(v === 'archived' ? { tab: 'archived' } : {})} sx={{ mb: 2.5, borderBottom: 1, borderColor: 'divider' }} aria-label="Group status">
        <Tab value="active" label="Active" />
        <Tab value="archived" label="Archived" />
      </Tabs>

      {error ? (
        <ErrorState error={error} onRetry={refetch} title="Could not load groups" />
      ) : isLoading || !data ? (
        <GroupCardSkeleton count={6} />
      ) : data.groups.length === 0 ? (
        <Card>
          {archived ? (
            <EmptyState icon={<Archive size={24} />} title="No archived groups" description="Groups you archive stay readable here and can be restored by their owner." />
          ) : (
            <EmptyState
              icon={<Users size={26} />}
              title="No groups yet"
              description="Create a group for a trip, a shared home, a dinner or anything you share costs for."
              action={
                <Button variant="contained" startIcon={<Plus size={18} />} onClick={() => dispatch(setCreateGroupOpen(true))}>
                  Create group
                </Button>
              }
            />
          )}
        </Card>
      ) : (
        <>
          <Typography variant="caption" component="p" sx={{ mb: 1.5 }}>
            {data.groups.length} {data.groups.length === 1 ? 'group' : 'groups'}
          </Typography>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' } }}>
            {data.groups.map((g) => (
              <GroupCard key={g.id} group={g} />
            ))}
          </Box>
        </>
      )}
    </PageTransition>
  );
}
