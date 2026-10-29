import type { ReactNode } from 'react';
import { Box, Card, Stack, Typography } from '@mui/material';
import { CircleCheck } from 'lucide-react';
import { Logo } from '../../components/layout/Logo';

const POINTS = ['Split bills fairly, down to the last paisa', 'See who owes whom at a glance', 'Plan trips and events with your group'];

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <Box sx={{ minHeight: '100dvh', display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.05fr 1fr' }, bgcolor: 'background.default' }}>
      <Box
        sx={{
          display: { xs: 'none', md: 'flex' },
          flexDirection: 'column',
          justifyContent: 'space-between',
          p: 6,
          bgcolor: 'brand.deepGreen',
          color: '#F8F6F0',
        }}
      >
        <Stack direction="row" spacing={1.25} alignItems="center">
          <Box sx={{ '& span': { color: '#F8F6F0 !important' } }}>
            <Logo />
          </Box>
        </Stack>
        <Box sx={{ maxWidth: 440 }}>
          <Typography component="p" sx={{ fontSize: '2rem', fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.2, mb: 1.5 }}>
            Plan together. Split fairly. Stay organized.
          </Typography>
          <Typography sx={{ color: 'rgba(248,246,240,0.8)', mb: 4 }}>
            ShareSpace keeps shared costs clear for friends, families, roommates and teams.
          </Typography>
          <Stack spacing={1.5}>
            {POINTS.map((p) => (
              <Stack key={p} direction="row" spacing={1.25} alignItems="center">
                <CircleCheck size={18} color="#E4EBDD" aria-hidden />
                <Typography sx={{ color: 'rgba(248,246,240,0.92)' }}>{p}</Typography>
              </Stack>
            ))}
          </Stack>
        </Box>
        <Typography variant="caption" sx={{ color: 'rgba(248,246,240,0.65)' }}>
          ShareSpace records payments you make elsewhere. It never moves money.
        </Typography>
      </Box>

      <Box component="main" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', p: { xs: 2, sm: 4 } }}>
        <Box sx={{ width: '100%', maxWidth: 420 }}>
          <Box sx={{ display: { md: 'none' }, mb: 3 }}>
            <Logo />
          </Box>
          <Card sx={{ p: { xs: 2.5, sm: 4 } }}>
            <Typography variant="h1" component="h1" sx={{ mb: 0.75 }}>
              {title}
            </Typography>
            {subtitle && (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                {subtitle}
              </Typography>
            )}
            {children}
          </Card>
          {footer && <Box sx={{ mt: 2.5, textAlign: 'center' }}>{footer}</Box>}
        </Box>
      </Box>
    </Box>
  );
}
