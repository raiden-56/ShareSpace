import { Box, ButtonBase, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import {
  Bell,
  BellRing,
  CalendarClock,
  HandCoins,
  MailOpen,
  Mail,
  MessageSquare,
  Receipt,
  TriangleAlert,
  UserPlus,
  Vote,
  type LucideIcon,
} from 'lucide-react';
import type { Notification } from '../../api/types';
import { timeAgo } from '../../lib/format';

const TYPE_ICONS: Record<string, LucideIcon> = {
  INVITATION: UserPlus,
  MEMBER_JOINED: UserPlus,
  EXPENSE_CREATED: Receipt,
  EXPENSE_UPDATED: Receipt,
  EXPENSE_DELETED: Receipt,
  COMMENT: MessageSquare,
  SETTLEMENT: HandCoins,
  PAYMENT_REMINDER: BellRing,
  BUDGET_WARNING: TriangleAlert,
  PLAN_UPCOMING: CalendarClock,
  POLL_DEADLINE: Vote,
  POLL_CLOSED: Vote,
};

interface NotificationItemProps {
  notification: Notification;
  /** Open the notification: callers mark it read and navigate to its link. */
  onOpen: (n: Notification) => void;
  onToggleRead: (n: Notification) => void;
}

/** One in-app notification. Unread state is conveyed by a dot, bold title and screen-reader text. */
export function NotificationItem({ notification: n, onOpen, onToggleRead }: NotificationItemProps) {
  const Icon = TYPE_ICONS[n.type] ?? Bell;
  const unread = !n.readAt;
  return (
    <Stack
      component="li"
      direction="row"
      spacing={0.5}
      alignItems="center"
      sx={{ listStyle: 'none', borderRadius: 3, bgcolor: unread ? 'surface.sage' : 'transparent', pr: 0.5 }}
    >
      <ButtonBase
        onClick={() => onOpen(n)}
        sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'flex-start', gap: 1.5, textAlign: 'left', p: 1.5, borderRadius: 3 }}
      >
        <Box
          aria-hidden
          sx={{ width: 36, height: 36, flexShrink: 0, borderRadius: '10px', display: 'grid', placeItems: 'center', bgcolor: 'background.paper', color: n.type === 'BUDGET_WARNING' ? 'money.attention' : 'primary.main', border: 1, borderColor: 'divider' }}
        >
          <Icon size={18} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            {unread && <Box aria-hidden sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'secondary.main', flexShrink: 0 }} />}
            <Typography variant="subtitle1" sx={{ fontWeight: unread ? 700 : 550 }} noWrap>
              {unread && <span className="visually-hidden">Unread: </span>}
              {n.title}
            </Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
            {n.body}
          </Typography>
          <Typography variant="caption" component="p" sx={{ mt: 0.25 }}>
            {timeAgo(n.createdAt)}
          </Typography>
        </Box>
      </ButtonBase>
      <Tooltip title={unread ? 'Mark as read' : 'Mark as unread'}>
        <IconButton onClick={() => onToggleRead(n)} aria-label={`${unread ? 'Mark as read' : 'Mark as unread'}: ${n.title}`}>
          {unread ? <MailOpen size={18} /> : <Mail size={18} />}
        </IconButton>
      </Tooltip>
    </Stack>
  );
}
