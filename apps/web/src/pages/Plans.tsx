import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { parseISO, format } from 'date-fns';
import { Box, Button, Card, Stack, Tab, Tabs, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { CalendarPlus, CalendarRange, LayoutGrid, Plus } from 'lucide-react';
import { useAllPlansQuery, useGroupsQuery } from '../api/api';
import type { GlobalPlan } from '../api/types';
import { PageHeader, PageTransition } from '../components/common/Layout';
import { PlanCardSkeleton } from '../components/common/Skeletons';
import { EmptyState, ErrorState } from '../components/common/States';
import { PlanCard } from '../components/plans/PlanCard';
import { PlanFormDialog } from '../components/plans/PlanFormDialog';
import { isPastPlan, sortPlans } from '../components/plans/planUtils';
import { useAppDispatch } from '../store';
import { setCreateGroupOpen } from '../store/ui';

type View = 'cards' | 'timeline';

function Timeline({ plans }: { plans: GlobalPlan[] }) {
  const months = useMemo(() => {
    const map = new Map<string, GlobalPlan[]>();
    for (const p of plans) {
      const key = p.startDate.slice(0, 7);
      map.set(key, [...(map.get(key) ?? []), p]);
    }
    return [...map.entries()];
  }, [plans]);
  return (
    <Stack spacing={3}>
      {months.map(([month, items]) => (
        <Box key={month} component="section" aria-label={format(parseISO(`${month}-01`), 'MMMM yyyy')}>
          <Typography variant="overline" component="h2" sx={{ mb: 1 }}>
            {format(parseISO(`${month}-01`), 'MMMM yyyy')}
          </Typography>
          <Card sx={{ p: 1 }}>
            <Stack divider={<Box sx={{ borderTop: 1, borderColor: 'divider' }} />}>
              {items.map((p) => (
                <PlanCard key={p.id} plan={p} currency={p.currency} variant="row" group={{ name: p.groupName, accent: p.groupAccent }} />
              ))}
            </Stack>
          </Card>
        </Box>
      ))}
    </Stack>
  );
}

export default function Plans() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { data, isLoading, error, refetch } = useAllPlansQuery();
  const { data: groupsData } = useGroupsQuery();
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const [view, setView] = useState<View>('cards');
  const [dialogOpen, setDialogOpen] = useState(false);

  const canCreate = (groupsData?.groups ?? []).some((g) => g.role && g.role !== 'VIEWER' && !g.archivedAt);
  const hasGroups = (groupsData?.groups.length ?? 0) > 0;

  const { upcoming, past } = useMemo(() => {
    const sorted = sortPlans(data?.plans ?? []);
    return { upcoming: sorted.filter((p) => !isPastPlan(p)), past: sorted.filter((p) => isPastPlan(p)) };
  }, [data]);
  const shown = tab === 'upcoming' ? upcoming : past;

  return (
    <PageTransition>
      <PageHeader
        title="Plans & Events"
        subtitle="Trips, dinners and events across all your groups"
        actions={
          canCreate && (
            <Button variant="contained" startIcon={<CalendarPlus size={18} />} onClick={() => setDialogOpen(true)}>
              New plan
            </Button>
          )
        }
      />

      {isLoading ? (
        <PlanCardSkeleton />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} title="Could not load plans" />
      ) : (data?.plans.length ?? 0) === 0 ? (
        <Card>
          <EmptyState
            icon={<CalendarPlus size={26} />}
            title="No plans yet"
            description={hasGroups ? 'Create a plan in one of your groups to coordinate dates, itinerary, tasks and spending.' : 'Plans belong to groups. Create a group first, then start planning together.'}
            action={
              canCreate ? (
                <Button variant="contained" startIcon={<Plus size={18} />} onClick={() => setDialogOpen(true)}>
                  Create a plan
                </Button>
              ) : !hasGroups ? (
                <Button variant="contained" startIcon={<Plus size={18} />} onClick={() => dispatch(setCreateGroupOpen(true))}>
                  Create a group
                </Button>
              ) : null
            }
          />
        </Card>
      ) : (
        <>
          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1.5} sx={{ mb: 2 }}>
            <Tabs value={tab} onChange={(_e, v: 'upcoming' | 'past') => setTab(v)} aria-label="Plan timeframe">
              <Tab value="upcoming" label={`Upcoming (${upcoming.length})`} />
              <Tab value="past" label={`Past (${past.length})`} />
            </Tabs>
            <ToggleButtonGroup size="small" exclusive value={view} onChange={(_e, v: View | null) => v && setView(v)} aria-label="Plan layout">
              <ToggleButton value="cards" aria-label="Card view" sx={{ width: 40, height: 40 }}>
                <LayoutGrid size={17} />
              </ToggleButton>
              <ToggleButton value="timeline" aria-label="Timeline by month" sx={{ width: 40, height: 40 }}>
                <CalendarRange size={17} />
              </ToggleButton>
            </ToggleButtonGroup>
          </Stack>
          {shown.length === 0 ? (
            <Card>
              <EmptyState
                compact
                icon={<CalendarPlus size={22} />}
                title={tab === 'upcoming' ? 'Nothing coming up' : 'No past plans'}
                description={tab === 'upcoming' ? 'Completed, cancelled and finished plans are under Past.' : undefined}
                action={tab === 'upcoming' && canCreate && <Button onClick={() => setDialogOpen(true)}>Create a plan</Button>}
              />
            </Card>
          ) : view === 'cards' ? (
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' } }}>
              {shown.map((p) => (
                <PlanCard key={p.id} plan={p} currency={p.currency} group={{ name: p.groupName, accent: p.groupAccent }} />
              ))}
            </Box>
          ) : (
            <Timeline plans={shown} />
          )}
        </>
      )}

      <PlanFormDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onSaved={(planId, groupId) => navigate(`/groups/${groupId}/plans/${planId}`)} />
    </PageTransition>
  );
}
