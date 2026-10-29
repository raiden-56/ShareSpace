import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Box, Button, Card, MenuItem, Stack, Tab, Tabs, TextField, ToggleButton, ToggleButtonGroup } from '@mui/material';
import { CalendarPlus, LayoutGrid, List as ListIcon, Plus, Vote } from 'lucide-react';
import { PLAN_STATUS_LABELS, PLAN_STATUSES, type PlanStatus } from '@sharespace/core';
import { useGroupPlansQuery, usePollsQuery } from '../../api/api';
import { useGroupContext } from '../../hooks/useGroupContext';
import { PageTransition } from '../../components/common/Layout';
import { PlanCardSkeleton } from '../../components/common/Skeletons';
import { EmptyState, ErrorState } from '../../components/common/States';
import { PlanCard } from '../../components/plans/PlanCard';
import { PlanFormDialog } from '../../components/plans/PlanFormDialog';
import { PollCard } from '../../components/plans/PollCard';
import { CreatePollDialog } from '../../components/plans/CreatePollDialog';
import { isPollClosed } from '../../components/plans/PollCard';
import { sortPlans } from '../../components/plans/planUtils';

type View = 'cards' | 'list';

function readView(): View {
  try {
    return localStorage.getItem('ss.plansView') === 'list' ? 'list' : 'cards';
  } catch {
    return 'cards';
  }
}

