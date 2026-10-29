import { useState } from 'react';
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Box, Button, Card, Divider, IconButton, Skeleton, Stack, Tab, Tabs, Tooltip, Typography } from '@mui/material';
import { ArrowLeft, CalendarDays, History, MapPin, Pencil, Plus, Receipt, Trash2, Vote, Wallet } from 'lucide-react';
import { PLAN_TYPE_LABELS } from '@sharespace/core';
import { toApiError, useDeletePlanMutation, usePlanQuery } from '../../api/api';
import type { PlanDetail as PlanDetailType } from '../../api/types';
import { useFormat } from '../../hooks/useAuth';
import { useGroupContext, type GroupHelpers } from '../../hooks/useGroupContext';
import { timeAgo, pluralize } from '../../lib/format';
import { useAppDispatch } from '../../store';
import { openExpenseDialog, showToast } from '../../store/ui';
import { ConfirmDialog } from '../../components/common/ConfirmDialog';
import { BudgetMeter, BudgetStateChip, PlanStatusChip } from '../../components/common/Indicators';
import { PageTransition, SectionCard } from '../../components/common/Layout';
import { MemberAvatar } from '../../components/common/MemberAvatar';
import { Money } from '../../components/common/Money';
import { ActivityFeedSkeleton } from '../../components/common/Skeletons';
import { EmptyState, ErrorState } from '../../components/common/States';
import { ExpenseRow } from '../../components/expenses/ExpenseRow';
import { Checklist } from '../../components/plans/Checklist';
import { CreatePollDialog } from '../../components/plans/CreatePollDialog';
import { Itinerary } from '../../components/plans/Itinerary';
import { PlanFormDialog } from '../../components/plans/PlanFormDialog';
import { PollCard } from '../../components/plans/PollCard';
import { formatDateRange, planBudgetStatus } from '../../components/plans/planUtils';

const SECTIONS = [
  { value: 'overview', label: 'Overview' },
  { value: 'budget', label: 'Budget' },
  { value: 'itinerary', label: 'Itinerary' },
  { value: 'checklist', label: 'Checklist' },
  { value: 'expenses', label: 'Expenses' },
  { value: 'decisions', label: 'Decisions' },
  { value: 'activity', label: 'Activity' },
] as const;
type Section = (typeof SECTIONS)[number]['value'];

function DetailSkeleton() {
  return (
    <Box aria-busy aria-label="Loading plan">
      <Card sx={{ p: 2.5, mb: 2.5 }}>
        <Skeleton width={90} height={24} />
        <Skeleton width="50%" height={34} />
        <Skeleton width="35%" height={18} />
      </Card>
      <Card sx={{ p: 2.5 }}>
        <ActivityFeedSkeleton rows={4} />
      </Card>
    </Box>
  );
}

function BudgetPanel({ plan, currency, canEdit, onAddExpense, onEdit }: { plan: PlanDetailType; currency: string; canEdit: boolean; onAddExpense: () => void; onEdit: () => void }) {
  const status = planBudgetStatus(plan);
  return (
    <SectionCard title="Budget" subtitle="Estimated budget compared with expenses linked to this plan">
      <Stack spacing={2.5}>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' } }}>
          <Box>
            <Typography variant="overline" component="p">
              Estimated
            </Typography>
            {plan.estimatedBudgetMinor ? <Money minor={plan.estimatedBudgetMinor} currency={currency} variant="h3" /> : <Typography variant="body2" color="text.secondary">Not set</Typography>}
          </Box>
          <Box>
            <Typography variant="overline" component="p">
              Actual spending
            </Typography>
            <Money minor={plan.actualSpendingMinor} currency={currency} variant="h3" />
            <Typography variant="caption" component="p">
              {pluralize(plan.expenseCount, 'expense')}
            </Typography>
          </Box>
          {status && (
            <Box>
              <Typography variant="overline" component="p">
                {status.remainingMinor >= 0 ? 'Remaining' : 'Over by'}
              </Typography>
              <Money minor={Math.abs(status.remainingMinor)} currency={currency} variant="h3" sx={{ color: status.remainingMinor < 0 ? 'error.main' : 'text.primary' }} />
            </Box>
          )}
        </Box>
        {status ? (
          <Stack spacing={1.25}>
            <BudgetMeter spentMinor={status.spentMinor} totalMinor={status.budgetMinor} usedBps={status.usedBps} state={status.state} currency={currency} />
            <Box>
              <BudgetStateChip state={status.state} />
            </Box>
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">
            Add an estimated budget to track this plan against it.{' '}
            {canEdit && (
              <Button size="small" onClick={onEdit} sx={{ verticalAlign: 'baseline' }}>
                Set estimate
              </Button>
            )}
          </Typography>
        )}
        {canEdit && (
          <Box>
            <Button variant="contained" startIcon={<Plus size={17} />} onClick={onAddExpense}>
              Add expense to this plan
            </Button>
          </Box>
        )}
      </Stack>
    </SectionCard>
  );
}

