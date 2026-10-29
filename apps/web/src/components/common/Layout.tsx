import type { ReactNode } from 'react';
import { Box, Card, CardContent, Stack, Typography, type SxProps, type Theme } from '@mui/material';
import { motion } from 'framer-motion';
import { useReducedMotionPref } from '../../hooks/useMotion';

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={{ xs: 1.5, sm: 2 }}
      alignItems={{ xs: 'stretch', sm: 'flex-end' }}
      justifyContent="space-between"
      sx={{ mb: 3 }}
    >
      <Box sx={{ minWidth: 0 }}>
        {eyebrow && <Box sx={{ mb: 0.5 }}>{eyebrow}</Box>}
        <Typography variant="h1" sx={{ overflowWrap: 'anywhere' }}>
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {subtitle}
          </Typography>
        )}
      </Box>
      {actions && (
        <Stack direction="row" spacing={1} sx={{ flexShrink: 0, flexWrap: 'wrap', gap: 1, '& > *': { m: '0 !important' } }}>
          {actions}
        </Stack>
      )}
    </Stack>
  );
}

export function SectionCard({
  title,
  action,
  children,
  sx,
  contentSx,
  subtitle,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  sx?: SxProps<Theme>;
  contentSx?: SxProps<Theme>;
}) {
  return (
    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column', ...sx }}>
      {(title || action) && (
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 2.5, pt: 2.25, pb: 0.5, flexWrap: 'wrap', gap: 1 }}>
          <Box sx={{ minWidth: 0, flex: '1 1 220px' }}>
            {title && (
              <Typography variant="h3" component="h2">
                {title}
              </Typography>
            )}
            {subtitle && (
              <Typography variant="caption" component="p">
                {subtitle}
              </Typography>
            )}
          </Box>
          {action && <Box sx={{ flexShrink: 0, '& .MuiButton-root': { whiteSpace: 'nowrap' } }}>{action}</Box>}
        </Stack>
      )}
      <CardContent sx={{ flex: 1, px: 2.5, '&:last-child': { pb: 2.5 }, ...contentSx }}>{children}</CardContent>
    </Card>
  );
}

/** Brief fade + subtle rise on page entry. Never delays navigation; disabled for reduced motion. */
export function PageTransition({ children }: { children: ReactNode }) {
  const reduce = useReducedMotionPref();
  if (reduce) return <>{children}</>;
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: 'easeOut' }}>
      {children}
    </motion.div>
  );
}

/** Stat tile for a single headline figure. */
export function StatTile({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode }) {
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent sx={{ p: 2.25, '&:last-child': { pb: 2.25 } }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1, color: 'text.secondary' }}>
          {icon}
          <Typography variant="overline" component="p">
            {label}
          </Typography>
        </Stack>
        <Box sx={{ typography: 'h2' }}>{value}</Box>
        {hint && (
          <Typography variant="caption" component="p" sx={{ mt: 0.5 }}>
            {hint}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}
