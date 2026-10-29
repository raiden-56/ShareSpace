import { useNavigate, useSearchParams } from 'react-router-dom';
import { Box, Button, Card, CardContent, Stack, Tab, Tabs, Typography } from '@mui/material';
import { BellOff, CheckCheck, Inbox, UserPlus } from 'lucide-react';
import { GROUP_TYPE_LABELS, ROLE_LABELS } from '@sharespace/core';
import {
  toApiError,
  useMarkAllNotificationsReadMutation,
  useMarkNotificationMutation,
  useMyInvitationsQuery,
  useNotificationsQuery,
  useRespondToInvitationMutation,
} from '../api/api';
import type { Notification } from '../api/types';
import { useFormat } from '../hooks/useAuth';
import { useAppDispatch } from '../store';
import { showToast } from '../store/ui';
import { PageHeader, PageTransition } from '../components/common/Layout';
import { EmptyState, ErrorState } from '../components/common/States';
import { ActivityFeedSkeleton } from '../components/common/Skeletons';
import { NotificationItem } from '../components/notifications/NotificationItem';

type TabKey = 'all' | 'unread' | 'invitations';

function NotificationList({ unreadOnly }: { unreadOnly: boolean }) {
  const { data, isLoading, error, refetch } = useNotificationsQuery(unreadOnly ? { unread: true } : undefined);
  const [mark] = useMarkNotificationMutation();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();

  if (error) return <ErrorState error={error} onRetry={refetch} title="Could not load notifications" />;
  if (isLoading || !data) return <ActivityFeedSkeleton rows={6} />;
  if (data.items.length === 0) {
    return (
      <EmptyState
        icon={<BellOff size={26} />}
        title="You're all caught up"
        description={unreadOnly ? 'There are no unread notifications.' : 'Updates about expenses, repayments, budgets, plans and polls in your groups will appear here.'}
      />
    );
  }

  const toggle = (n: Notification) =>
    mark({ id: n.id, read: !n.readAt })
      .unwrap()
      .catch((e) => dispatch(showToast({ message: toApiError(e).message, severity: 'error' })));

  const open = (n: Notification) => {
    if (!n.readAt) void mark({ id: n.id, read: true });
    if (n.link) navigate(n.link);
  };

  return (
    <Box component="ul" sx={{ p: 0, m: 0, display: 'grid', gap: 0.75 }} aria-label="Notifications">
      {data.items.map((n) => (
        <NotificationItem key={n.id} notification={n} onOpen={open} onToggleRead={toggle} />
      ))}
    </Box>
  );
}

function InvitationList() {
  const { data, isLoading, error, refetch } = useMyInvitationsQuery();
  const [respond, { isLoading: responding, originalArgs }] = useRespondToInvitationMutation();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const fmt = useFormat();

  if (error) return <ErrorState error={error} onRetry={refetch} title="Could not load invitations" />;
  if (isLoading || !data) return <ActivityFeedSkeleton rows={3} />;
  if (data.invitations.length === 0) {
    return <EmptyState icon={<Inbox size={26} />} title="No pending invitations" description="When someone invites you to a group, you can accept or decline it here." />;
  }

  const act = (invitationId: string, action: 'accept' | 'decline', groupName: string) =>
    respond({ invitationId, action })
      .unwrap()
      .then((r) => {
        dispatch(showToast({ message: action === 'accept' ? `You joined ${groupName}` : 'Invitation declined', severity: action === 'accept' ? 'success' : 'info' }));
        if (action === 'accept') navigate(`/groups/${r.groupId}`);
      })
      .catch((e) => dispatch(showToast({ message: toApiError(e).message, severity: 'error' })));

  return (
    <Stack spacing={1.5}>
      {data.invitations.map((inv) => {
        const busy = responding && originalArgs?.invitationId === inv.id;
        return (
          <Card key={inv.id}>
            <CardContent sx={{ p: 2.25, '&:last-child': { pb: 2.25 } }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
                <Box sx={{ width: 40, height: 40, borderRadius: '12px', display: 'grid', placeItems: 'center', bgcolor: 'surface.sage', color: 'primary.main', flexShrink: 0 }} aria-hidden>
                  <UserPlus size={20} />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="subtitle1">{inv.groupName}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {inv.invitedByName} invited you as {ROLE_LABELS[inv.role].toLowerCase()} · {GROUP_TYPE_LABELS[inv.groupType]} · expires {fmt.date(inv.expiresAt)}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1}>
                  <Button color="inherit" disabled={busy} onClick={() => act(inv.id, 'decline', inv.groupName)}>
                    Decline
                  </Button>
                  <Button variant="contained" disabled={busy} onClick={() => act(inv.id, 'accept', inv.groupName)}>
                    Accept
                  </Button>
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        );
      })}
    </Stack>
  );
}

export default function Notifications() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: TabKey = raw === 'unread' || raw === 'invitations' ? raw : 'all';
  const { data } = useNotificationsQuery(undefined);
  const { data: invites } = useMyInvitationsQuery();
  const [markAll, { isLoading: markingAll }] = useMarkAllNotificationsReadMutation();
  const dispatch = useAppDispatch();
  const unread = data?.unreadCount ?? 0;
  const pendingInvites = invites?.invitations.length ?? 0;

  return (
    <PageTransition>
      <PageHeader
        title="Notifications"
        subtitle="In-app updates from your groups."
        actions={
          tab !== 'invitations' && (
            <Button
              variant="outlined"
              startIcon={<CheckCheck size={18} />}
              disabled={unread === 0 || markingAll}
              onClick={() =>
                markAll()
                  .unwrap()
                  .then(() => dispatch(showToast({ message: 'All notifications marked as read' })))
                  .catch((e) => dispatch(showToast({ message: toApiError(e).message, severity: 'error' })))
              }
            >
              Mark all as read
            </Button>
          )
        }
      />
      <Tabs
        value={tab}
        onChange={(_e, v: TabKey) => setParams(v === 'all' ? {} : { tab: v }, { replace: true })}
        aria-label="Notification filters"
        sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
        variant="scrollable"
        scrollButtons={false}
      >
        <Tab value="all" label="All" />
        <Tab value="unread" label={unread ? `Unread (${unread})` : 'Unread'} />
        <Tab value="invitations" label={pendingInvites ? `Invitations (${pendingInvites})` : 'Invitations'} />
      </Tabs>
      {tab === 'invitations' ? <InvitationList /> : <NotificationList unreadOnly={tab === 'unread'} />}
    </PageTransition>
  );
}
