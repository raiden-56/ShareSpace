import { Link as RouterLink, Outlet, useLocation } from 'react-router-dom';
import { Alert, Box, Button, Card, Chip, IconButton, Skeleton, Stack, Tab, Tabs, Tooltip, Typography } from '@mui/material';
import { HandCoins, Plus, Settings } from 'lucide-react';
import { GROUP_TYPE_LABELS, ROLE_LABELS } from '@sharespace/core';
import { useRestoreGroupMutation, toApiError } from '../../api/api';
import { useGroupContext } from '../../hooks/useGroupContext';
import { useAppDispatch } from '../../store';
import { openExpenseDialog, openSettleDialog, showToast } from '../../store/ui';
import { AvatarStack } from '../../components/common/MemberAvatar';
import { BalanceLabel } from '../../components/common/Money';
import { GroupTypeIcon } from '../../components/common/Indicators';
import { ErrorState } from '../../components/common/States';

const TABS = [
  { label: 'Overview', path: '' },
  { label: 'Expenses', path: 'expenses' },
  { label: 'Members', path: 'members' },
  { label: 'Balances', path: 'balances' },
  { label: 'Budget', path: 'budget' },
  { label: 'Plans', path: 'plans' },
  { label: 'Activity', path: 'activity' },
];

export default function GroupLayout() {
  const { groupId, data, error, isLoading, refetch, helpers } = useGroupContext();
  const { pathname } = useLocation();
  const dispatch = useAppDispatch();
  const [restore, { isLoading: restoring }] = useRestoreGroupMutation();
  const base = `/groups/${groupId}`;
  const sub = pathname.slice(base.length).replace(/^\//, '').split('/')[0] ?? '';
  const current = sub === 'settings' ? false : TABS.some((t) => t.path === sub) ? sub : '';

  if (error) return <ErrorState error={error} onRetry={refetch} title="Could not load this group" />;

  const group = data?.group;
  return (
    <Box>
      <Card sx={{ mb: 2.5, overflow: 'hidden' }}>
        <Box sx={{ height: 6, bgcolor: group?.accent ?? 'divider' }} aria-hidden />
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ p: { xs: 2, md: 2.5 } }} alignItems={{ md: 'center' }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {isLoading || !group ? (
              <>
                <Skeleton width={220} height={32} />
                <Skeleton width={160} height={18} />
              </>
            ) : (
              <>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                  <Typography variant="h1" component="h1" sx={{ overflowWrap: 'anywhere' }}>
                    {group.name}
                  </Typography>
                  {group.archivedAt && <Chip size="small" label="Archived" />}
                </Stack>
                <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mt: 0.75, color: 'text.secondary', flexWrap: 'wrap', rowGap: 0.5 }}>
                  <Stack direction="row" spacing={0.75} alignItems="center">
                    <GroupTypeIcon type={group.type} size={16} />
                    <Typography variant="body2" color="text.secondary">
                      {GROUP_TYPE_LABELS[group.type]}
                    </Typography>
                  </Stack>
                  <Typography variant="body2" color="text.secondary" aria-hidden>
                    ·
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {group.currency}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" aria-hidden>
                    ·
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    You are {data ? ROLE_LABELS[data.role].toLowerCase() : ''}
                  </Typography>
                  <AvatarStack members={group.members} total={group.memberCount} size={24} />
                </Stack>
              </>
            )}
          </Box>
          {group && (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
              <BalanceLabel netMinor={group.myNetMinor} currency={group.currency} />
              {helpers?.can('editRecords') && (
                <Stack direction="row" spacing={1}>
                  <Button
                    variant="outlined"
                    startIcon={<HandCoins size={18} />}
                    onClick={() => dispatch(openSettleDialog({ groupId }))}
                    sx={{ flex: { xs: 1, sm: 'none' }, whiteSpace: 'nowrap' }}
                  >
                    Settle up
                  </Button>
                  <Button variant="contained" startIcon={<Plus size={18} />} onClick={() => dispatch(openExpenseDialog({ groupId }))} sx={{ flex: { xs: 1, sm: 'none' }, whiteSpace: 'nowrap' }}>
                    Add expense
                  </Button>
                </Stack>
              )}
            </Stack>
          )}
        </Stack>
        <Stack direction="row" alignItems="center" sx={{ borderTop: 1, borderColor: 'divider', pl: { xs: 0.5, md: 1.5 }, pr: 1 }}>
          <Tabs value={current} variant="scrollable" scrollButtons={false} aria-label="Group sections" sx={{ flex: 1, minWidth: 0 }}>
            {TABS.map((t) => (
              <Tab key={t.path} label={t.label} value={t.path} component={RouterLink} to={t.path ? `${base}/${t.path}` : base} sx={{ px: 1.5, minWidth: 0 }} />
            ))}
          </Tabs>
          <Tooltip title="Group settings">
            <IconButton component={RouterLink} to={`${base}/settings`} aria-label="Group settings" color={sub === 'settings' ? 'primary' : 'default'}>
              <Settings size={19} />
            </IconButton>
          </Tooltip>
        </Stack>
      </Card>

      {group?.archivedAt && (
        <Alert
          severity="info"
          sx={{ mb: 2.5 }}
          action={
            data?.role === 'OWNER' && (
              <Button
                color="inherit"
                size="small"
                disabled={restoring}
                onClick={() =>
                  restore(groupId)
                    .unwrap()
                    .then(() => dispatch(showToast({ message: 'Group restored' })))
                    .catch((e) => dispatch(showToast({ message: toApiError(e).message, severity: 'error' })))
                }
              >
                Restore group
              </Button>
            )
          }
        >
          This group is archived and read-only.
        </Alert>
      )}

      <Outlet />
    </Box>
  );
}
