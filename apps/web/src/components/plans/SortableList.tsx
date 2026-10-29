import type { ReactNode } from 'react';
import { Box, IconButton, Stack } from '@mui/material';
import { GripVertical } from 'lucide-react';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useReducedMotionPref } from '../../hooks/useMotion';

interface SortableListProps<T extends { id: string }> {
  items: T[];
  /** Called with the full new order of ids after a drop that changed the order. */
  onReorder: (ids: string[]) => void;
  disabled?: boolean;
  /** Accessible noun used in handle labels, e.g. "itinerary item". */
  itemNoun: string;
  getLabel: (item: T) => string;
  renderItem: (item: T, handle: ReactNode) => ReactNode;
}

/**
 * Vertical drag-and-drop list (pointer, touch and keyboard). Each row gets a visible drag handle;
 * while dragging, the row's slot shows a dashed outline so the drop position is always visible.
 */
export function SortableList<T extends { id: string }>({ items, onReorder, disabled, itemNoun, getLabel, renderItem }: SortableListProps<T>) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = items.map((i) => i.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(ids, from, to));
  };

  const labelFor = (id: string | number) => {
    const item = items.find((i) => i.id === String(id));
    return item ? `"${getLabel(item)}"` : itemNoun;
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      accessibility={{
        announcements: {
          onDragStart: ({ active }) => `Picked up ${labelFor(active.id)}.`,
          onDragOver: ({ active, over }) =>
            over ? `${labelFor(active.id)} is over position ${items.findIndex((i) => i.id === String(over.id)) + 1} of ${items.length}.` : `${labelFor(active.id)} is no longer over a position.`,
          onDragEnd: ({ active, over }) =>
            over ? `${labelFor(active.id)} was dropped at position ${items.findIndex((i) => i.id === String(over.id)) + 1} of ${items.length}.` : `${labelFor(active.id)} was dropped.`,
          onDragCancel: ({ active }) => `Moving ${labelFor(active.id)} was cancelled.`,
        },
      }}
    >
      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <Stack spacing={1} component="ol" sx={{ listStyle: 'none', p: 0, m: 0 }}>
          {items.map((item, index) => (
            <SortableRow key={item.id} id={item.id} disabled={disabled} label={`Reorder ${itemNoun} "${getLabel(item)}" (position ${index + 1} of ${items.length})`}>
              {(handle) => renderItem(item, handle)}
            </SortableRow>
          ))}
        </Stack>
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({ id, disabled, label, children }: { id: string; disabled?: boolean; label: string; children: (handle: ReactNode) => ReactNode }) {
  const reduce = useReducedMotionPref();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
    transition: reduce ? null : undefined,
  });

  const handle = disabled ? null : (
    <IconButton
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-label={label}
      size="small"
      sx={{ cursor: isDragging ? 'grabbing' : 'grab', touchAction: 'none', color: 'text.secondary', width: 40, height: 40, flexShrink: 0 }}
    >
      <GripVertical size={18} />
    </IconButton>
  );

  return (
    <Box
      component="li"
      ref={setNodeRef}
      sx={{
        position: 'relative',
        transform: CSS.Transform.toString(transform),
        transition: transition ?? undefined,
        zIndex: isDragging ? 2 : 'auto',
        borderRadius: 3,
        outline: isDragging ? '2px dashed' : 'none',
        outlineColor: 'primary.main',
        outlineOffset: 2,
        bgcolor: isDragging ? 'surface.sage' : 'transparent',
        boxShadow: isDragging ? '0 8px 24px rgba(41,45,41,0.16)' : 'none',
      }}
    >
      {children(handle)}
    </Box>
  );
}
