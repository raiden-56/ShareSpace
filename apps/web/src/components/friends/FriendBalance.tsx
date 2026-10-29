import { Box, Stack, Typography } from '@mui/material';
import { formatMoney } from '@sharespace/core';
import type { Friend } from '../../api/types';

/** "owes you ₹50.00" / "you owe ₹250.00" for one signed amount (positive = they owe you). */
export function friendNetWords(netMinor: number, currency: string): string {
  if (netMinor > 0) return `owes you ${formatMoney(netMinor, currency)}`;
  if (netMinor < 0) return `you owe ${formatMoney(-netMinor, currency)}`;
  return 'settled up';
}

/**
 * A friend's balance in words, one line per currency (amounts in different currencies are never
 * added together). Colour reinforces the words but never carries the meaning alone.
 */
export function FriendBalance({ friend, size = 'medium', align = 'right' }: { friend: Pick<Friend, 'balances'>; size?: 'medium' | 'large'; align?: 'left' | 'right' }) {
  if (friend.balances.length === 0) {
    return (
      <Typography variant={size === 'large' ? 'h3' : 'body2'} component="p" sx={{ color: 'text.secondary', fontWeight: 600, textAlign: align }}>
        Settled up
      </Typography>
    );
  }
  return (
    <Stack spacing={size === 'large' ? 0.5 : 0.25} alignItems={align === 'right' ? 'flex-end' : 'flex-start'}>
      {friend.balances.map((b) => {
        const tone = b.netMinor > 0 ? 'positive' : 'negative';
        return (
          <Box key={b.currency} sx={{ textAlign: align }}>
            <Typography variant="caption" component="span" sx={{ color: `money.${tone}`, fontWeight: 600, display: 'block', lineHeight: 1.3 }}>
              {b.netMinor > 0 ? 'owes you' : 'you owe'}
            </Typography>
            <Typography
              variant={size === 'large' ? 'h2' : 'subtitle1'}
              component="span"
              sx={{ color: `money.${tone}`, fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', display: 'block' }}
            >
              {formatMoney(Math.abs(b.netMinor), b.currency)}
            </Typography>
          </Box>
        );
      })}
    </Stack>
  );
}
