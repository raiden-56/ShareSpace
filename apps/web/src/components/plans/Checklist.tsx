import { useState, type FormEvent } from 'react';
import { Box, Button, Card, Checkbox, IconButton, MenuItem, Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import { ListTodo, Plus, Trash2, TriangleAlert } from 'lucide-react';
import {
  toApiError,
  useAddChecklistItemMutation,
  useDeleteChecklistItemMutation,
  useReorderChecklistMutation,
  useUpdateChecklistItemMutation,
} from '../../api/api';
import type { ChecklistItem } from '../../api/types';
import { useFormat } from '../../hooks/useAuth';
import { todayLocal } from '../../lib/format';
import { useAppDispatch } from '../../store';
import { showToast } from '../../store/ui';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { EmptyState } from '../common/States';
import { SortableList } from './SortableList';

export type ChecklistFilter = 'all' | 'open' | 'done';

export interface ChecklistViewProps {
  items: ChecklistItem[];
  /** Assignable members (active group members). */
  members: { id: string; displayName: string }[];
  memberName: (memberId: string) => string;
  /** Resolves completedById (a user id) to a name. */
  userName: (userId: string) => string;
  canEdit: boolean;
  /** Override "today" (YYYY-MM-DD) for overdue checks. */
  today?: string;
  busyIds?: string[];
  onToggle: (item: ChecklistItem, completed: boolean) => void;
  onAdd: (body: { title: string; assigneeMemberId: string | null; dueDate: string | null }) => Promise<boolean>;
  onDelete: (item: ChecklistItem) => void;
  onReorder: (ids: string[]) => void;
}

export function isOverdue(item: ChecklistItem, today: string): boolean {
  return !item.completedAt && !!item.dueDate && item.dueDate < today;
}

/** Presentational shared checklist: filter, add, toggle, delete and reorder tasks. */
export function ChecklistView({ items, members, memberName, userName, canEdit, today = todayLocal(), busyIds = [], onToggle, onAdd, onDelete, onReorder }: ChecklistViewProps) {
  const fmt = useFormat();
  const [filter, setFilter] = useState<ChecklistFilter>('all');
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState('');
  const [due, setDue] = useState('');
  const [titleError, setTitleError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const done = items.filter((i) => i.completedAt);
  const open = items.filter((i) => !i.completedAt);
  const visible = filter === 'all' ? items : filter === 'open' ? open : done;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t) {
      setTitleError('Enter a task');
      return;
    }
    if (t.length > 160) {
      setTitleError('Tasks must be at most 160 characters');
      return;
    }
    setTitleError(null);
    setAdding(true);
    const ok = await onAdd({ title: t, assigneeMemberId: assignee || null, dueDate: due || null });
    setAdding(false);
    if (ok) {
      setTitle('');
      setAssignee('');
      setDue('');
    }
  };

  const row = (item: ChecklistItem, handle: React.ReactNode) => {
    const overdue = isOverdue(item, today);
    const completed = !!item.completedAt;
    return (
      <Card sx={{ display: 'flex', alignItems: 'center', gap: 0.5, p: 0.75, pl: handle ? 0.5 : 1 }}>
        {handle}
        <Checkbox
          checked={completed}
          disabled={!canEdit || busyIds.includes(item.id)}
          onChange={(e) => onToggle(item, e.target.checked)}
          slotProps={{ input: { 'aria-label': completed ? `Mark "${item.title}" as not done` : `Mark "${item.title}" as done` } }}
        />
        <Box sx={{ flex: 1, minWidth: 0, py: 0.5 }}>
          <Typography variant="body1" sx={{ fontWeight: 550, overflowWrap: 'anywhere', textDecoration: completed ? 'line-through' : 'none', color: completed ? 'text.secondary' : 'text.primary' }}>
            {item.title}
          </Typography>
          <Stack direction="row" spacing={1.25} sx={{ flexWrap: 'wrap', rowGap: 0.25, color: 'text.secondary' }}>
            {item.assigneeMemberId && <Typography variant="caption">{memberName(item.assigneeMemberId)}</Typography>}
            {item.dueDate && !completed && (
              <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: overdue ? 'money.attention' : 'text.secondary' }}>
                {overdue && <TriangleAlert size={13} aria-hidden />}
                <Typography variant="caption" sx={{ color: 'inherit', fontWeight: overdue ? 650 : 400 }}>
                  {overdue ? `Overdue · was due ${fmt.date(item.dueDate)}` : `Due ${fmt.date(item.dueDate)}`}
                </Typography>
              </Stack>
            )}
            {completed && item.completedAt && (
              <Typography variant="caption">
                Completed by {item.completedById ? userName(item.completedById) : 'someone'} · {fmt.date(item.completedAt)}
              </Typography>
            )}
          </Stack>
        </Box>
        {canEdit && (
          <Tooltip title="Delete task">
            <IconButton aria-label={`Delete "${item.title}"`} onClick={() => onDelete(item)}>
              <Trash2 size={17} />
            </IconButton>
          </Tooltip>
        )}
      </Card>
    );
  };

  return (
    <Box>
      {canEdit && (
        <Box component="form" onSubmit={submit} noValidate aria-label="Add a task" sx={{ display: 'grid', gap: 1.25, gridTemplateColumns: { xs: '1fr', sm: '2fr 1fr 1fr auto' }, mb: 2.5, alignItems: 'start' }}>
          <TextField label="New task" value={title} onChange={(e) => setTitle(e.target.value)} error={!!titleError} helperText={titleError ?? undefined} placeholder="e.g. Book hotel" />
          <TextField select label="Assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <MenuItem value="">Unassigned</MenuItem>
            {members.map((m) => (
              <MenuItem key={m.id} value={m.id}>
                {m.displayName}
              </MenuItem>
            ))}
          </TextField>
          <TextField type="date" label="Due date" value={due} onChange={(e) => setDue(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          <Button type="submit" variant="contained" startIcon={<Plus size={17} />} disabled={adding} sx={{ height: 40 }}>
            Add
          </Button>
        </Box>
      )}

      {items.length === 0 ? (
        <EmptyState compact icon={<ListTodo size={22} />} title="No tasks yet" description="Add things to sort out before the plan, like booking the hotel or confirming the restaurant." />
      ) : (
        <>
          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ mb: 1.5, flexWrap: 'wrap', rowGap: 1 }}>
            <ToggleButtonGroup size="small" exclusive value={filter} onChange={(_e, v: ChecklistFilter | null) => v && setFilter(v)} aria-label="Filter tasks">
              <ToggleButton value="all" sx={{ px: 1.5 }}>
                All ({items.length})
              </ToggleButton>
              <ToggleButton value="open" sx={{ px: 1.5 }}>
                Open ({open.length})
              </ToggleButton>
              <ToggleButton value="done" sx={{ px: 1.5 }}>
                Done ({done.length})
              </ToggleButton>
            </ToggleButtonGroup>
            <Typography variant="caption" className="tabular">
              {done.length} of {items.length} done
            </Typography>
          </Stack>
          {visible.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
              {filter === 'open' ? 'Everything is done.' : 'No completed tasks yet.'}
            </Typography>
          ) : filter === 'all' && canEdit ? (
            <SortableList items={visible} itemNoun="task" getLabel={(i) => i.title} onReorder={onReorder} renderItem={row} />
          ) : (
            <Stack spacing={1} component="ul" sx={{ listStyle: 'none', p: 0, m: 0 }}>
              {visible.map((item) => (
                <li key={item.id}>{row(item, null)}</li>
              ))}
            </Stack>
          )}
          {canEdit && filter !== 'all' && (
            <Typography variant="caption" component="p" sx={{ mt: 1.5 }}>
              Switch to “All” to reorder tasks.
            </Typography>
          )}
        </>
      )}
    </Box>
  );
}

