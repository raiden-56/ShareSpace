import { useEffect, useState } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import {
  Activity as ActivityIcon,
  CalendarDays,
  HandCoins,
  ListChecks,
  Paperclip,
  Pencil,
  Receipt,
  Target,
  Trash2,
  UserPlus,
  Users,
  Vote,
  type LucideIcon,
} from 'lucide-react';
import { useActivityQuery } from '../../api/api';
import type { Activity } from '../../api/types';
import { useFormat } from '../../hooks/useAuth';
import { useGroupContext } from '../../hooks/useGroupContext';
import { timeAgo } from '../../lib/format';
import { PageTransition, SectionCard } from '../../components/common/Layout';
import { ActivityFeedSkeleton } from '../../components/common/Skeletons';
import { EmptyState, ErrorState } from '../../components/common/States';

function iconFor(type: string): LucideIcon {
  if (type.startsWith('EXPENSE_DELETED')) return Trash2;
  if (type.startsWith('EXPENSE_EDITED')) return Pencil;
  if (type.startsWith('EXPENSE')) return Receipt;
  if (type.startsWith('SETTLEMENT')) return HandCoins;
  if (type.startsWith('BUDGET')) return Target;
  if (type.startsWith('PLAN') || type.startsWith('ITINERARY')) return CalendarDays;
  if (type.startsWith('CHECKLIST')) return ListChecks;
  if (type.startsWith('POLL')) return Vote;
  if (type.startsWith('RECEIPT')) return Paperclip;
  if (type.startsWith('MEMBER') || type.startsWith('INVITATION')) return UserPlus;
  return Users;
}

export default function GroupActivity() {
  const { groupId } = useGroupContext();
  const fmt = useFormat();
  const [before, setBefore] = useState<string | undefined>(undefined);
  const [items, setItems] = useState<Activity[]>([]);
  const { data, error, isFetching, refetch } = useActivityQuery({ groupId, before });

  // Accumulate pages for "Load older"; a fresh first page (e.g. after a new event) replaces the list.
  useEffect(() => {
    if (!data) return;
    setItems((prev) => (before ? [...prev, ...data.items.filter((i) => !prev.some((p) => p.id === i.id))] : data.items));
  }, [data, before]);

  const byDay = new Map<string, Activity[]>();
  for (const a of items) {
    const day = a.createdAt.slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), a]);
  }

  return (
    <PageTransition>
      <SectionCard title="Activity" subtitle="Every change to this group's records, with who made it and when.">
        {error ? (
          <ErrorState error={error} onRetry={refetch} />
        ) : !data && items.length === 0 ? (
          <ActivityFeedSkeleton rows={8} />
        ) : items.length === 0 ? (
          <EmptyState compact icon={<ActivityIcon size={22} />} title="No activity yet" />
        ) : (
          <Stack spacing={3}>
            {[...byDay.entries()].map(([day, list]) => (
              <Box key={day}>
                <Typography variant="overline" component="h3" sx={{ mb: 1, display: 'block' }}>
                  {fmt.day(day)}
                </Typography>
                <Stack component="ol" spacing={1.75} sx={{ listStyle: 'none', p: 0, m: 0 }}>
                  {list.map((a) => {
                    const Icon = iconFor(a.type);
                    return (
                      <Stack component="li" key={a.id} direction="row" spacing={1.5}>
                        <Box aria-hidden sx={{ width: 30, height: 30, flexShrink: 0, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: 'surface.sage', color: 'primary.main' }}>
                          <Icon size={15} />
                        </Box>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                            {a.summary}
                          </Typography>
                          <Typography variant="caption" component="time" dateTime={a.createdAt} title={fmt.dateTime(a.createdAt)}>
                            {timeAgo(a.createdAt)}
                          </Typography>
                        </Box>
                      </Stack>
                    );
                  })}
                </Stack>
              </Box>
            ))}
            {data?.hasMore && (
              <Button variant="outlined" disabled={isFetching} onClick={() => setBefore(items[items.length - 1]?.createdAt)} sx={{ alignSelf: 'center' }}>
                {isFetching ? 'Loading…' : 'Load older activity'}
              </Button>
            )}
          </Stack>
        )}
      </SectionCard>
    </PageTransition>
  );
}
