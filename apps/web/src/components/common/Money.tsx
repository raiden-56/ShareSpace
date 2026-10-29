import { Box, Stack, Typography, type TypographyProps } from '@mui/material';
import { ArrowDownLeft, ArrowUpRight, CircleCheck } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { formatMoney } from '@sharespace/core';
import { useReducedMotionPref } from '../../hooks/useMotion';

interface MoneyProps extends Omit<TypographyProps, 'children'> {
  minor: number;
  currency: string;
  signed?: boolean;
  compact?: boolean;
}

/** A monetary value in tabular numerals. Never colours alone carry meaning; pair with labels. */
export function Money({ minor, currency, signed, compact, sx, ...rest }: MoneyProps) {
  return (
    <Typography component="span" variant="money" sx={{ whiteSpace: 'nowrap', ...sx }} {...rest}>
      {formatMoney(minor, currency, { signed, compact })}
    </Typography>
  );
}

/**
 * Value that fades softly when it changes after a confirmed server update.
 * Deliberately no count-up animation, which could suggest money moving before it is recorded.
 */
export function AnimatedMoney(props: MoneyProps) {
  const reduce = useReducedMotionPref();
  if (reduce) return <Money {...props} />;
  return (
    <Box component="span" sx={{ display: 'inline-block', position: 'relative' }}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={`${props.minor}-${props.currency}`}
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -3 }}
          transition={{ duration: 0.18 }}
          style={{ display: 'inline-block' }}
        >
          <Money {...props} />
        </motion.span>
      </AnimatePresence>
    </Box>
  );
}

export type BalanceTone = 'positive' | 'negative' | 'neutral';

export function balanceTone(netMinor: number): BalanceTone {
  return netMinor > 0 ? 'positive' : netMinor < 0 ? 'negative' : 'neutral';
}

interface BalanceLabelProps {
  netMinor: number;
  currency: string;
  /** Whose balance this is. Omit for "you". */
  name?: string;
  size?: 'small' | 'medium' | 'large';
  /** Show only the label and amount without the leading icon. */
  hideIcon?: boolean;
  align?: 'left' | 'right';
}

/**
 * Net balance with an icon and words ("You are owed", "owes", "Settled up") so the meaning
 * never depends on colour alone.
 */
export function BalanceLabel({ netMinor, currency, name, size = 'medium', hideIcon, align = 'left' }: BalanceLabelProps) {
  const tone = balanceTone(netMinor);
  const you = !name;
  const label =
    tone === 'positive'
      ? you
        ? 'You are owed'
        : `${name} is owed`
      : tone === 'negative'
        ? you
          ? 'You owe'
          : `${name} owes`
        : 'Settled up';
  const Icon = tone === 'positive' ? ArrowDownLeft : tone === 'negative' ? ArrowUpRight : CircleCheck;
  const iconSize = size === 'large' ? 20 : size === 'small' ? 14 : 16;
  const amountVariant = size === 'large' ? 'h2' : size === 'small' ? 'body2' : 'subtitle1';
  return (
    <Stack direction="row" spacing={1} alignItems="center" justifyContent={align === 'right' ? 'flex-end' : 'flex-start'} sx={{ minWidth: 0 }}>
      {!hideIcon && (
        <Box
          aria-hidden
          sx={{
            display: 'grid',
            placeItems: 'center',
            width: iconSize + 12,
            height: iconSize + 12,
            borderRadius: '50%',
            flexShrink: 0,
            color: `money.${tone}`,
            bgcolor: (t) => (tone === 'positive' ? t.palette.surface.sage : tone === 'negative' ? 'rgba(201,111,82,0.12)' : t.palette.action.hover),
          }}
        >
          <Icon size={iconSize} />
        </Box>
      )}
      <Box sx={{ minWidth: 0, textAlign: align }}>
        <Typography variant="caption" component="div" sx={{ color: 'text.secondary', lineHeight: 1.3 }}>
          {label}
        </Typography>
        {tone !== 'neutral' && (
          <AnimatedMoney minor={Math.abs(netMinor)} currency={currency} variant={amountVariant as TypographyProps['variant']} sx={{ color: `money.${tone}`, fontWeight: 700 }} />
        )}
      </Box>
    </Stack>
  );
}

/** Compact inline balance text, e.g. "owes ₹200.00" / "gets back ₹50.00" / "settled up". */
export function BalanceInline({ netMinor, currency, you, stacked }: { netMinor: number; currency: string; you?: boolean; stacked?: boolean }) {
  const tone = balanceTone(netMinor);
  const verb = tone === 'positive' ? (you ? 'you get back' : 'gets back') : tone === 'negative' ? (you ? 'you owe' : 'owes') : 'settled up';
  if (stacked) {
    return (
      <Box component="span" sx={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', color: `money.${tone}` }}>
        <Typography component="span" variant="caption" sx={{ color: 'inherit', fontWeight: 600, whiteSpace: 'nowrap' }}>
          {verb}
        </Typography>
        {tone !== 'neutral' && <Money minor={Math.abs(netMinor)} currency={currency} sx={{ fontWeight: 700, fontSize: '0.875rem' }} />}
      </Box>
    );
  }
  return (
    <Typography component="span" variant="body2" sx={{ color: `money.${tone}`, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {verb}
      {tone !== 'neutral' && (
        <>
          {' '}
          <Money minor={Math.abs(netMinor)} currency={currency} sx={{ fontWeight: 700, fontSize: 'inherit' }} />
        </>
      )}
    </Typography>
  );
}
