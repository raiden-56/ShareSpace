import type { ReactNode } from 'react';
import { Alert, Box, Button, Paper, Stack, Typography } from '@mui/material';
import { CircleAlert, Lock, RotateCcw, SearchX } from 'lucide-react';
import { Link as RouterLink } from 'react-router-dom';
import { toApiError } from '../../api/api';

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}

/** Helpful empty state with a next action. Never filled with fake records. */
export function EmptyState({ icon, title, description, action, compact }: EmptyStateProps) {
  return (
    <Stack alignItems="center" textAlign="center" spacing={1.5} sx={{ py: compact ? 4 : 7, px: 2 }}>
      <Box
        aria-hidden
        sx={{ width: compact ? 44 : 56, height: compact ? 44 : 56, borderRadius: '16px', display: 'grid', placeItems: 'center', bgcolor: 'surface.sage', color: 'primary.main' }}
      >
        {icon}
      </Box>
      <Typography variant={compact ? 'h4' : 'h3'} component="p">
        {title}
      </Typography>
      {description && (
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420 }}>
          {description}
        </Typography>
      )}
      {action && <Box sx={{ pt: 1 }}>{action}</Box>}
    </Stack>
  );
}

/** Error state for failed requests. Maps 404/403 to friendly, non-revealing messages. */
export function ErrorState({ error, onRetry, title }: { error: unknown; onRetry?: () => void; title?: string }) {
  const e = toApiError(error);
  if (e.status === 404) {
    return (
      <Paper variant="outlined" sx={{ borderRadius: 3.5 }}>
        <EmptyState
          icon={<SearchX size={26} />}
          title={title ?? 'We could not find that'}
          description="It may have been removed, or you may not have access to it."
          action={
            <Button component={RouterLink} to="/" variant="outlined">
              Back to overview
            </Button>
          }
        />
      </Paper>
    );
  }
  if (e.status === 403) {
    return (
      <Paper variant="outlined" sx={{ borderRadius: 3.5 }}>
        <EmptyState icon={<Lock size={26} />} title="You do not have access" description={e.message} />
      </Paper>
    );
  }
  return (
    <Alert
      severity="error"
      icon={<CircleAlert size={20} />}
      action={
        onRetry && (
          <Button color="inherit" size="small" startIcon={<RotateCcw size={16} />} onClick={onRetry}>
            Retry
          </Button>
        )
      }
    >
      {title ? `${title}: ` : ''}
      {e.message}
    </Alert>
  );
}
