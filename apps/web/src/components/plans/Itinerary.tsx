import { useMemo, useState } from 'react';
import { Box, Button, Card, IconButton, Stack, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import { CalendarDays, Clock, ListOrdered, MapPin, Pencil, Plus, Route, Trash2 } from 'lucide-react';
import { formatMoney } from '@sharespace/core';
import { toApiError, useDeleteItineraryItemMutation, useReorderItineraryMutation } from '../../api/api';
import type { ItineraryItem } from '../../api/types';
import { useFormat } from '../../hooks/useAuth';
import { useAppDispatch } from '../../store';
import { showToast } from '../../store/ui';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { EmptyState } from '../common/States';
import { ItineraryItemDialog } from './ItineraryItemDialog';
import { SortableList } from './SortableList';

function timeRange(item: ItineraryItem): string | null {
  if (item.startTime && item.endTime) return `${item.startTime}–${item.endTime}`;
  return item.startTime ?? item.endTime ?? null;
}

function ItemBody({ item, currency, showDate }: { item: ItineraryItem; currency: string; showDate: boolean }) {
  const fmt = useFormat();
  const time = timeRange(item);
  return (
    <Box sx={{ flex: 1, minWidth: 0, py: 0.5 }}>
      <Typography variant="subtitle1" sx={{ overflowWrap: 'anywhere' }}>
        {item.title}
      </Typography>
      <Stack direction="row" spacing={1.5} sx={{ color: 'text.secondary', flexWrap: 'wrap', rowGap: 0.25 }}>
        {showDate && item.date && (
          <Stack direction="row" spacing={0.5} alignItems="center">
            <CalendarDays size={13} aria-hidden />
            <Typography variant="caption">{fmt.date(item.date)}</Typography>
          </Stack>
        )}
        {time && (
          <Stack direction="row" spacing={0.5} alignItems="center">
            <Clock size={13} aria-hidden />
            <Typography variant="caption" className="tabular">
              {time}
            </Typography>
          </Stack>
        )}
        {item.location && (
          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 0 }}>
            <MapPin size={13} aria-hidden />
            <Typography variant="caption" sx={{ overflowWrap: 'anywhere' }}>
              {item.location}
            </Typography>
          </Stack>
        )}
        {item.estimatedCostMinor ? (
          <Typography variant="caption" className="tabular">
            Est. {formatMoney(item.estimatedCostMinor, currency)}
          </Typography>
        ) : null}
      </Stack>
      {item.description && (
        <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: 'pre-wrap' }}>
          {item.description}
        </Typography>
      )}
      {item.notes && (
        <Typography variant="caption" component="p" sx={{ mt: 0.25, whiteSpace: 'pre-wrap' }}>
          Note: {item.notes}
        </Typography>
      )}
    </Box>
  );
}

interface ItineraryProps {
  groupId: string;
  planId: string;
  items: ItineraryItem[];
  currency: string;
  canEdit: boolean;
  planStartDate: string;
}