interface ChecklistProps {
  groupId: string;
  planId: string;
  items: ChecklistItem[];
  members: { id: string; displayName: string }[];
  memberName: (memberId: string) => string;
  userName: (userId: string) => string;
  canEdit: boolean;
}

/** Checklist wired to the API. Completion history is recorded in the plan's activity. */
export function Checklist({ groupId, planId, ...rest }: ChecklistProps) {
  const dispatch = useAppDispatch();
  const [add] = useAddChecklistItemMutation();
  const [update] = useUpdateChecklistItemMutation();
  const [remove, removeState] = useDeleteChecklistItemMutation();
  const [reorder] = useReorderChecklistMutation();
  const [busyIds, setBusyIds] = useState<string[]>([]);
  const [toDelete, setToDelete] = useState<ChecklistItem | null>(null);
  const fail = (err: unknown) => dispatch(showToast({ message: toApiError(err).message, severity: 'error' }));

  return (
    <>
      <ChecklistView
        {...rest}
        busyIds={busyIds}
        onToggle={(item, completed) => {
          setBusyIds((ids) => [...ids, item.id]);
          update({ groupId, planId, itemId: item.id, body: { completed } })
            .unwrap()
            .catch(fail)
            .finally(() => setBusyIds((ids) => ids.filter((x) => x !== item.id)));
        }}
        onAdd={async (body) => {
          try {
            await add({ groupId, planId, body }).unwrap();
            return true;
          } catch (err) {
            fail(err);
            return false;
          }
        }}
        onDelete={setToDelete}
        onReorder={(ids) => reorder({ groupId, planId, ids }).unwrap().catch(fail)}
      />
      <ConfirmDialog
        open={!!toDelete}
        title="Delete task?"
        description={toDelete ? `"${toDelete.title}" will be removed from the checklist.` : ''}
        confirmLabel="Delete"
        destructive
        busy={removeState.isLoading}
        onClose={() => setToDelete(null)}
        onConfirm={() => {
          if (!toDelete) return;
          remove({ groupId, planId, itemId: toDelete.id })
            .unwrap()
            .then(() => dispatch(showToast({ message: 'Task deleted' })))
            .catch(fail)
            .finally(() => setToDelete(null));
        }}
      />
    </>
  );
}
