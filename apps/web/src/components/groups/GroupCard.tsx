import { Link as RouterLink } from 'react-router-dom';
import { Box, Card, CardActionArea, Chip, Stack, Typography } from '@mui/material';
import { CalendarDays } from 'lucide-react';
import { GROUP_TYPE_LABELS } from '@sharespace/core';
import type { GroupCard as GroupCardData } from '../../api/types';
import { useFormat } from '../../hooks/useAuth';
import { AvatarStack } from '../common/MemberAvatar';
import { BalanceLabel, Money } from '../common/Money';
import { BudgetMeter, GroupTypeIcon } from '../common/Indicators';

export function GroupCard({ group }: { group: GroupCardData }) {
  const fmt = useFormat();
  return (
    <Card sx={{ height: '100%', transition: 'border-color 120ms', '&:hover': { borderColor: 'primary.light' } }}>
      <CardActionArea component={RouterLink} to={`/groups/${group.id}`} sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'stretch' }} aria-label={`Open ${group.name}`}>
        <Box sx={{ height: 6, bgcolor: group.accent }} aria-hidden />
        <Stack spacing={2} sx={{ p: 2.5, flex: 1 }}>
          <Stack direction="row" spacing={1.5} alignItems="flex-start" justifyContent="space-between">
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h3" component="h3" noWrap>
                {group.name}
              </Typography>
              <Stack direction="row" spacing={0.75} alignItems="center" sx={{ color: 'text.secondary', mt: 0.25 }}>
                <GroupTypeIcon type={group.type} size={14} />
                <Typography variant="caption">
                  {GROUP_TYPE_LABELS[group.type]} · {group.memberCount} {group.memberCount === 1 ? 'member' : 'members'}
                </Typography>
                {group.archivedAt && <Chip size="small" label="Archived" sx={{ height: 20 }} />}
              </Stack>
            </Box>
            <AvatarStack members={group.members} total={group.memberCount} size={26} max={4} />
          </Stack>

          <Stack direction="row" justifyContent="space-between" alignItems="flex-end" spacing={1}>
            <BalanceLabel netMinor={group.myNetMinor} currency={group.currency} size="small" />
            <Box sx={{ textAlign: 'right' }}>
              <Typography variant="caption" component="div">
                Group spending
              </Typography>
              <Money minor={group.totalSpendingMinor} currency={group.currency} sx={{ fontSize: '0.9rem' }} />
            </Box>
          </Stack>

          {group.budget && <BudgetMeter {...group.budget} currency={group.currency} compact />}

          {group.upcomingPlan && (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 'auto', pt: 0.5, color: 'money.attention' }}>
              <CalendarDays size={15} aria-hidden />
              <Typography variant="caption" noWrap sx={{ color: 'inherit', fontWeight: 600 }}>
                {group.upcomingPlan.title} · {fmt.date(group.upcomingPlan.startDate)}
              </Typography>
            </Stack>
          )}
        </Stack>
      </CardActionArea>
    </Card>
  );
}
