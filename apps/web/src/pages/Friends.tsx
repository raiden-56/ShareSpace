import { useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Card, Chip, InputAdornment, Stack, TextField, Typography } from '@mui/material';
import { ChevronRight, Contact, Plus, Search } from 'lucide-react';
import { formatMoney } from '@sharespace/core';
import { useFriendsQuery } from '../api/api';
import type { Friend } from '../api/types';
import { useAppDispatch } from '../store';
import { setCreateGroupOpen } from '../store/ui';
import { PageHeader, PageTransition, StatTile } from '../components/common/Layout';
import { MemberAvatar } from '../components/common/MemberAvatar';
import { SettlementListSkeleton } from '../components/common/Skeletons';
import { EmptyState, ErrorState } from '../components/common/States';
import { FriendBalance } from '../components/friends/FriendBalance';
import { friendPath, matchesFilter, totalsByCurrency, type FriendFilter } from '../components/friends/friendLogic';
import { pluralize } from '../lib/format';

const FILTERS: { value: FriendFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'owes-you', label: 'Owe you' },
  { value: 'you-owe', label: 'You owe' },
  { value: 'settled', label: 'Settled up' },
];

function FriendRow({ friend }: { friend: Friend }) {
  const groupCount = friend.groups.length;
  return (
    <Box
      component={RouterLink}
      to={friendPath(friend.key)}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        px: { xs: 2, sm: 2.5 },
        py: 1.75,
        color: 'inherit',
        textDecoration: 'none',
        borderTop: 1,
        borderColor: 'divider',
        '&:first-of-type': { borderTop: 0 },
        '&:hover': { bgcolor: 'action.hover' },
        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
      }}
    >
      <MemberAvatar name={friend.name} color={friend.avatarColor} placeholder={friend.isPlaceholder} size={40} />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0, flexWrap: 'wrap', rowGap: 0.5 }}>
          <Typography variant="subtitle1" component="span" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
            {friend.name}
          </Typography>
          {friend.isPlaceholder && <Chip size="small" variant="outlined" label="Added by name" />}
        </Stack>
        <Typography variant="caption" component="p">
          {groupCount === 1 && friend.groups[0]!.isDirect ? 'Expenses outside groups' : `${pluralize(groupCount, 'shared group')}`}
        </Typography>
      </Box>
      <FriendBalance friend={friend} />
      <ChevronRight size={18} aria-hidden style={{ flexShrink: 0, opacity: 0.6 }} />
    </Box>
  );
}

export default function Friends() {
  const dispatch = useAppDispatch();
  const { data, error, isLoading, refetch } = useFriendsQuery();
  const [filter, setFilter] = useState<FriendFilter>('all');
  const [query, setQuery] = useState('');

  const friends = useMemo(() => data?.friends ?? [], [data]);
  const totals = useMemo(() => totalsByCurrency(friends), [friends]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return friends.filter((f) => matchesFilter(f, filter) && (!q || f.name.toLowerCase().includes(q)));
  }, [friends, filter, query]);

  const createGroup = (
    <Button variant="contained" startIcon={<Plus size={18} />} onClick={() => dispatch(setCreateGroupOpen(true))}>
      Create group
    </Button>
  );

  return (
    <PageTransition>
      <PageHeader title="Friends" subtitle="Everyone you share a group with, and one balance per person across all your groups." />
      {error ? (
        <ErrorState error={error} onRetry={refetch} title="Could not load friends" />
      ) : isLoading || !data ? (
        <SettlementListSkeleton rows={4} />
      ) : friends.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Contact size={26} />}
            title="No friends yet"
            description="People appear here once you share a group with them. Create a group and add the people you split costs with."
            action={createGroup}
          />
        </Card>
      ) : (
        <Stack spacing={2.5}>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' } }}>
            <StatTile
              label="You are owed"
              value={
                totals.some((t) => t.owedToYouMinor > 0) ? (
                  <Stack spacing={0.25}>
                    {totals.filter((t) => t.owedToYouMinor > 0).map((t) => (
                      <Box key={t.currency} component="span" sx={{ color: 'money.positive', fontVariantNumeric: 'tabular-nums' }}>
                        {formatMoney(t.owedToYouMinor, t.currency)}
                      </Box>
                    ))}
                  </Stack>
                ) : (
                  <Box component="span" sx={{ color: 'text.secondary' }}>Nothing</Box>
                )
              }
              hint="Total your friends owe you"
            />
            <StatTile
              label="You owe"
              value={
                totals.some((t) => t.youOweMinor > 0) ? (
                  <Stack spacing={0.25}>
                    {totals.filter((t) => t.youOweMinor > 0).map((t) => (
                      <Box key={t.currency} component="span" sx={{ color: 'money.negative', fontVariantNumeric: 'tabular-nums' }}>
                        {formatMoney(t.youOweMinor, t.currency)}
                      </Box>
                    ))}
                  </Stack>
                ) : (
                  <Box component="span" sx={{ color: 'text.secondary' }}>Nothing</Box>
                )
              }
              hint="Total you owe your friends"
            />
          </Box>

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }} justifyContent="space-between">
            <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }} role="group" aria-label="Filter friends">
              {FILTERS.map((f) => (
                <Chip
                  key={f.value}
                  label={f.label}
                  clickable
                  color={filter === f.value ? 'primary' : 'default'}
                  variant={filter === f.value ? 'filled' : 'outlined'}
                  aria-pressed={filter === f.value}
                  onClick={() => setFilter(f.value)}
                />
              ))}
            </Stack>
            <TextField
              size="small"
              placeholder="Search by name"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              sx={{ width: { xs: '100%', md: 260 } }}
              slotProps={{
                htmlInput: { 'aria-label': 'Search friends by name' },
                input: { startAdornment: <InputAdornment position="start"><Search size={16} aria-hidden /></InputAdornment> },
              }}
            />
          </Stack>

          <Card>
            {visible.length === 0 ? (
              <EmptyState compact icon={<Search size={22} />} title="No friends match" description="Try another filter or name." />
            ) : (
              <Box component="nav" aria-label="Friends">
                {visible.map((f) => (
                  <FriendRow key={f.key} friend={f} />
                ))}
              </Box>
            )}
          </Card>
          <Typography variant="caption" component="p">
            Balances follow each group's settings. Amounts in different currencies are shown separately and never converted.
          </Typography>
        </Stack>
      )}
    </PageTransition>
  );
}