function OverviewPanel({ plan, helpers, currency }: { plan: PlanDetailType; helpers: GroupHelpers; currency: string }) {
  const participants = plan.participantIds.map((id) => helpers.memberById.get(id)).filter((m): m is NonNullable<typeof m> => !!m);
  return (
    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '3fr 2fr' }, alignItems: 'start' }}>
      <SectionCard title="About this plan">
        <Stack spacing={2}>
          {plan.description ? (
            <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {plan.description}
            </Typography>
          ) : (
            <Typography variant="body2" color="text.secondary">
              No description yet.
            </Typography>
          )}
          {plan.notes && (
            <Box>
              <Typography variant="overline" component="p">
                Notes
              </Typography>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {plan.notes}
              </Typography>
            </Box>
          )}
          <Divider />
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
            <Box>
              <Typography variant="overline" component="p">
                Tasks
              </Typography>
              <Typography variant="h3" component="p" className="tabular">
                {plan.checklistDone}/{plan.checklistTotal}
              </Typography>
            </Box>
            <Box>
              <Typography variant="overline" component="p">
                Itinerary
              </Typography>
              <Typography variant="h3" component="p" className="tabular">
                {plan.itinerary.length}
              </Typography>
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="overline" component="p">
                Spent
              </Typography>
              <Money minor={plan.actualSpendingMinor} currency={currency} variant="h3" />
            </Box>
          </Box>
        </Stack>
      </SectionCard>
      <SectionCard title="Participants" subtitle={pluralize(participants.length, 'person', 'people')}>
        {participants.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No participants selected.
          </Typography>
        ) : (
          <Stack spacing={1.25} component="ul" sx={{ listStyle: 'none', p: 0, m: 0 }}>
            {participants.map((m) => (
              <Stack key={m.id} component="li" direction="row" spacing={1.25} alignItems="center">
                <MemberAvatar name={m.displayName} color={m.avatarColor} placeholder={!m.hasAccount} size={32} />
                <Typography variant="body2" noWrap sx={{ fontWeight: 550 }}>
                  {m.displayName}
                  {m.isYou ? ' (you)' : ''}
                  {m.status !== 'ACTIVE' ? ' · left the group' : ''}
                </Typography>
              </Stack>
            ))}
          </Stack>
        )}
      </SectionCard>
    </Box>
  );
}

