import { Stack, Typography } from '@mui/material';
import { CircleAlert, CircleCheck, Info } from 'lucide-react';
import type { Tone } from './splitModel';

/** Validation/status line with icon + text (never colour alone). Announced politely to screen readers. */
export function SplitStatus({ tone, message, id }: { tone: Tone; message: string; id?: string }) {
  const Icon = tone === 'success' ? CircleCheck : tone === 'error' ? CircleAlert : Info;
  const color = tone === 'success' ? 'money.positive' : tone === 'error' ? 'error.main' : 'text.secondary';
  return (
    <Stack id={id} direction="row" spacing={0.75} alignItems="center" role="status" aria-live="polite" sx={{ color, mt: 1 }}>
      <Icon size={16} aria-hidden style={{ flexShrink: 0 }} />
      <Typography variant="body2" sx={{ color: 'inherit', fontWeight: 600 }}>
        {message}
      </Typography>
    </Stack>
  );
}
