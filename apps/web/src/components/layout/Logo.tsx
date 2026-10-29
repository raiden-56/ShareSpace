import { Box, Stack, Typography } from '@mui/material';

export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <Box
      component="svg"
      viewBox="0 0 64 64"
      aria-hidden
      sx={{ width: size, height: size, flexShrink: 0, display: 'block' }}
    >
      <rect width="64" height="64" rx="16" fill="#386641" />
      <path d="M20 38c0 5 5 8 12 8s12-3 12-8-5-6-12-7-11-2-11-6 4-6 10-6 9 2 10 5" fill="none" stroke="#F8F6F0" strokeWidth="5" strokeLinecap="round" />
    </Box>
  );
}

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <Stack direction="row" spacing={1.25} alignItems="center">
      <LogoMark />
      {!compact && (
        <Typography component="span" sx={{ fontWeight: 800, fontSize: '1.125rem', letterSpacing: '-0.02em', color: 'text.primary' }}>
          ShareSpace
        </Typography>
      )}
    </Stack>
  );
}