export default function PlanDetail() {
  const { planId = '' } = useParams();
  const { groupId, helpers } = useGroupContext();
  const fmt = useFormat();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const [params, setParams] = useSearchParams();
  const section: Section = (SECTIONS.find((s) => s.value === params.get('section'))?.value ?? 'overview') as Section;
  const { data, isLoading, error, refetch } = usePlanQuery({ groupId, planId }, { skip: !groupId || !planId });
  const [deletePlan, deleteState] = useDeletePlanMutation();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);

  if (error) return <ErrorState error={error} onRetry={refetch} title="Could not load this plan" />;
  if (isLoading || !data || !helpers) return <DetailSkeleton />;

  const plan = data.plan;
  const currency = helpers.data.group.currency;
  const canEdit = helpers.can('editRecords');
  const addExpense = () => dispatch(openExpenseDialog({ groupId, planId: plan.id }));

  const body = (() => {
    switch (section) {
      case 'budget':
        return <BudgetPanel plan={plan} currency={currency} canEdit={canEdit} onAddExpense={addExpense} onEdit={() => setEditOpen(true)} />;
      case 'itinerary':
        return (
          <SectionCard title="Itinerary" subtitle="Times and places are entered by the group; no routes or travel times are calculated.">
            <Itinerary groupId={groupId} planId={plan.id} items={plan.itinerary} currency={currency} canEdit={canEdit} planStartDate={plan.startDate} />
          </SectionCard>
        );
      case 'checklist':
        return (
          <SectionCard title="Shared checklist">
            <Checklist
              groupId={groupId}
              planId={plan.id}
              items={plan.checklist}
              members={helpers.activeMembers}
              memberName={helpers.memberName}
              userName={helpers.userName}
              canEdit={canEdit}
            />
          </SectionCard>
        );
      case 'expenses':
        return (
          <SectionCard
            title="Expenses"
            subtitle={`${pluralize(plan.expenseCount, 'expense')} · ${fmt.money(plan.actualSpendingMinor, currency)}`}
            action={
              canEdit && (
                <Button size="small" startIcon={<Plus size={16} />} onClick={addExpense}>
                  Add
                </Button>
              )
            }
          >
            {plan.expenses.length === 0 ? (
              <EmptyState
                compact
                icon={<Receipt size={22} />}
                title="No expenses linked"
                description="Link expenses to this plan to compare spending with the estimate. Each expense is counted once."
                action={canEdit && <Button variant="contained" onClick={addExpense}>Add expense</Button>}
              />
            ) : (
              <Stack divider={<Box sx={{ borderTop: 1, borderColor: 'divider' }} />}>
                {plan.expenses.map((e) => (
                  <ExpenseRow key={e.id} expense={e} myMemberId={helpers.me} memberName={helpers.memberName} categoryName={helpers.categoryName} />
                ))}
              </Stack>
            )}
          </SectionCard>
        );
      case 'decisions':
        return (
          <Stack spacing={2}>
            {canEdit && (
              <Box>
                <Button variant="outlined" startIcon={<Vote size={17} />} onClick={() => setPollOpen(true)}>
                  New poll for this plan
                </Button>
              </Box>
            )}
            {plan.polls.length === 0 ? (
              <Card>
                <EmptyState compact icon={<Vote size={22} />} title="No decisions yet" description="Start a poll to decide on dates, places or budget for this plan." />
              </Card>
            ) : (
              <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, alignItems: 'start' }}>
                {plan.polls.map((p) => (
                  <PollCard key={p.id} poll={p} canManage={helpers.can('manageSettings')} />
                ))}
              </Box>
            )}
          </Stack>
        );
      case 'activity':
        return (
          <SectionCard title="Activity" subtitle="Changes to this plan, including checklist completion history">
            {plan.activity.length === 0 ? (
              <EmptyState compact icon={<History size={22} />} title="No activity yet" />
            ) : (
              <Stack spacing={2} component="ol" sx={{ listStyle: 'none', p: 0, m: 0 }}>
                {plan.activity.map((a) => (
                  <Stack key={a.id} component="li" direction="row" spacing={1.5} alignItems="flex-start">
                    <MemberAvatar name={a.actorName} size={28} />
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                        {a.summary}
                      </Typography>
                      <Typography variant="caption" component="time" dateTime={a.createdAt} title={fmt.dateTime(a.createdAt)}>
                        {timeAgo(a.createdAt)}
                      </Typography>
                    </Box>
                  </Stack>
                ))}
              </Stack>
            )}
          </SectionCard>
        );
      default:
        return <OverviewPanel plan={plan} helpers={helpers} currency={currency} />;
    }
  })();

  return (
    <PageTransition>
      <Button component={RouterLink} to={`/groups/${groupId}/plans`} startIcon={<ArrowLeft size={17} />} color="inherit" sx={{ mb: 1.5, ml: -1 }}>
        All plans
      </Button>
      <Card sx={{ p: { xs: 2, md: 2.5 }, mb: 2.5 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ sm: 'flex-start' }}>
          <Box sx={{ minWidth: 0 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.75 }}>
              <PlanStatusChip status={plan.status} />
              <Typography variant="caption">{PLAN_TYPE_LABELS[plan.type]}</Typography>
            </Stack>
            <Typography variant="h1" component="h2" sx={{ overflowWrap: 'anywhere' }}>
              {plan.title}
            </Typography>
            <Stack direction="row" spacing={2} sx={{ mt: 1, color: 'text.secondary', flexWrap: 'wrap', rowGap: 0.5 }}>
              <Stack direction="row" spacing={0.75} alignItems="center">
                <CalendarDays size={16} aria-hidden />
                <Typography variant="body2" color="text.secondary">
                  {formatDateRange(fmt.date, plan.startDate, plan.endDate)}
                </Typography>
              </Stack>
              {plan.location && (
                <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
                  <MapPin size={16} aria-hidden />
                  <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                    {plan.location}
                  </Typography>
                </Stack>
              )}
              <Stack direction="row" spacing={0.75} alignItems="center">
                <Wallet size={16} aria-hidden />
                <Typography variant="body2" color="text.secondary" className="tabular">
                  {fmt.money(plan.actualSpendingMinor, currency)} spent
                  {plan.estimatedBudgetMinor ? ` of ${fmt.money(plan.estimatedBudgetMinor, currency)} estimated` : ''}
                </Typography>
              </Stack>
            </Stack>
          </Box>
          {canEdit && (
            <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
              <Button variant="outlined" startIcon={<Pencil size={16} />} onClick={() => setEditOpen(true)}>
                Edit
              </Button>
              <Tooltip title="Delete plan">
                <IconButton aria-label="Delete plan" onClick={() => setConfirmDelete(true)} sx={{ border: 1, borderColor: 'divider' }}>
                  <Trash2 size={18} />
                </IconButton>
              </Tooltip>
            </Stack>
          )}
        </Stack>
      </Card>

      <Tabs
        value={section}
        onChange={(_e, v: Section) => setParams(v === 'overview' ? {} : { section: v }, { replace: true })}
        variant="scrollable"
        scrollButtons={false}
        aria-label="Plan sections"
        sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
      >
        {SECTIONS.map((s) => (
          <Tab key={s.value} value={s.value} label={s.label} sx={{ px: 1.5, minWidth: 0 }} />
        ))}
      </Tabs>

      <Box role="tabpanel" aria-label={SECTIONS.find((s) => s.value === section)?.label}>
        {body}
      </Box>

      <PlanFormDialog open={editOpen} onClose={() => setEditOpen(false)} groupId={groupId} plan={plan} />
      <CreatePollDialog open={pollOpen} onClose={() => setPollOpen(false)} groupId={groupId} members={helpers.activeMembers} presetPlanId={plan.id} />
      <ConfirmDialog
        open={confirmDelete}
        title="Delete this plan?"
        description="The plan, its itinerary and checklist will be removed. Expenses linked to it stay in the group and keep counting towards balances."
        confirmLabel="Delete plan"
        destructive
        busy={deleteState.isLoading}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() =>
          deletePlan({ groupId, planId: plan.id })
            .unwrap()
            .then(() => {
              setConfirmDelete(false);
              dispatch(showToast({ message: 'Plan deleted' }));
              navigate(`/groups/${groupId}/plans`, { replace: true });
            })
            .catch((err) => {
              setConfirmDelete(false);
              dispatch(showToast({ message: toApiError(err).message, severity: 'error' }));
            })
        }
      />
    </PageTransition>
  );
}