export default function GroupPlans() {
  const { groupId, helpers } = useGroupContext();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const tab = params.get('tab') === 'decisions' ? 'decisions' : 'plans';
  const [view, setView] = useState<View>(readView);
  const [status, setStatus] = useState<PlanStatus | 'ALL'>('ALL');
  const [planDialog, setPlanDialog] = useState(false);
  const [pollDialog, setPollDialog] = useState(false);

  const plansQuery = useGroupPlansQuery(groupId, { skip: !groupId });
  const pollsQuery = usePollsQuery({ groupId }, { skip: !groupId || tab !== 'decisions' });
  const canEdit = helpers?.can('editRecords') ?? false;
  const currency = helpers?.data.group.currency ?? 'INR';

  const plans = useMemo(() => {
    const all = plansQuery.data?.plans ?? [];
    return sortPlans(status === 'ALL' ? all : all.filter((p) => p.status === status));
  }, [plansQuery.data, status]);

  const planTitles = useMemo(() => new Map((plansQuery.data?.plans ?? []).map((p) => [p.id, p.title])), [plansQuery.data]);
  const polls = useMemo(() => {
    const all = pollsQuery.data?.polls ?? [];
    return [...all.filter((p) => !isPollClosed(p)), ...all.filter((p) => isPollClosed(p))];
  }, [pollsQuery.data]);

  const changeView = (v: View) => {
    setView(v);
    try {
      localStorage.setItem('ss.plansView', v);
    } catch {
      /* not remembered */
    }
  };

  const participantsFor = (ids: string[]) =>
    helpers
      ? ids
          .map((id) => helpers.memberById.get(id))
          .filter((m): m is NonNullable<typeof m> => !!m)
          .map((m) => ({ id: m.id, displayName: m.displayName, avatarColor: m.avatarColor }))
      : undefined;

  return (
    <PageTransition>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }} justifyContent="space-between" sx={{ mb: 2.5 }}>
        <Tabs
          value={tab}
          onChange={(_e, v: string) => setParams(v === 'decisions' ? { tab: 'decisions' } : {}, { replace: true })}
          aria-label="Plans and decisions"
        >
          <Tab value="plans" label="Plans" />
          <Tab value="decisions" label="Decisions" />
        </Tabs>
        {canEdit &&
          (tab === 'plans' ? (
            <Button variant="contained" startIcon={<CalendarPlus size={18} />} onClick={() => setPlanDialog(true)}>
              New plan
            </Button>
          ) : (
            <Button variant="contained" startIcon={<Vote size={18} />} onClick={() => setPollDialog(true)}>
              New poll
            </Button>
          ))}
      </Stack>

      {tab === 'plans' ? (
        <>
          {(plansQuery.data?.plans.length ?? 0) > 0 && (
            <Stack direction="row" spacing={1.5} alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
              <TextField select label="Status" value={status} onChange={(e) => setStatus(e.target.value as PlanStatus | 'ALL')} sx={{ maxWidth: 200 }}>
                <MenuItem value="ALL">All statuses</MenuItem>
                {PLAN_STATUSES.map((s) => (
                  <MenuItem key={s} value={s}>
                    {PLAN_STATUS_LABELS[s]}
                  </MenuItem>
                ))}
              </TextField>
              <ToggleButtonGroup size="small" exclusive value={view} onChange={(_e, v: View | null) => v && changeView(v)} aria-label="Plan layout">
                <ToggleButton value="cards" aria-label="Card view" sx={{ width: 40, height: 40 }}>
                  <LayoutGrid size={17} />
                </ToggleButton>
                <ToggleButton value="list" aria-label="List view" sx={{ width: 40, height: 40 }}>
                  <ListIcon size={17} />
                </ToggleButton>
              </ToggleButtonGroup>
            </Stack>
          )}
          {plansQuery.isLoading ? (
            <PlanCardSkeleton />
          ) : plansQuery.error ? (
            <ErrorState error={plansQuery.error} onRetry={plansQuery.refetch} title="Could not load plans" />
          ) : (plansQuery.data?.plans.length ?? 0) === 0 ? (
            <Card>
              <EmptyState
                icon={<CalendarPlus size={26} />}
                title="No plans yet"
                description="Plan trips, dinners and events together: dates, itinerary, a shared checklist and the expenses that go with them."
                action={
                  canEdit && (
                    <Button variant="contained" startIcon={<Plus size={18} />} onClick={() => setPlanDialog(true)}>
                      Create a plan
                    </Button>
                  )
                }
              />
            </Card>
          ) : plans.length === 0 ? (
            <Card>
              <EmptyState compact icon={<CalendarPlus size={22} />} title="No plans with this status" action={<Button onClick={() => setStatus('ALL')}>Show all plans</Button>} />
            </Card>
          ) : view === 'cards' ? (
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' } }}>
              {plans.map((p) => (
                <PlanCard key={p.id} plan={p} currency={currency} participants={participantsFor(p.participantIds)} />
              ))}
            </Box>
          ) : (
            <Card sx={{ p: 1 }}>
              <Stack divider={<Box sx={{ borderTop: 1, borderColor: 'divider' }} />}>
                {plans.map((p) => (
                  <PlanCard key={p.id} plan={p} currency={currency} variant="row" />
                ))}
              </Stack>
            </Card>
          )}
        </>
      ) : pollsQuery.isLoading ? (
        <PlanCardSkeleton count={2} />
      ) : pollsQuery.error ? (
        <ErrorState error={pollsQuery.error} onRetry={pollsQuery.refetch} title="Could not load polls" />
      ) : polls.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Vote size={26} />}
            title="No decisions yet"
            description="Ask the group: which hotel, which weekend, where to eat. Everyone with an account can vote."
            action={
              canEdit && (
                <Button variant="contained" startIcon={<Plus size={18} />} onClick={() => setPollDialog(true)}>
                  Start a poll
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, alignItems: 'start' }}>
          {polls.map((p) => (
            <PollCard key={p.id} poll={p} canManage={helpers?.can('manageSettings') ?? false} planTitle={p.planId ? planTitles.get(p.planId) : null} />
          ))}
        </Box>
      )}

      <PlanFormDialog
        open={planDialog}
        onClose={() => setPlanDialog(false)}
        groupId={groupId}
        onSaved={(planId) => navigate(`/groups/${groupId}/plans/${planId}`)}
      />
      {helpers && (
        <CreatePollDialog
          open={pollDialog}
          onClose={() => setPollDialog(false)}
          groupId={groupId}
          members={helpers.activeMembers}
          plans={(plansQuery.data?.plans ?? []).map((p) => ({ id: p.id, title: p.title }))}
        />
      )}
    </PageTransition>
  );
}