/** Ordered itinerary with drag-and-drop reordering, plus an agenda view grouped by date. */
export function Itinerary({ groupId, planId, items, currency, canEdit, planStartDate }: ItineraryProps) {
  const fmt = useFormat();
  const dispatch = useAppDispatch();
  const [view, setView] = useState<'order' | 'agenda'>('order');
  const [editing, setEditing] = useState<ItineraryItem | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toDelete, setToDelete] = useState<ItineraryItem | null>(null);
  const [reorder] = useReorderItineraryMutation();
  const [remove, removeState] = useDeleteItineraryItemMutation();

  const agenda = useMemo(() => {
    const groups = new Map<string, ItineraryItem[]>();
    const sorted = [...items].sort((a, b) => {
      if (a.date !== b.date) return a.date === null ? 1 : b.date === null ? -1 : a.date.localeCompare(b.date);
      const ta = a.startTime ?? '99:99';
      const tb = b.startTime ?? '99:99';
      return ta.localeCompare(tb) || a.position - b.position;
    });
    for (const item of sorted) {
      const key = item.date ?? '';
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    return [...groups.entries()];
  }, [items]);

  const openAdd = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const actions = (item: ItineraryItem) =>
    canEdit && (
      <Stack direction="row" sx={{ flexShrink: 0 }}>
        <Tooltip title="Edit">
          <IconButton
            aria-label={`Edit "${item.title}"`}
            onClick={() => {
              setEditing(item);
              setDialogOpen(true);
            }}
          >
            <Pencil size={17} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Delete">
          <IconButton aria-label={`Delete "${item.title}"`} onClick={() => setToDelete(item)}>
            <Trash2 size={17} />
          </IconButton>
        </Tooltip>
      </Stack>
    );

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{ mb: 2, flexWrap: 'wrap', rowGap: 1 }}>
        <ToggleButtonGroup size="small" exclusive value={view} onChange={(_e, v: 'order' | 'agenda' | null) => v && setView(v)} aria-label="Itinerary view">
          <ToggleButton value="order" aria-label="Ordered list" sx={{ px: 1.5, gap: 0.75 }}>
            <ListOrdered size={16} /> Order
          </ToggleButton>
          <ToggleButton value="agenda" aria-label="Agenda by date" sx={{ px: 1.5, gap: 0.75 }}>
            <CalendarDays size={16} /> Agenda
          </ToggleButton>
        </ToggleButtonGroup>
        {canEdit && (
          <Button variant="outlined" startIcon={<Plus size={17} />} onClick={openAdd}>
            Add item
          </Button>
        )}
      </Stack>

      {items.length === 0 ? (
        <EmptyState
          compact
          icon={<Route size={22} />}
          title="No itinerary yet"
          description="Add the stops, bookings and activities for this plan, in order."
          action={canEdit && <Button variant="contained" startIcon={<Plus size={17} />} onClick={openAdd}>Add first item</Button>}
        />
      ) : view === 'order' ? (
        <>
          {canEdit && (
            <Typography variant="caption" component="p" sx={{ mb: 1.5 }}>
              Drag the handle (or focus it and use the arrow keys, then Space) to reorder.
            </Typography>
          )}
          <SortableList
            items={items}
            itemNoun="itinerary item"
            getLabel={(i) => i.title}
            disabled={!canEdit}
            onReorder={(ids) =>
              reorder({ groupId, planId, ids })
                .unwrap()
                .catch((err) => dispatch(showToast({ message: toApiError(err).message, severity: 'error' })))
            }
            renderItem={(item, handle) => (
              <Card sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, p: 1, pl: handle ? 0.5 : 1.75 }}>
                {handle}
                <Box
                  aria-hidden
                  sx={{ mt: 1, width: 24, height: 24, borderRadius: '50%', bgcolor: 'surface.sage', color: 'primary.main', display: 'grid', placeItems: 'center', fontSize: '0.75rem', fontWeight: 700, flexShrink: 0 }}
                >
                  {items.indexOf(item) + 1}
                </Box>
                <ItemBody item={item} currency={currency} showDate />
                {actions(item)}
              </Card>
            )}
          />
        </>
      ) : (
        <Stack spacing={2.5}>
          {agenda.map(([date, dayItems]) => (
            <Box key={date || 'undated'} component="section" aria-label={date ? fmt.date(date) : 'No date'}>
              <Typography variant="overline" component="h4" sx={{ mb: 1 }}>
                {date ? fmt.date(date) : 'No date'}
              </Typography>
              <Stack spacing={1} sx={{ borderLeft: 2, borderColor: 'divider', pl: 2 }}>
                {dayItems.map((item) => (
                  <Stack key={item.id} direction="row" spacing={1} alignItems="flex-start">
                    <ItemBody item={item} currency={currency} showDate={false} />
                    {actions(item)}
                  </Stack>
                ))}
              </Stack>
            </Box>
          ))}
        </Stack>
      )}

      <ItineraryItemDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        groupId={groupId}
        planId={planId}
        currency={currency}
        item={editing}
        defaultDate={planStartDate}
      />
      <ConfirmDialog
        open={!!toDelete}
        title="Delete itinerary item?"
        description={toDelete ? `"${toDelete.title}" will be removed from the itinerary.` : ''}
        confirmLabel="Delete"
        destructive
        busy={removeState.isLoading}
        onClose={() => setToDelete(null)}
        onConfirm={() => {
          if (!toDelete) return;
          remove({ groupId, planId, itemId: toDelete.id })
            .unwrap()
            .then(() => dispatch(showToast({ message: 'Itinerary item deleted' })))
            .catch((err) => dispatch(showToast({ message: toApiError(err).message, severity: 'error' })))
            .finally(() => setToDelete(null));
        }}
      />
    </Box>
  );
}
